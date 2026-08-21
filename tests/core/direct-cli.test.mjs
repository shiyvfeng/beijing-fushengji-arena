import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const cliPath = new URL("../../dist/arena-direct-cli.js", import.meta.url);
const wrapperPath = new URL("../../scripts/run-arena-direct.mjs", import.meta.url);
const fetchShimPath = new URL("./fixtures/direct-fetch-shim.mjs", import.meta.url);
const TEST_SECRET = "sk-cli-multi-secret-123456789";
const AGENT_LETTERS = ["A", "B", "C", "D"];
const CONFIG_ENV_NAMES = [
  ...AGENT_LETTERS.flatMap(letter => [
    `ARENA_AGENT_${letter}_PROVIDER`,
    `ARENA_AGENT_${letter}_BASE_URL`,
    `ARENA_AGENT_${letter}_API_KEY`,
    `ARENA_AGENT_${letter}_MODEL`,
    `ARENA_AGENT_${letter}_THINKING`,
  ]),
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
  "MOONSHOT_API_KEY",
  "ARENA_OUTPUT_DIR",
  "ARENA_MATCH_ID",
  "ARENA_SEED",
  "ARENA_MAX_ACTIONS_PER_AGENT",
  "ARENA_DECISION_TIMEOUT_MS",
  "ARENA_MAX_OUTPUT_TOKENS",
  "ARENA_CONFIRM_LIVE_RUN",
];

function runCli(args, extraEnv = {}) {
  const env = { ...process.env };
  for (const name of CONFIG_ENV_NAMES) delete env[name];
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [cliPath.pathname, "--", ...args], {
    encoding: "utf8",
    env,
  });
}

function createEnvFixture(t, lines) {
  const directory = mkdtempSync(join(tmpdir(), "arena-direct-multi-env-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, ".env");
  const resolvedLines = typeof lines === "function" ? lines(directory) : lines;
  writeFileSync(path, `${resolvedLines.join("\n")}\n`, "utf8");
  return { directory, path };
}

function providerLines(outputDir, overrides = {}) {
  const defaults = {
    A: { provider: "gpt", baseUrl: "https://api.openai.com/v1", apiKey: `${TEST_SECRET}-a`, model: "gpt-test" },
    B: { provider: "claude", baseUrl: "https://api.anthropic.com/v1", apiKey: `${TEST_SECRET}-b`, model: "claude-test" },
    C: { provider: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: `${TEST_SECRET}-c`, model: "deepseek-test", thinking: "disabled" },
    D: { provider: "kimi", baseUrl: "https://api.moonshot.cn/v1", apiKey: `${TEST_SECRET}-d`, model: "kimi-test" },
  };
  const lines = [];
  for (const letter of AGENT_LETTERS) {
    const config = { ...defaults[letter], ...(overrides[letter] ?? {}) };
    lines.push(
      `ARENA_AGENT_${letter}_PROVIDER=${config.provider}`,
      `ARENA_AGENT_${letter}_BASE_URL=${config.baseUrl}`,
      `ARENA_AGENT_${letter}_API_KEY=${config.apiKey}`,
      `ARENA_AGENT_${letter}_MODEL=${config.model}`,
    );
    if (config.thinking !== undefined) {
      lines.push(`ARENA_AGENT_${letter}_THINKING=${config.thinking}`);
    }
  }
  lines.push(`ARENA_OUTPUT_DIR=${outputDir}`);
  return lines;
}

test("Direct CLI help documents independent providers and hard request budget", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ARENA_AGENT_A_PROVIDER/);
  assert.match(result.stdout, /ARENA_AGENT_A_BASE_URL/);
  assert.match(result.stdout, /ARENA_AGENT_A_API_KEY/);
  assert.match(result.stdout, /ARENA_AGENT_A_THINKING/);
  assert.match(result.stdout, /gpt\/openai → OpenAI Responses/);
  assert.match(result.stdout, /claude\/anthropic → Anthropic Messages/);
  assert.match(result.stdout, /deepseek\/qwen\/kimi.*Chat Completions/);
  assert.match(result.stdout, /默认最坏请求数：4 × 160 = 640/);
  assert.match(result.stdout, /--confirm-live-run/);
  assert.match(result.stdout, /--probe-providers/);
  assert.match(result.stdout, /恰好并行请求 A\/B\/C\/D 各一次/);
});

test("config check does not require an output directory", t => {
  const { path } = createEnvFixture(t, providerLines("").filter(line => !line.startsWith("ARENA_OUTPUT_DIR=")));
  const result = runCli(["--env-file", path, "--check-config"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes("输出目录:"), false);
});

test("Provider Probe authorization is mutually exclusive with check and full-run confirmation", t => {
  const { path } = createEnvFixture(t, providerLines(""));
  for (const conflicting of ["--check-config", "--confirm-live-run"]) {
    const result = runCli(["--env-file", path, "--probe-providers", conflicting]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /互斥/);
    assert.equal(result.stderr.includes(TEST_SECRET), false);
  }
});

test("Direct CLI loads four independent provider configurations without networking", t => {
  const { path } = createEnvFixture(t, directory => [
    ...providerLines(join(directory, "unused")),
    "ARENA_MATCH_ID=multi-provider-check",
    "ARENA_SEED=31415",
    "ARENA_MAX_ACTIONS_PER_AGENT=40",
    "ARENA_DECISION_TIMEOUT_MS=12345",
    "ARENA_MAX_OUTPUT_TOKENS=256",
  ]);

  const result = runCli(["--env-file", path, "--check-config"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Agent A .*稳健铁算盘/);
  assert.match(result.stdout, /Provider: openai/);
  assert.match(result.stdout, /Base URL: https:\/\/api\.openai\.com\/v1/);
  assert.match(result.stdout, /Model: gpt-test/);
  assert.match(result.stdout, /Provider: anthropic/);
  assert.match(result.stdout, /Provider: deepseek/);
  assert.match(result.stdout, /Thinking: disabled/);
  assert.match(result.stdout, /Provider: kimi/);
  assert.match(result.stdout, /最多模型请求: 160/);
  assert.match(result.stdout, /单次决策时限: 12345 ms/);
  assert.match(result.stdout, /单次输出上限: 256 tokens/);
  assert.equal((result.stdout.match(/API Key: 已配置（不显示）/g) ?? []).length, 4);
  assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_SECRET), false);
});

test("Direct CLI rejects DeepSeek-only thinking modes on other providers", t => {
  const { path } = createEnvFixture(t, directory => providerLines(join(directory, "unused"), {
    D: { thinking: "enabled" },
  }));
  const result = runCli(["--env-file", path, "--check-config"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /仅支持 DeepSeek Provider/);
  assert.equal(result.stderr.includes(TEST_SECRET), false);
});

test("per-Agent model CLI override and parent environment take precedence over env file", t => {
  const { path } = createEnvFixture(t, directory => providerLines(join(directory, "unused")));
  const result = runCli([
    "--env-file", path,
    "--agent-d-model", "cli/kimi-model",
    "--check-config",
  ], {
    ARENA_AGENT_A_MODEL: "shell/gpt-model",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Model: shell\/gpt-model/);
  assert.match(result.stdout, /Model: cli\/kimi-model/);
  assert.equal(result.stdout.includes("gpt-test"), false);
  assert.equal(result.stdout.includes("kimi-test"), false);
});

test("wrapper builds without exposing any Agent API key", t => {
  const { directory, path } = createEnvFixture(t, envDirectory => providerLines(join(envDirectory, "unused")));
  const fakeBin = join(directory, "fake-bin");
  mkdirSync(fakeBin);
  const fakeNpm = join(fakeBin, "npm");
  writeFileSync(fakeNpm, [
    "#!/bin/sh",
    "if [ -n \"$ARENA_AGENT_A_API_KEY$ARENA_AGENT_B_API_KEY$ARENA_AGENT_C_API_KEY$ARENA_AGENT_D_API_KEY\" ]; then",
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
    wrapperPath.pathname,
    "--",
    "--env-file", path,
    "--check-config",
  ], { encoding: "utf8", env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BUILD_ENV_CLEAN/);
  assert.match(result.stdout, /Provider: openai/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_SECRET), false);
  assert.equal(result.stdout.includes("BUILD_RECEIVED_SECRET"), false);
});

test("Node dotenv syntax supports CRLF, export, quotes and comments", t => {
  const { path } = createEnvFixture(t, directory => providerLines(join(directory, "quoted output"), {
    A: { provider: "'gpt'", model: '"gpt-quoted" # comment' },
  }));
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replaceAll("\n", "\r\n"), "utf8");

  const result = runCli(["--env-file", path, "--check-config"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Model: gpt-quoted/);
  assert.match(result.stdout, /quoted output/);
});

test("an explicitly selected env file must exist", () => {
  const result = runCli([
    "--env-file", join(tmpdir(), "arena-direct-multi-definitely-missing.env"),
    "--check-config",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--env-file 不存在/);
});

test("Direct CLI requires all non-secret fields per Agent", t => {
  const { path } = createEnvFixture(t, directory => providerLines(join(directory, "unused"), {
    C: { baseUrl: "" },
  }));
  const result = runCli(["--env-file", path, "--check-config"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Agent C.*BASE_URL/);
  assert.equal(result.stderr.includes(TEST_SECRET), false);
});

test("Direct CLI cannot persist paid-run confirmation in env", t => {
  const { path } = createEnvFixture(t, directory => [
    ...providerLines(join(directory, "unused")),
    "ARENA_CONFIRM_LIVE_RUN=true",
  ]);
  const result = runCli(["--env-file", path]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--confirm-live-run/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_SECRET), false);
});

test("Direct CLI refuses a live run when any Agent API key is missing", t => {
  const { path } = createEnvFixture(t, directory => providerLines(join(directory, "unused"), {
    B: { apiKey: "" },
  }));
  const result = runCli(["--env-file", path, "--confirm-live-run"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Agent B 缺少独立 API Key/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_SECRET), false);
});

test("Direct CLI never echoes an unknown secret-like argument", t => {
  const { path } = createEnvFixture(t, directory => providerLines(join(directory, "unused")));
  const result = runCli(["--env-file", path, TEST_SECRET]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未知参数/);
  assert.equal(result.stderr.includes(TEST_SECRET), false);
});

test("Direct CLI rejects and never echoes a credential embedded in Base URL", t => {
  const { path } = createEnvFixture(t, directory => providerLines(join(directory, "unused"), {
    C: { baseUrl: `https://example.com/${TEST_SECRET}` },
  }));
  const result = runCli(["--env-file", path, "--check-config"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /baseUrl 疑似包含凭据/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_SECRET), false);
});

test("Direct CLI rejects an existing artifact before any live request", t => {
  const outputDir = mkdtempSync(join(tmpdir(), "arena-direct-multi-preflight-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  writeFileSync(join(outputDir, "replay.json"), "must-not-overwrite\n", "utf8");
  const { path } = createEnvFixture(t, providerLines(outputDir));

  const result = runCli(["--env-file", path, "--confirm-live-run"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /已有 Arena 产物/);
  assert.equal(result.stderr.includes(TEST_SECRET), false);
});

test("Direct CLI treats an existing replay.html as a protected Arena artifact", t => {
  const outputDir = mkdtempSync(join(tmpdir(), "arena-direct-html-preflight-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  writeFileSync(join(outputDir, "replay.html"), "must-not-overwrite\n", "utf8");
  const { path } = createEnvFixture(t, providerLines(outputDir));
  const result = runCli(["--env-file", path, "--confirm-live-run"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /已有 Arena 产物/);
});

test("Direct CLI writes JSON facts first and automatically packages an offline replay", t => {
  const outputDir = mkdtempSync(join(tmpdir(), "arena-direct-fake-full-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const providers = {
    A: ["deepseek", "https://a.invalid/v1", "model-a"],
    B: ["qwen", "https://b.invalid/v1", "model-b"],
    C: ["kimi", "https://c.invalid/v1", "model-c"],
    D: ["openai-compatible", "https://d.invalid/v1", "model-d"],
  };
  const env = {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fetchShimPath.href}`.trim(),
  };
  for (const [letter, [provider, baseUrl, model]] of Object.entries(providers)) {
    env[`ARENA_AGENT_${letter}_PROVIDER`] = provider;
    env[`ARENA_AGENT_${letter}_BASE_URL`] = baseUrl;
    env[`ARENA_AGENT_${letter}_API_KEY`] = `${TEST_SECRET}-${letter.toLowerCase()}`;
    env[`ARENA_AGENT_${letter}_MODEL`] = model;
    env[`ARENA_AGENT_${letter}_THINKING`] = provider === "deepseek" ? "disabled" : "default";
  }
  const result = runCli([
    "--output-dir", outputDir,
    "--match-id", "fake-full-cli",
    "--max-actions-per-agent", "40",
    "--decision-timeout-ms", "1000",
    "--max-output-tokens", "64",
    "--confirm-live-run",
  ], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_SECRET), false);
  const replay = JSON.parse(readFileSync(join(outputDir, "replay.json"), "utf8"));
  const report = JSON.parse(readFileSync(join(outputDir, "run-report.json"), "utf8"));
  const traces = JSON.parse(readFileSync(join(outputDir, "episode-traces.json"), "utf8"));
  const html = readFileSync(join(outputDir, "replay.html"), "utf8");
  assert.equal(replay.metadata.executionMode, "direct");
  assert.equal(replay.competitionAudit.decisionPolicyId, "neutral-v1");
  assert.deepEqual(replay.agents.map(agent => agent.model), ["model-a", "model-b", "model-c", "model-d"]);
  assert.equal(replay.agents[0].providerThinkingMode, "disabled");
  assert.ok(replay.agents.slice(1).every(agent => agent.providerThinkingMode === "default"));
  assert.equal(traces.length, 4);
  assert.equal(report.artifactType, "arena-direct-run-report-v3");
  assert.equal(report.agents.length, 4);
  assert.equal(report.agents[0].providerThinkingMode, "disabled");
  assert.ok(report.agents.every(agent => agent.requestCount > 0));
  assert.equal(report.cost.status, "unavailable");
  assert.ok(html.includes(replay.replayHash));
  assert.ok(html.includes("data-replay-hash-marker"));
  assert.doesNotMatch(html, /<script\b[^>]+src=/i);
  assert.doesNotMatch(html, /<link\b[^>]+rel=["']stylesheet["']/i);
});

test("an HTML build failure preserves completed Direct JSON artifacts for retry", t => {
  const outputDir = mkdtempSync(join(tmpdir(), "arena-direct-pack-failure-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const fakeBin = join(outputDir, "fake-bin");
  mkdirSync(fakeBin);
  const fakeNpm = join(fakeBin, "npm");
  writeFileSync(fakeNpm, "#!/bin/sh\nexit 73\n", "utf8");
  chmodSync(fakeNpm, 0o755);
  const env = {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fetchShimPath.href}`.trim(),
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
  };
  for (const letter of AGENT_LETTERS) {
    env[`ARENA_AGENT_${letter}_PROVIDER`] = "openai-compatible";
    env[`ARENA_AGENT_${letter}_BASE_URL`] = `https://${letter.toLowerCase()}.invalid/v1`;
    env[`ARENA_AGENT_${letter}_API_KEY`] = `${TEST_SECRET}-${letter.toLowerCase()}`;
    env[`ARENA_AGENT_${letter}_MODEL`] = `model-${letter.toLowerCase()}`;
    env[`ARENA_AGENT_${letter}_THINKING`] = "default";
  }
  const result = runCli([
    "--output-dir", outputDir,
    "--match-id", "fake-pack-failure",
    "--max-actions-per-agent", "40",
    "--decision-timeout-ms", "1000",
    "--max-output-tokens", "64",
    "--confirm-live-run",
  ], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON\/Trace\/Report 已安全写入/);
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(outputDir, "replay.json"), "utf8")));
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(outputDir, "episode-traces.json"), "utf8")));
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(outputDir, "run-report.json"), "utf8")));
  assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_SECRET), false);
});
