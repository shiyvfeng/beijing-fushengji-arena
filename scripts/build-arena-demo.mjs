#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(root, "web");
const outputRoot = join(root, "dist", "arena-demo");
const replayPath = join(outputRoot, "replay.json");
const htmlPath = join(outputRoot, "replay.html");
const assetManifestPath = join(webRoot, "public", "assets", "asset-manifest.json");
const seed = Number(process.env.ARENA_SEED ?? 20_260_820);

if (!Number.isSafeInteger(seed)) {
  throw new Error("ARENA_SEED 必须是安全整数");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 执行失败，退出码 ${result.status}`);
  }
}

async function ensureWebDependencies() {
  const tscPath = join(webRoot, "node_modules", ".bin", "tsc");
  try {
    await access(tscPath);
  } catch {
    throw new Error("Web 依赖尚未安装；请先运行 `npm --prefix web ci`，再重试 `npm run internal:build:arena`");
  }
}

async function validateAssetManifest() {
  const manifest = JSON.parse(await readFile(assetManifestPath, "utf8"));
  const entries = Object.entries(manifest?.assets ?? {});
  if (manifest?.schemaVersion !== "arena-assets/0.1" || entries.length === 0) {
    throw new Error("素材清单 schemaVersion 无效或没有素材条目");
  }
  const publicRoot = resolve(webRoot, "public");
  const assetsRoot = `${resolve(publicRoot, "assets")}/`;
  for (const [id, entry] of entries) {
    if (!entry || typeof entry !== "object") throw new Error(`素材 ${id} 的清单条目无效`);
    if (typeof entry.relativePath !== "string" || !entry.relativePath.startsWith("./assets/")) {
      throw new Error(`素材 ${id} 必须位于 web/public/assets`);
    }
    const assetPath = resolve(publicRoot, entry.relativePath);
    if (!assetPath.startsWith(assetsRoot)) throw new Error(`素材 ${id} 逃逸 public/assets`);
    const actualHash = createHash("sha256").update(await readFile(assetPath)).digest("hex");
    if (actualHash !== entry.sha256) throw new Error(`素材 ${id} 的 SHA-256 与清单不一致`);
    if (typeof entry.promptRecord !== "string" || !entry.promptRecord.startsWith("./assets/")) {
      throw new Error(`素材 ${id} 缺少本地 Prompt/来源记录`);
    }
    const promptPath = resolve(publicRoot, entry.promptRecord);
    if (!promptPath.startsWith(assetsRoot)) throw new Error(`素材 ${id} 的 Prompt 记录逃逸 public/assets`);
    await access(promptPath);
    if (typeof entry.publicDistributionAllowed !== "boolean") {
      throw new Error(`素材 ${id} 缺少 publicDistributionAllowed`);
    }
  }
  return entries.length;
}

function validateReplay(replay) {
  const errors = [];
  if (replay?.metadata?.executionMode !== "scripted") errors.push("executionMode 不是 scripted");
  if (!Array.isArray(replay?.agents) || replay.agents.length !== 4) errors.push("Agent 数量不是 4");
  if (!Array.isArray(replay?.days) || replay.days.length !== 40) errors.push("Replay 天数不是 40");
  if (replay?.days?.some((day, index) => day.day !== index + 1)) errors.push("Replay 日期不连续");
  if (replay?.days?.some(day => day.agentSnapshots?.length !== 4)) errors.push("存在缺少四人快照的日期");
  if (!String(replay?.replayHash ?? "").startsWith("sha256:")) errors.push("Replay hash 不是 SHA-256");
  if (replay?.schemaVersion !== "arena-schema-v4") errors.push("Replay schema 不是 v4");
  if (replay?.competitionAudit !== undefined) errors.push("Scripted 金样不得声明 Direct competitionAudit");
  if (replay?.personalRandomEventAudit?.basis !== "personal-event-count-v1") errors.push("Replay 缺少个人随机事件审计口径");
  if (errors.length) throw new Error(`Replay 验证失败：${errors.join("；")}`);
}

function validateOfflineHtml(html, replay) {
  const errors = [];
  const runtimeNetworkPatterns = [
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /\bnew\s+XMLHttpRequest\b/],
    ["WebSocket", /\bnew\s+WebSocket\b/],
    ["EventSource", /\bnew\s+EventSource\b/],
    ["sendBeacon", /\bnavigator\.sendBeacon\s*\(/],
    ["remote CSS url", /url\(\s*["']?(?:https?:|\/\/)/i],
    ["remote dynamic import", /\bimport\s*\(\s*["'](?:https?:|\/\/)/i],
  ];
  if (/(?:src|href)=["'](?:https?:|\/\/)/i.test(html)) errors.push("仍包含远程 src/href");
  if (/<script\b[^>]+src=/i.test(html)) errors.push("仍包含外链脚本");
  if (/<link\b[^>]+rel=["']stylesheet["']/i.test(html)) errors.push("仍包含外链样式");
  for (const [label, pattern] of runtimeNetworkPatterns) {
    if (pattern.test(html)) errors.push(`仍包含运行时网络能力：${label}`);
  }
  if (!html.includes("data-replay-hash-marker") || !html.includes("回放哈希")) {
    errors.push("页面缺少可见 Replay hash 标记");
  }
  if (!html.includes(replay.replayHash)) errors.push("HTML 未内嵌 Replay hash");
  if (!html.includes(replay.factHash)) errors.push("HTML 未内嵌 fact hash");
  for (const forbidden of [
    "sampleReplay",
    "sample-fallback",
    "采访预测",
    "预测对账",
    "守夜电台",
    "导演高光",
    "人物结局",
  ]) {
    if (html.includes(forbidden)) errors.push(`正式 HTML 包含暂停或样例能力：${forbidden}`);
  }
  if (/sk-[A-Za-z0-9_-]{16,}/.test(html)) errors.push("HTML 疑似包含 API Key");
  if (/authorization\s*[:=]\s*["']?bearer\s+/i.test(html)) errors.push("HTML 疑似包含 Authorization Header");
  if (errors.length) throw new Error(`离线 HTML 验证失败：${errors.join("；")}`);
}

await ensureWebDependencies();
const verifiedAssetCount = await validateAssetManifest();
run("npm", ["run", "build"], root);

const matchRunnerUrl = `${pathToFileURL(join(root, "dist", "arena", "match-runner.js")).href}?seed=${seed}`;
const { runSampleScriptedMatch } = await import(matchRunnerUrl);
const output = await runSampleScriptedMatch(seed);
validateReplay(output.replay);

await mkdir(outputRoot, { recursive: true });
await writeFile(replayPath, `${JSON.stringify(output.replay, null, 2)}\n`, "utf8");
await writeFile(join(outputRoot, "episode-traces.json"), `${JSON.stringify(output.traces, null, 2)}\n`, "utf8");
await writeFile(join(outputRoot, "run-report.json"), `${JSON.stringify(output.report, null, 2)}\n`, "utf8");

run(process.execPath, [
  join(root, "scripts", "build-arena-replay.mjs"),
  "--input",
  replayPath,
  "--output",
  htmlPath,
  "--allow-internal-scripted",
], root);
await copyFile(
  assetManifestPath,
  join(outputRoot, "asset-manifest.json"),
);

const html = await readFile(htmlPath, "utf8");
validateOfflineHtml(html, output.replay);

const validation = {
  artifactType: "arena-scripted-golden-validation-v2",
  executionMode: "scripted",
  seed,
  agents: output.replay.agents.length,
  days: output.replay.days.length,
  replayHash: output.replay.replayHash,
  factHash: output.replay.factHash,
  htmlBytes: Buffer.byteLength(html),
  runtimeRemoteDependencies: 0,
  replayHashVisible: true,
  assetHashesVerified: verifiedAssetCount,
  apiKeyPatternFound: false,
  personalRandomEventAuditBasis: output.replay.personalRandomEventAudit.basis,
  limitations: output.report.limitations,
};
await writeFile(join(outputRoot, "validation-report.json"), `${JSON.stringify(validation, null, 2)}\n`, "utf8");

process.stdout.write(`Arena Scripted 金样已生成：${htmlPath}\n`);
process.stdout.write(`Replay：${replayPath}\n`);
process.stdout.write(`Replay hash：${output.replay.replayHash}\n`);
