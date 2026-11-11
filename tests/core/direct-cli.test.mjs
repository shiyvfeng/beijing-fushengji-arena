import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findPotentialSecrets } from "../../dist/core/secret-scan.js";
import { integrityHash } from "../../dist/core/stable-value.js";

const cliPath = new URL("../../dist/arena-direct-cli.js", import.meta.url);
const wrapperPath = new URL("../../scripts/run-arena-direct.mjs", import.meta.url);
const replayBuilderPath = new URL("../../showcase/scripts/build-arena-replay.mjs", import.meta.url);
const fetchShimPath = new URL("./fixtures/direct-fetch-shim.mjs", import.meta.url);
const TEST_SECRET = "sk-cli-multi-secret-123456789";
const CONFIG_LETTERS = ["A", "B", "C", "D", "E"];
const CONFIG_ENV_NAMES = [
  ...CONFIG_LETTERS.flatMap(letter => [
    `ARENA_AGENT_${letter}_PROVIDER`,
    `ARENA_AGENT_${letter}_BASE_URL`,
    `ARENA_AGENT_${letter}_API_KEY`,
    `ARENA_AGENT_${letter}_MODEL`,
    `ARENA_AGENT_${letter}_MODEL_REVISION`,
    `ARENA_AGENT_${letter}_THINKING`,
    `ARENA_AGENT_${letter}_REASONING_EFFORT`,
  ]),
  "ARENA_OUTPUT_DIR", "ARENA_MATCH_ID", "ARENA_SEED", "ARENA_MAX_ACTIONS_PER_AGENT",
  "ARENA_DECISION_TIMEOUT_MS", "ARENA_TOTAL_WALL_CLOCK_MS", "ARENA_PROVIDER_TIME_BUDGET_MS", "ARENA_MAX_OUTPUT_TOKENS",
  "ARENA_SLOT_ROTATION_INDEX", "ARENA_SAVE_RAW_EXCHANGES", "ARENA_CONFIRM_LIVE_RUN",
];

function runCli(args, extraEnv = {}) {
  const env = { ...process.env };
  for (const name of CONFIG_ENV_NAMES) delete env[name];
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [cliPath.pathname, "--", ...args], { encoding: "utf8", env });
}

function createEnvFixture(t, lines) {
  const directory = mkdtempSync(join(tmpdir(), "arena-direct-five-env-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, ".env");
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return { directory, path };
}

function providerLines(outputDir, overrides = {}) {
  const providers = ["gpt", "claude", "deepseek", "qwen", "kimi"];
  const origins = [
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "https://api.deepseek.com",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://api.moonshot.cn/v1",
  ];
  const lines = [];
  const highestEfforts = ["low", "low", "low", "low", "low"];
  CONFIG_LETTERS.forEach((letter, index) => {
    const base = {
      provider: providers[index],
      baseUrl: origins[index],
      apiKey: `${TEST_SECRET}-${letter.toLowerCase()}`,
      model: `model-${letter.toLowerCase()}`,
      revision: `revision-${letter.toLowerCase()}`,
      thinking: index === 2 ? "enabled" : undefined,
      reasoningEffort: highestEfforts[index],
    };
    const config = { ...base, ...(overrides[letter] ?? {}) };
    lines.push(
      `ARENA_AGENT_${letter}_PROVIDER=${config.provider}`,
      `ARENA_AGENT_${letter}_BASE_URL=${config.baseUrl}`,
      `ARENA_AGENT_${letter}_API_KEY=${config.apiKey}`,
      `ARENA_AGENT_${letter}_MODEL=${config.model}`,
      `ARENA_AGENT_${letter}_MODEL_REVISION=${config.revision}`,
      `ARENA_AGENT_${letter}_REASONING_EFFORT=${config.reasoningEffort}`,
    );
    if (config.thinking !== undefined) lines.push(`ARENA_AGENT_${letter}_THINKING=${config.thinking}`);
  });
  if (outputDir) lines.push(`ARENA_OUTPUT_DIR=${outputDir}`);
  return lines;
}

function fakeProviderEnv() {
  const env = {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fetchShimPath.href}`.trim(),
  };
  CONFIG_LETTERS.forEach((letter, index) => {
    env[`ARENA_AGENT_${letter}_PROVIDER`] = "openai-compatible";
    env[`ARENA_AGENT_${letter}_BASE_URL`] = `https://${letter.toLowerCase()}.invalid/v1`;
    env[`ARENA_AGENT_${letter}_API_KEY`] = `${TEST_SECRET}-${letter.toLowerCase()}`;
    env[`ARENA_AGENT_${letter}_MODEL`] = `model-${index + 1}`;
    env[`ARENA_AGENT_${letter}_MODEL_REVISION`] = `revision-${index + 1}`;
    env[`ARENA_AGENT_${letter}_THINKING`] = "default";
    env[`ARENA_AGENT_${letter}_REASONING_EFFORT`] = "low";
  });
  return env;
}

const OFFLINE_ARGS = [
  "--match-id", "fake-five-cli",
  "--max-actions-per-agent", "40",
  "--decision-timeout-ms", "1000",
  "--total-wall-clock-ms", "40000",
  "--max-output-tokens", "64",
  "--slot-rotation-index", "2",
];

test("Direct CLI help exposes five configuration groups and new audit controls", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ARENA_AGENT_A/);
  assert.match(result.stdout, /A\.\.\.E/);
  assert.match(result.stdout, /MODEL_REVISION/);
  assert.match(result.stdout, /REASONING_EFFORT/);
  assert.match(result.stdout, /--total-wall-clock-ms/);
  assert.match(result.stdout, /--slot-rotation-index/);
  assert.match(result.stdout, /--completion-assisted/);
  assert.match(result.stdout, /--accept-assisted-probe/);
  assert.match(result.stdout, /--accept-assisted-stability/);
  assert.match(result.stdout, /--skip-assisted-stability/);
  assert.match(result.stdout, /--provider-time-budget-ms/);
  assert.match(result.stdout, /5 × 160 × 3 = 2400/);
  assert.match(result.stdout, /probe-summary\.json/);
  assert.match(result.stdout, /stability-summary\.json/);
});

test("assisted gate waivers require an explicit completion-assisted live match", t => {
  const { path } = createEnvFixture(t, providerLines(""));
  for (const flag of [
    "--accept-assisted-probe",
    "--accept-assisted-stability",
    "--skip-assisted-stability",
  ]) {
    const result = runCli([
      "--env-file", path,
      "--completion-assisted",
      flag,
      "--check-config",
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /只能与 --completion-assisted --confirm-live-run 同时使用/);
  }
});

test("explicit Assisted Probe waiver preserves a failed Probe and records it in the Match report", t => {
  const outputDir = mkdtempSync(join(tmpdir(), "arena-assisted-failed-probe-waiver-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const env = fakeProviderEnv();
  const assistedArgs = [
    "--completion-assisted",
    "--match-id", "fake-assisted-failed-probe-waiver",
    "--decision-timeout-ms", "1000",
    "--provider-time-budget-ms", "40000",
    "--max-output-tokens", "64",
    "--slot-rotation-index", "1",
  ];
  const probeRun = runCli(["--output-dir", outputDir, ...assistedArgs, "--probe-providers"], env);
  assert.equal(probeRun.status, 0, probeRun.stderr);
  const probePath = join(outputDir, "probe-summary.json");
  const probe = JSON.parse(readFileSync(probePath, "utf8"));
  probe.passed = false;
  probe.entries[0].passed = false;
  probe.entries[0].action = null;
  probe.entries[0].dailyPlanSelection = null;
  probe.entries[0].fault = {
    category: "incomplete",
    domain: "model",
    countsTowardModelFailure: true,
  };
  const { probeSummaryHash: _oldHash, ...probeBody } = probe;
  probe.probeSummaryHash = integrityHash(probeBody);
  writeFileSync(probePath, `${JSON.stringify(probe, null, 2)}\n`, "utf8");

  const blocked = runCli([
    "--output-dir", outputDir,
    ...assistedArgs,
    "--confirm-live-run",
    "--skip-assisted-stability",
  ], env);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /五组全部通过/);

  const match = runCli([
    "--output-dir", outputDir,
    ...assistedArgs,
    "--confirm-live-run",
    "--accept-assisted-probe",
    "--skip-assisted-stability",
  ], env);
  assert.equal(match.status, 0, match.stderr);
  assert.match(match.stderr, /Probe 失败豁免/);

  const preservedProbe = JSON.parse(readFileSync(probePath, "utf8"));
  const waiver = JSON.parse(readFileSync(join(outputDir, "probe-waiver.json"), "utf8"));
  const report = JSON.parse(readFileSync(join(outputDir, "run-report.json"), "utf8"));
  assert.equal(preservedProbe.passed, false);
  assert.equal(preservedProbe.probeSummaryHash, probe.probeSummaryHash);
  assert.equal(waiver.artifactType, "arena-probe-waiver-v1");
  assert.equal(waiver.disposition, "explicit-failed-probe-waiver");
  assert.equal(waiver.probeSummaryHash, probe.probeSummaryHash);
  assert.deepEqual(waiver.failedEntries.map(entry => entry.agentId), ["competitor-5"]);
  assert.equal(report.probe.summaryHash, probe.probeSummaryHash);
  assert.equal(report.probe.passed, false);
  assert.equal(report.probe.waiver.hash, waiver.waiverHash);
  assert.equal(report.probe.waiver.disposition, waiver.disposition);
});

test("completion-assisted config is explicit and reports its isolated budget and recovery track", t => {
  const { path } = createEnvFixture(t, providerLines(""));
  const result = runCli([
    "--env-file", path,
    "--completion-assisted",
    "--provider-time-budget-ms", "123456",
    "--check-config",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /运行轨: completion-assisted-v1/);
  assert.match(result.stdout, /Provider 请求与退避预算: 123456 ms/);
  assert.match(result.stdout, /2\/4\/8 日熔断/);
  assert.doesNotMatch(result.stdout, /每 Agent 总墙钟:/);
});

test("config check validates five normalized identities without requiring output", t => {
  const { path } = createEnvFixture(t, providerLines(""));
  const result = runCli([
    "--env-file", path,
    "--agent-e-model", "cli/model-e",
    "--slot-rotation-index", "4",
    "--check-config",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.stdout.match(/API Key: 已配置（不显示）/g) ?? []).length, 5);
  assert.match(result.stdout, /competitor-5, slot 3/);
  assert.match(result.stdout, /kimi \+ cli\/model-e/);
  assert.match(result.stdout, /每 Agent 总墙钟: 19200000 ms/);
  assert.equal((result.stdout.match(/Reasoning effort:/g) ?? []).length, 5);
  assert.equal(result.stdout.includes("输出目录:"), false);
  assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_SECRET), false);
});

test("total wall clock accepts an explicit override and rejects out-of-range values", t => {
  const { path } = createEnvFixture(t, providerLines(""));
  const valid = runCli(["--env-file", path, "--total-wall-clock-ms", "123456", "--check-config"]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /每 Agent 总墙钟: 123456 ms/);
  const invalid = runCli(["--env-file", path, "--total-wall-clock-ms", "0", "--check-config"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /total wall clock 必须是 1\.\.2147483647/);
});

test("path-like match IDs fail configuration validation before networking", t => {
  const { path } = createEnvFixture(t, providerLines(""));
  const result = runCli(["--env-file", path, "--match-id", "match/../../escape", "--check-config"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /matchId 只能包含/);
});

test("missing E, sixth groups and alias-normalized duplicates fail before networking", t => {
  const missingEffort = providerLines("").filter(
    line => !line.startsWith("ARENA_AGENT_A_REASONING_EFFORT="),
  );
  const { path: missingEffortPath } = createEnvFixture(t, missingEffort);
  const missingEffortResult = runCli(["--env-file", missingEffortPath, "--check-config"]);
  assert.equal(missingEffortResult.status, 1);
  assert.match(missingEffortResult.stderr, /配置 A.*REASONING_EFFORT/);

  const defaultEffortLines = providerLines("", { A: { reasoningEffort: "default" } });
  const { path: defaultEffortPath } = createEnvFixture(t, defaultEffortLines);
  const defaultEffortResult = runCli(["--env-file", defaultEffortPath, "--check-config"]);
  assert.equal(defaultEffortResult.status, 1);
  assert.match(defaultEffortResult.stderr, /配置 A.*REASONING_EFFORT.*不能为 default/);

  const missing = providerLines("").filter(line => !line.startsWith("ARENA_AGENT_E_PROVIDER="));
  const { path: missingPath } = createEnvFixture(t, missing);
  const missingResult = runCli(["--env-file", missingPath, "--check-config"]);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /配置 E.*PROVIDER/);

  const tooManyLines = [
    ...providerLines(""),
    "ARENA_AGENT_F_PROVIDER=openai-compatible",
    "ARENA_AGENT_F_BASE_URL=https://f.invalid/v1",
    `ARENA_AGENT_F_API_KEY=${TEST_SECRET}-f`,
    "ARENA_AGENT_F_MODEL=model-f",
  ];
  const { path: tooManyPath } = createEnvFixture(t, tooManyLines);
  const tooManyResult = runCli(["--env-file", tooManyPath, "--check-config"]);
  assert.equal(tooManyResult.status, 1);
  assert.match(tooManyResult.stderr, /只接受 ARENA_AGENT_A\.\.\.E/);
  assert.equal(`${tooManyResult.stdout}${tooManyResult.stderr}`.includes(TEST_SECRET), false);

  const duplicateLines = providerLines("", {
    A: { provider: "gpt", model: "same-model" },
    B: { provider: "openai", model: "same-model" },
  });
  const { path: duplicatePath } = createEnvFixture(t, duplicateLines);
  const duplicateResult = runCli(["--env-file", duplicatePath, "--check-config"]);
  assert.equal(duplicateResult.status, 1);
  assert.match(duplicateResult.stderr, /Provider \+ model.*互不重复/);
});

test("Probe modes require an output directory and remain mutually exclusive", t => {
  const { path } = createEnvFixture(t, providerLines(""));
  const missingOutput = runCli(["--env-file", path, "--probe-providers"]);
  assert.equal(missingOutput.status, 1);
  assert.match(missingOutput.stderr, /必须指定.*output-dir/);
  for (const conflict of ["--check-config", "--stability-probe", "--confirm-live-run"]) {
    const result = runCli(["--env-file", path, "--probe-providers", conflict]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /互斥/);
  }
});

test("wrapper build phase strips credentials including slot E", t => {
  const { directory, path } = createEnvFixture(t, providerLines(""));
  const fakeBin = join(directory, "fake-bin");
  mkdirSync(fakeBin);
  const fakeNpm = join(fakeBin, "npm");
  writeFileSync(fakeNpm, [
    "#!/bin/sh",
    "if [ -n \"$ARENA_AGENT_A_API_KEY$ARENA_AGENT_B_API_KEY$ARENA_AGENT_C_API_KEY$ARENA_AGENT_D_API_KEY$ARENA_AGENT_E_API_KEY\" ]; then",
    "  echo BUILD_RECEIVED_SECRET",
    "  exit 91",
    "fi",
    "echo BUILD_ENV_CLEAN",
    "exit 0",
    "",
  ].join("\n"), "utf8");
  chmodSync(fakeNpm, 0o755);
  const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` };
  for (const name of CONFIG_ENV_NAMES) delete env[name];
  const result = spawnSync(process.execPath, [
    wrapperPath.pathname, "--", "--env-file", path, "--check-config",
  ], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BUILD_ENV_CLEAN/);
  assert.equal(result.stdout.includes("BUILD_RECEIVED_SECRET"), false);
  assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_SECRET), false);
});

test("full match is blocked when matching passed Probe or Stability Probe is absent or stale", t => {
  const outputDir = mkdtempSync(join(tmpdir(), "arena-direct-gate-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const env = fakeProviderEnv();
  const absent = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--confirm-live-run"], env);
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /必须在同一输出目录完成 Provider Probe/);
  assert.equal(existsSync(join(outputDir, "replay.json")), false);

  const probe = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--probe-providers"], env);
  assert.equal(probe.status, 0, probe.stderr);
  const reprobe = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--probe-providers"], env);
  assert.equal(reprobe.status, 0, reprobe.stderr);
  assert.equal(existsSync(join(outputDir, "probe-summary.json.tmp")), false);
  const noStability = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--confirm-live-run"], env);
  assert.equal(noStability.status, 1);
  assert.match(noStability.stderr, /完成十步 Stability Probe/);
  const stability = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--stability-probe"], env);
  assert.equal(stability.status, 0, stability.stderr);
  assert.equal(existsSync(join(outputDir, "stability-summary.json.tmp")), false);
  const stabilityPath = join(outputDir, "stability-summary.json");
  const tamperedStability = JSON.parse(readFileSync(stabilityPath, "utf8"));
  tamperedStability.totals.validActions = 49;
  writeFileSync(stabilityPath, `${JSON.stringify(tamperedStability, null, 2)}\n`, "utf8");
  const tampered = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--confirm-live-run"], env);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /Stability Probe 摘要/);
  const restoredStability = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--stability-probe"], env);
  assert.equal(restoredStability.status, 0, restoredStability.stderr);
  const staleEnv = { ...env, ARENA_AGENT_E_MODEL: "changed-model" };
  const stale = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--confirm-live-run"], staleEnv);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /配置匹配/);
  assert.equal(existsSync(join(outputDir, "replay.json")), false);
});

test("explicit Assisted Stability skip writes failed evidence and waiver into the Match report", t => {
  const outputDir = mkdtempSync(join(tmpdir(), "arena-assisted-skip-stability-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const env = fakeProviderEnv();
  const assistedArgs = [
    "--completion-assisted",
    "--match-id", "fake-assisted-skip-stability",
    "--decision-timeout-ms", "1000",
    "--provider-time-budget-ms", "40000",
    "--max-output-tokens", "64",
    "--slot-rotation-index", "1",
  ];
  const probe = runCli(["--output-dir", outputDir, ...assistedArgs, "--probe-providers"], env);
  assert.equal(probe.status, 0, probe.stderr);

  const match = runCli([
    "--output-dir", outputDir,
    ...assistedArgs,
    "--confirm-live-run",
    "--skip-assisted-stability",
  ], env);
  assert.equal(match.status, 0, match.stderr);
  assert.match(match.stderr, /事实为未运行\/未通过/);

  const stability = JSON.parse(readFileSync(join(outputDir, "stability-summary.json"), "utf8"));
  const waiver = JSON.parse(readFileSync(join(outputDir, "stability-waiver.json"), "utf8"));
  const report = JSON.parse(readFileSync(join(outputDir, "run-report.json"), "utf8"));
  assert.equal(stability.artifactType, "arena-provider-stability-skipped-v1");
  assert.equal(stability.passed, false);
  assert.equal(stability.skipped, true);
  assert.equal(stability.reason, "explicit-user-authorization");
  assert.equal(waiver.artifactType, "arena-stability-waiver-v2");
  assert.equal(waiver.disposition, "explicit-skipped-stability-waiver");
  assert.equal(waiver.stabilitySummaryHash, stability.stabilitySummaryHash);
  assert.equal(report.artifactType, "arena-direct-run-report-v6");
  assert.equal(report.stability.summaryHash, stability.stabilitySummaryHash);
  assert.equal(report.stability.passed, false);
  assert.equal(report.stability.skipped, true);
  assert.equal(report.stability.waiver.hash, waiver.waiverHash);
  assert.equal(report.stability.waiver.disposition, waiver.disposition);
});

test("five Fake Providers complete Probe + Stability + Match and create the formal artifact set", t => {
  const outputDir = mkdtempSync(join(tmpdir(), "arena-direct-fake-five-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const env = fakeProviderEnv();
  const probeRun = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--probe-providers"], env);
  assert.equal(probeRun.status, 0, probeRun.stderr);
  const probe = JSON.parse(readFileSync(join(outputDir, "probe-summary.json"), "utf8"));
  assert.equal(probe.artifactType, "arena-provider-probe-v3");
  assert.equal(probe.requestCount, 5);
  assert.equal(probe.passed, true);

  const stabilityRun = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--stability-probe"], env);
  assert.equal(stabilityRun.status, 0, stabilityRun.stderr);
  const stability = JSON.parse(readFileSync(join(outputDir, "stability-summary.json"), "utf8"));
  assert.equal(stability.artifactType, "arena-provider-stability-v1");
  assert.equal(stability.passed, true);
  assert.equal(stability.actionTargetPerAgent, 10);
  assert.equal(stability.totals.validActions, 50);
  assert.ok(stability.entries.every(entry => entry.validActions === 10));

  const rotatedKeyEnv = { ...env, ARENA_AGENT_A_API_KEY: `${TEST_SECRET}-rotated-after-probe` };
  const matchRun = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, "--confirm-live-run"], rotatedKeyEnv);
  assert.equal(matchRun.status, 0, matchRun.stderr);
  assert.equal(`${matchRun.stdout}${matchRun.stderr}`.includes(TEST_SECRET), false);
  const progress = matchRun.stdout
    .split("\n")
    .filter(line => line.startsWith("[arena-progress] "))
    .map(line => JSON.parse(line.slice("[arena-progress] ".length)));
  assert.equal(progress.filter(event => event.event === "episode_started").length, 5);
  assert.equal(progress.filter(event => event.event === "episode_completed").length, 5);
  assert.ok(progress.some(event => event.event === "decision_started"));
  assert.ok(progress.some(event => event.event === "action_completed"));
  assert.equal(findPotentialSecrets(progress).length, 0);
  assert.equal(JSON.stringify(progress).includes("userContext"), false);
  for (const file of ["probe-summary.json", "stability-summary.json", "episode-traces.json", "replay.json", "run-report.json", "replay.html"]) {
    assert.equal(existsSync(join(outputDir, file)), true, `${file} missing`);
  }
  const replay = JSON.parse(readFileSync(join(outputDir, "replay.json"), "utf8"));
  const report = JSON.parse(readFileSync(join(outputDir, "run-report.json"), "utf8"));
  const traces = JSON.parse(readFileSync(join(outputDir, "episode-traces.json"), "utf8"));
  const html = readFileSync(join(outputDir, "replay.html"), "utf8");
  assert.equal(replay.schemaVersion, "arena-schema-v4");
  assert.equal(replay.metadata.executionMode, "direct");
  assert.equal(replay.metadata.agentCount, 5);
  assert.deepEqual(replay.competitionAudit.slotRotation.mappings.map(item => item.slot), [2, 3, 4, 0, 1]);
  assert.equal(traces.length, 5);
  assert.equal(report.artifactType, "arena-direct-run-report-v5");
  assert.equal(report.probe.summaryHash, probe.probeSummaryHash);
  assert.equal(report.stability.summaryHash, stability.stabilitySummaryHash);
  assert.equal(report.agents.length, 5);
  assert.ok(report.agents.every(agent => agent.requestCount > 0 && agent.requestCount <= 40));
  assert.ok(report.agents.every(agent => agent.modelCalls.every(call => call.actionEventIds.length === 1)));
  assert.ok(html.includes(replay.replayHash));
  assert.ok(html.includes("受控五模型展示赛"));
  assert.ok(replay.agents.every(agent => agent.displayName === undefined && agent.personaId === undefined));
  assert.equal(JSON.stringify(replay).includes('"personaId"'), false);
  assert.doesNotMatch(html, /最幸运|最倒霉|稳健铁算盘/);

  const rebuiltOne = join(outputDir, "replay-rebuilt-1.html");
  const rebuiltTwo = join(outputDir, "replay-rebuilt-2.html");
  for (const output of [rebuiltOne, rebuiltTwo]) {
    const rebuilt = spawnSync(process.execPath, [
      replayBuilderPath.pathname,
      "--input", join(outputDir, "replay.json"),
      "--output", output,
    ], { encoding: "utf8", env: { ...process.env, ...env } });
    assert.equal(rebuilt.status, 0, rebuilt.stderr);
  }
  assert.equal(readFileSync(rebuiltOne, "utf8"), readFileSync(rebuiltTwo, "utf8"));
  assert.equal(readFileSync(rebuiltOne, "utf8"), html);

  for (const file of [
    "probe-summary.json",
    "stability-summary.json",
    "episode-traces.json",
    "replay.json",
    "run-report.json",
    "replay.html",
    "replay-rebuilt-1.html",
    "replay-rebuilt-2.html",
  ]) {
    assert.equal(readFileSync(join(outputDir, file), "utf8").includes(TEST_SECRET), false, `${file} leaked secret`);
  }
});

test("formal replay builder rejects old schemas and four-model v4 before Web build", t => {
  const directory = mkdtempSync(join(tmpdir(), "arena-replay-reject-old-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cases = [
    {
      name: "v2",
      replay: { schemaVersion: "arena-schema-v2" },
      pattern: /只支持 arena-schema-v4/,
    },
    {
      name: "four-v4",
      replay: {
        schemaVersion: "arena-schema-v4",
        replayHash: `sha256:${"0".repeat(64)}`,
        factHash: `sha256:${"1".repeat(64)}`,
        metadata: { executionMode: "direct" },
        agents: Array.from({ length: 4 }, (_, slot) => ({ slot })),
        days: Array.from({ length: 40 }, (_, index) => ({ day: index + 1 })),
      },
      pattern: /必须包含五个 Agent/,
    },
  ];
  for (const item of cases) {
    const input = join(directory, `${item.name}.json`);
    writeFileSync(input, `${JSON.stringify(item.replay)}\n`, "utf8");
    const result = spawnSync(process.execPath, [replayBuilderPath.pathname, "--input", input], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, item.pattern);
  }
});

test("completed artifacts are protected from Probe and Match overwrite", t => {
  const outputDir = mkdtempSync(join(tmpdir(), "arena-direct-protect-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  writeFileSync(join(outputDir, "replay.html"), "must-not-overwrite\n", "utf8");
  const env = fakeProviderEnv();
  for (const mode of ["--probe-providers", "--stability-probe", "--confirm-live-run"]) {
    const result = runCli(["--output-dir", outputDir, ...OFFLINE_ARGS, mode], env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /已有比赛产物/);
  }
});
