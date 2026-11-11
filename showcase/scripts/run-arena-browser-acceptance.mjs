#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { adaptCoreMatchReplay } from "../web/src/replay-adapter.ts";
import { generateReplayEnrichment } from "../web/src/enrichment.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const replayBuilderPath = join(root, "scripts", "build-arena-replay.mjs");
const playwrightPackagePath = createRequire(import.meta.url).resolve("@playwright/test/package.json");
const playwrightCliPath = join(dirname(playwrightPackagePath), "cli.js");
const fixtureModulePath = join(root, "web", "tests", "fixtures", "core-replay.ts");
const supportedNodeMajors = new Set([22, 24, 26]);
const shaPattern = /^sha256:[0-9a-f]{64}$/u;

function readValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} 缺少值`);
  return value;
}

function parseArgs(args) {
  let fixture = false;
  let input = "";
  let report = "";
  let enrichment = "";
  let html = "";
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--fixture") {
      fixture = true;
      continue;
    }
    if (argument === "--input") {
      input = readValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--report") {
      report = readValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--enrichment") {
      enrichment = readValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--html") {
      html = readValue(args, index, argument);
      index++;
      continue;
    }
    throw new Error(
      "存在未知参数；用法：test:arena-browser -- --input <replay.json> --report <browser-acceptance.json> [--enrichment <enrichment.json>] [--html <replay.html>]",
    );
  }
  if (fixture && (input || enrichment || html)) throw new Error("--fixture 不能与 --input、--enrichment 或 --html 同时使用");
  if (!fixture && (!input || !report)) {
    throw new Error("正式浏览器验收必须显式传入 --input <replay.json> 和 --report <browser-acceptance.json>");
  }
  return {
    mode: fixture ? "fixture" : "formal",
    inputPath: input ? resolve(input) : undefined,
    reportPath: report ? resolve(report) : undefined,
    enrichmentPath: enrichment ? resolve(enrichment) : undefined,
    htmlPath: html ? resolve(html) : undefined,
  };
}

function ensureSupportedNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!supportedNodeMajors.has(major)) {
    throw new Error(`浏览器验收只支持 Node 22/24/26；当前为 ${process.version}`);
  }
}

function ensureFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} 不存在或不是文件：${path}`);
}

function normalizedProviderIdentity(value) {
  switch (String(value).trim().toLowerCase()) {
    case "gpt": return "openai";
    case "claude": return "anthropic";
    case "dashscope": return "qwen";
    case "moonshot": return "kimi";
    case "openai-chat": return "openai-compatible";
    default: return String(value).trim().toLowerCase();
  }
}

function validateDirectReplay(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 顶层必须是对象`);
  if (value.schemaVersion !== "arena-schema-v4") throw new Error(`${label} 必须是 arena-schema-v4`);
  if (value?.metadata?.executionMode !== "direct") throw new Error(`${label} 必须是 Direct Replay`);
  if (value?.metadata?.agentCount !== 5 || value?.metadata?.totalDays !== 40) {
    throw new Error(`${label} metadata 必须声明五个 Agent 和 40 天`);
  }
  if (!shaPattern.test(value.replayHash ?? "") || !shaPattern.test(value.factHash ?? "")) {
    throw new Error(`${label} Replay/fact hash 无效`);
  }
  if (!Array.isArray(value.agents) || value.agents.length !== 5) throw new Error(`${label} 必须包含五个 Agent`);
  const identities = new Set();
  for (const [index, agent] of value.agents.entries()) {
    if (agent?.driver !== "direct") throw new Error(`${label} Agent ${index + 1} 必须使用 Direct driver`);
    const provider = String(agent?.provider ?? "").trim();
    const model = String(agent?.model ?? "").trim();
    if (!provider || !model) throw new Error(`${label} Agent ${index + 1} 缺少 Provider 或 model`);
    identities.add(`${normalizedProviderIdentity(provider)}\0${model}`);
  }
  if (identities.size !== 5) throw new Error(`${label} 的五组 Provider + model 必须互不重复`);
  if (!Array.isArray(value.days) || value.days.length !== 40
    || value.days.some((day, index) => day?.day !== index + 1)) {
    throw new Error(`${label} 必须连续包含第 1..40 天`);
  }
  return value;
}

function rejectKnownSyntheticReplay(value, label) {
  const syntheticMarker = /(?:^|[^a-z0-9])(fake|fixture|mock|sample|scripted|test)(?:$|[^a-z0-9])|测试|模拟|样例|夹具/iu;
  const fields = [
    ["matchId", value.matchId],
    ["scenarioId", value.scenarioId],
    ...value.agents.flatMap((agent, index) => [
      [`agents[${index}].provider`, agent.provider],
      [`agents[${index}].model`, agent.model],
      [`agents[${index}].providerAdapterVersion`, agent.providerAdapterVersion],
    ]),
  ];
  const marked = fields.find(([, fieldValue]) => syntheticMarker.test(String(fieldValue ?? "")));
  if (marked) {
    throw new Error(`${label} 的 ${marked[0]} 含测试替身标记，Fake/Fixture/Scripted 不能形成正式通过结论`);
  }
}

function sanitizedEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const name of Object.keys(env)) {
    if (/^(?:ARENA_AGENT_[A-Z]_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|DASHSCOPE_API_KEY|MOONSHOT_API_KEY)$/u.test(name)) {
      delete env[name];
    }
  }
  delete env.NO_COLOR;
  return env;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function runChecked(command, args, label, options = {}) {
  const result = run(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    throw new Error(`${label}失败${detail ? `：${detail}` : ""}`);
  }
  return result;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function displayPath(path) {
  const candidate = relative(root, path);
  return candidate && !candidate.startsWith("..") ? candidate : path;
}

function buildReplay(inputPath, outputPath, enrichmentPath = undefined) {
  const args = [replayBuilderPath, "--input", inputPath, "--output", outputPath];
  if (enrichmentPath) args.push("--enrichment", enrichmentPath);
  runChecked(
    process.execPath,
    args,
    "Replay HTML 构建",
    { env: sanitizedEnvironment() },
  );
}

function writeFixtureEnrichment(replay, path) {
  const enrichment = generateReplayEnrichment(adaptCoreMatchReplay(replay));
  writeFileSync(path, `${JSON.stringify(enrichment, null, 2)}\n`, "utf8");
  return enrichment;
}

function injectedReplayMatch(html) {
  const pattern = /<script type="application\/json" id="arena-replay-data">([\s\S]*?)<\/script>/u;
  const match = html.match(pattern);
  if (!match) throw new Error("replay.html 缺少内嵌 Replay 数据");
  return { pattern, match };
}

function injectedEnrichmentMatch(html) {
  const pattern = /<script type="application\/json" id="arena-replay-enrichment-data">([\s\S]*?)<\/script>/u;
  const match = html.match(pattern);
  if (!match) throw new Error("replay.html 缺少内嵌 Enrichment 数据");
  return { pattern, match };
}

function writeFailureVariants(sourceHtmlPath, missingPath, tamperedPath, badEnrichmentPath) {
  const html = readFileSync(sourceHtmlPath, "utf8");
  const { pattern, match } = injectedReplayMatch(html);
  writeFileSync(missingPath, html.replace(pattern, ""), "utf8");
  const replay = JSON.parse(match[1]);
  replay.days[0].agentSnapshots[0].state.cash += 1;
  const tamperedJson = JSON.stringify(replay).replaceAll("<", "\\u003c");
  writeFileSync(tamperedPath, html.replace(match[0], `<script type="application/json" id="arena-replay-data">${tamperedJson}</script>`), "utf8");
  const enrichment = injectedEnrichmentMatch(html);
  const badArtifact = JSON.parse(enrichment.match[1]);
  badArtifact.sourceFactHash = `sha256:${"0".repeat(64)}`;
  const badJson = JSON.stringify(badArtifact).replaceAll("<", "\\u003c");
  writeFileSync(badEnrichmentPath, html.replace(enrichment.match[0], `<script type="application/json" id="arena-replay-enrichment-data">${badJson}</script>`), "utf8");
}

async function writeFixture(path, factoryName = "coreReplayFixture", label = "确定性浏览器 Fixture") {
  const module = await import(pathToFileURL(fixtureModulePath).href);
  const factory = module[factoryName];
  if (typeof factory !== "function") throw new Error(`${label} 缺少 ${factoryName} 工厂`);
  const replay = validateDirectReplay(factory(), label);
  writeFileSync(path, `${JSON.stringify(replay, null, 2)}\n`, "utf8");
  return replay;
}

function browserVersion() {
  const source = [
    "import { chromium } from '@playwright/test';",
    "const browser = await chromium.launch();",
    "process.stdout.write(browser.version());",
    "await browser.close();",
  ].join("\n");
  const result = run(process.execPath, ["--input-type=module", "--eval", source], {
    env: sanitizedEnvironment(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Chromium 尚未安装或无法启动；请先运行 npm run browser:install：${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function flattenPlaywrightReport(report) {
  const checks = [];
  function visit(suite, parents = []) {
    const titles = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      for (const item of spec.tests ?? []) {
        const result = item.results?.at(-1);
        const status = result?.status ?? "unknown";
        const error = result?.error?.message ?? result?.errors?.map(entry => entry.message).filter(Boolean).join("\n");
        checks.push({
          project: item.projectName ?? item.projectId ?? "unknown",
          title: [...titles, spec.title].filter(Boolean).join(" › "),
          status,
          durationMs: result?.duration ?? 0,
          ...(error ? { error: String(error).slice(0, 4_000) } : {}),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  }
  for (const suite of report.suites ?? []) visit(suite);
  return checks;
}

function summarizeProjects(checks) {
  const viewports = {
    "chromium-1366x768": { width: 1366, height: 768 },
    "chromium-1920x1080": { width: 1920, height: 1080 },
  };
  return Object.entries(viewports).map(([name, viewport]) => {
    const items = checks.filter(check => check.project === name);
    const failed = items.filter(check => !["passed", "skipped"].includes(check.status)).length;
    return {
      name,
      viewport,
      passed: items.filter(check => check.status === "passed").length,
      failed,
      skipped: items.filter(check => check.status === "skipped").length,
      durationMs: items.reduce((sum, check) => sum + check.durationMs, 0),
    };
  });
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

async function main() {
  ensureSupportedNode();
  const options = parseArgs(process.argv.slice(2));
  ensureFile(playwrightCliPath, "Playwright CLI");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "arena-browser-acceptance-"));
  let report = {
    artifactType: "arena-browser-acceptance-v1",
    createdAt: new Date().toISOString(),
    mode: options.mode,
    evidenceClass: options.mode === "formal" ? "formal-direct-replay" : "deterministic-fixture",
    status: "failed",
    toolchain: {
      node: process.version,
      playwright: JSON.parse(readFileSync(playwrightPackagePath, "utf8")).version,
      chromium: "unavailable",
    },
    source: null,
    projects: [],
    checks: [],
    failures: [],
  };
  try {
    const fixtureDirectory = join(temporaryRoot, "fixture");
    mkdirSync(fixtureDirectory, { recursive: true });
    const fixtureReplayPath = join(fixtureDirectory, "replay.json");
    const fixtureEnrichmentPath = join(fixtureDirectory, "replay-enrichment.json");
    const fixtureHtmlOne = join(fixtureDirectory, "replay-1.html");
    const fixtureHtmlTwo = join(fixtureDirectory, "replay-2.html");
    const assistedReplayPath = join(fixtureDirectory, "assisted-replay.json");
    const assistedEnrichmentPath = join(fixtureDirectory, "assisted-replay-enrichment.json");
    const assistedHtmlPath = join(fixtureDirectory, "assisted-replay.html");
    const missingReplayHtml = join(fixtureDirectory, "missing-replay.html");
    const tamperedReplayHtml = join(fixtureDirectory, "tampered-replay.html");
    const badEnrichmentHtml = join(fixtureDirectory, "bad-enrichment.html");
    const fixtureReplay = await writeFixture(fixtureReplayPath);
    writeFixtureEnrichment(fixtureReplay, fixtureEnrichmentPath);
    buildReplay(fixtureReplayPath, fixtureHtmlOne, fixtureEnrichmentPath);
    buildReplay(fixtureReplayPath, fixtureHtmlTwo, fixtureEnrichmentPath);
    const assistedReplay = await writeFixture(
      assistedReplayPath,
      "completionReplayFixture",
      "Completion-Assisted 浏览器 Fixture",
    );
    writeFixtureEnrichment(assistedReplay, assistedEnrichmentPath);
    buildReplay(assistedReplayPath, assistedHtmlPath, assistedEnrichmentPath);
    if (sha256File(fixtureHtmlOne) !== sha256File(fixtureHtmlTwo)) {
      throw new Error("确定性浏览器 Fixture 重复构建的 HTML SHA-256 不一致");
    }
    writeFailureVariants(fixtureHtmlOne, missingReplayHtml, tamperedReplayHtml, badEnrichmentHtml);

    let subjectReplayPath = fixtureReplayPath;
    let subjectHtmlPath = fixtureHtmlOne;
    let subjectReplay = JSON.parse(readFileSync(fixtureReplayPath, "utf8"));
    let subjectHtmlHash = sha256File(fixtureHtmlOne);
    if (options.mode === "formal") {
      ensureFile(options.inputPath, "正式 Replay");
      subjectReplay = validateDirectReplay(JSON.parse(readFileSync(options.inputPath, "utf8")), "正式 Replay");
      rejectKnownSyntheticReplay(subjectReplay, "正式 Replay");
      subjectReplayPath = options.inputPath;
      subjectHtmlPath = options.htmlPath ?? join(dirname(options.inputPath), "replay.html");
      ensureFile(subjectHtmlPath, "正式 replay.html");
      if (options.enrichmentPath) ensureFile(options.enrichmentPath, "正式 Enrichment");
      if (options.reportPath === options.inputPath
        || options.reportPath === subjectHtmlPath
        || options.reportPath === options.enrichmentPath) {
        throw new Error("验收报告不能覆盖 replay.json、replay.html 或 Enrichment");
      }
      const rebuiltOne = join(temporaryRoot, "formal-rebuilt-1.html");
      const rebuiltTwo = join(temporaryRoot, "formal-rebuilt-2.html");
      buildReplay(subjectReplayPath, rebuiltOne, options.enrichmentPath);
      buildReplay(subjectReplayPath, rebuiltTwo, options.enrichmentPath);
      const rebuiltHash = sha256File(rebuiltOne);
      if (rebuiltHash !== sha256File(rebuiltTwo)) throw new Error("正式 Replay 重复构建的 HTML SHA-256 不一致");
      subjectHtmlHash = sha256File(subjectHtmlPath);
      if (subjectHtmlHash !== rebuiltHash) throw new Error("现有正式 replay.html 与当前源码重复构建结果不一致");
    }

    report.source = {
      replayPath: displayPath(subjectReplayPath),
      htmlPath: displayPath(subjectHtmlPath),
      replayHash: subjectReplay.replayHash,
      factHash: subjectReplay.factHash,
      htmlSha256: subjectHtmlHash,
      deterministicRebuild: true,
      ...(options.enrichmentPath ? {
        enrichmentPath: displayPath(options.enrichmentPath),
        enrichmentFileSha256: sha256File(options.enrichmentPath),
      } : {}),
    };
    report.toolchain.chromium = browserVersion();

    const playwrightJsonPath = join(temporaryRoot, "playwright-report.json");
    const outputDir = options.mode === "formal"
      ? join(dirname(options.reportPath), `${basename(options.reportPath, ".json")}-artifacts`)
      : join(root, "test-results", "arena-browser-fixture");
    const environment = sanitizedEnvironment({
      ARENA_BROWSER_MODE: options.mode,
      ARENA_BROWSER_SUBJECT_REPLAY: subjectReplayPath,
      ARENA_BROWSER_SUBJECT_HTML: subjectHtmlPath,
      ARENA_BROWSER_FIXTURE_REPLAY: fixtureReplayPath,
      ARENA_BROWSER_FIXTURE_HTML: fixtureHtmlOne,
      ARENA_BROWSER_FIXTURE_ENRICHMENT: fixtureEnrichmentPath,
      ARENA_BROWSER_ASSISTED_FIXTURE_REPLAY: assistedReplayPath,
      ARENA_BROWSER_ASSISTED_FIXTURE_HTML: assistedHtmlPath,
      ARENA_BROWSER_MISSING_HTML: missingReplayHtml,
      ARENA_BROWSER_TAMPERED_HTML: tamperedReplayHtml,
      ARENA_BROWSER_BAD_ENRICHMENT_HTML: badEnrichmentHtml,
      ARENA_BROWSER_JSON_REPORT: playwrightJsonPath,
      ARENA_BROWSER_OUTPUT_DIR: outputDir,
    });
    const result = run(process.execPath, [playwrightCliPath, "test", "--config", join(root, "playwright.config.ts")], {
      env: environment,
    });
    if (!existsSync(playwrightJsonPath)) {
      throw new Error("Playwright 未生成内置 JSON 报告");
    }
    const playwrightReport = JSON.parse(readFileSync(playwrightJsonPath, "utf8"));
    report.checks = flattenPlaywrightReport(playwrightReport);
    report.projects = summarizeProjects(report.checks);
    report.status = result.status === 0 ? "passed" : "failed";
    report.failures = report.checks
      .filter(check => !["passed", "skipped"].includes(check.status))
      .map(check => ({ project: check.project, title: check.title, error: check.error ?? check.status }));
    if (result.status !== 0 && report.failures.length === 0) {
      report.failures.push({
        project: "runner",
        title: "Playwright 进程",
        error: `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim().slice(0, 4_000) || `退出码 ${result.status}`,
      });
    }
    if (result.status === 0 && report.projects.some(project => project.passed === 0 || project.failed > 0)) {
      report.status = "failed";
      report.failures.push({
        project: "runner",
        title: "Playwright JSON 报告完整性",
        error: "双视口项目必须各自包含至少一项通过且零失败的检查",
      });
    }
    if (options.reportPath) writeJsonAtomic(options.reportPath, report);
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (report.status !== "passed") throw new Error("自动浏览器验收未通过");
    rmSync(outputDir, { recursive: true, force: true });
    process.stdout.write(`浏览器验收通过：${options.mode === "formal" ? options.reportPath : "deterministic fixture"}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    if (!report.failures.length) report.failures.push({ project: "runner", title: "验收准备或执行", error: message });
    if (options.reportPath) writeJsonAtomic(options.reportPath, report);
    throw error;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "未知错误";
  process.stderr.write(`Arena 浏览器验收失败：${message}\n`);
  process.exitCode = 1;
}
