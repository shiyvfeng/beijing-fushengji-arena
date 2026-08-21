#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  DEFAULT_DIRECT_AGENT_SPECS,
  DirectModelDriver,
} from "./arena/direct-driver.js";
import { runMatch } from "./arena/match-runner.js";
import { probeProviders } from "./arena/provider-probe.js";
import {
  createDirectProviderAdapter,
  normalizeAgentProviderConfig,
  type ArenaAgentProviderConfig,
} from "./arena/providers/provider-factory.js";
import { buildDirectRunReport } from "./arena/run-report.js";
import { DEFAULT_SCENARIO } from "./core/scenario.js";
import { findPotentialSecrets } from "./core/secret-scan.js";

const AGENT_LETTERS = ["A", "B", "C", "D"] as const;
const AGENT_COUNT = AGENT_LETTERS.length;
const DEFAULT_MAX_ACTIONS_PER_AGENT = 160;
const DEFAULT_DECISION_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 512;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ENV_FILE = join(REPOSITORY_ROOT, ".env");

const AGENT_MODEL_OPTIONS = [
  "--agent-a-model",
  "--agent-b-model",
  "--agent-c-model",
  "--agent-d-model",
] as const;

const AGENT_ENV_NAMES = AGENT_LETTERS.flatMap(letter => [
  `ARENA_AGENT_${letter}_PROVIDER`,
  `ARENA_AGENT_${letter}_BASE_URL`,
  `ARENA_AGENT_${letter}_API_KEY`,
  `ARENA_AGENT_${letter}_MODEL`,
  `ARENA_AGENT_${letter}_THINKING`,
]);

const ENV_FILE_ALLOWLIST = new Set<string>([
  ...AGENT_ENV_NAMES,
  "ARENA_OUTPUT_DIR",
  "ARENA_MATCH_ID",
  "ARENA_SEED",
  "ARENA_MAX_ACTIONS_PER_AGENT",
  "ARENA_DECISION_TIMEOUT_MS",
  "ARENA_MAX_OUTPUT_TOKENS",
]);

interface DirectCliOptions {
  readonly seed: number;
  readonly agents: readonly ArenaAgentProviderConfig[];
  readonly matchId: string;
  readonly outputDir?: string;
  readonly maxActionsPerAgent: number;
  readonly decisionTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly confirmLiveRun: boolean;
  readonly checkConfig: boolean;
  readonly probeProviders: boolean;
}

interface EnvFileSelection {
  readonly args: readonly string[];
  readonly path: string;
  readonly explicit: boolean;
}

interface ArtifactTargets {
  readonly replay: string;
  readonly traces: string;
  readonly report: string;
  readonly html: string;
}

function usage(): string {
  return [
    "北京浮生记 Arena · Multi-Provider Direct Model Runner",
    "",
    "用法：",
    "  npm run arena:direct -- --probe-providers",
    "  npm run arena:direct -- --output-dir <目录> --confirm-live-run",
    "",
    "每个 Agent 在 .env 中独立配置 Provider、端点、凭据与模型：",
    "  ARENA_AGENT_A_PROVIDER           gpt/openai、claude/anthropic、deepseek、qwen、kimi 或 openai-compatible",
    "  ARENA_AGENT_A_BASE_URL           API base URL；Runner 按 provider 追加正确 endpoint",
    "  ARENA_AGENT_A_API_KEY            仅从环境读取，不接受命令行参数",
    "  ARENA_AGENT_A_MODEL              该 Agent 使用的模型 ID",
    "  ARENA_AGENT_A_THINKING           可选：default/disabled/enabled；仅 DeepSeek，默认 disabled",
    "  Agent B/C/D 使用相同命名规则。",
    "",
    "协议映射：",
    "  gpt/openai → OpenAI Responses",
    "  claude/anthropic → Anthropic Messages",
    "  deepseek/qwen/kimi/openai-compatible → OpenAI-compatible Chat Completions",
    "",
    "可选：",
    "  --env-file <路径>                 默认读取仓库根目录 .env；显式指定后文件必须存在",
    "  --agent-a-model <模型 ID>         临时覆盖 Agent A 的模型（B/C/D 同理）",
    "  --output-dir <目录>               也可用 ARENA_OUTPUT_DIR",
    "  --match-id <ID>                   也可用 ARENA_MATCH_ID；默认 arena-direct-<seed>",
    "  --seed <整数>                     也可用 ARENA_SEED（默认 20260820）",
    "  --max-actions-per-agent <40..320> 也可用 ARENA_MAX_ACTIONS_PER_AGENT（默认 160）",
    "  --decision-timeout-ms <1..600000> 也可用 ARENA_DECISION_TIMEOUT_MS（默认 60000）",
    "  --max-output-tokens <16..4096>    也可用 ARENA_MAX_OUTPUT_TOKENS（默认 512）",
    "  --confirm-live-run                每次完整真实比赛都必须显式确认",
    "  --probe-providers                 恰好并行请求 A/B/C/D 各一次；不继续比赛、不写产物",
    "  --check-config                    显示脱敏配置，不联网、不写产物",
    "  --help                            显示帮助，不读取 .env、不发起请求",
    "",
    `默认最坏请求数：${AGENT_COUNT} × ${DEFAULT_MAX_ACTIONS_PER_AGENT} = ${AGENT_COUNT * DEFAULT_MAX_ACTIONS_PER_AGENT}。`,
    "Probe 与完整比赛都不自动重试；Provider、模型、计费与配额由调用者在运行前确认。",
  ].join("\n");
}

function readValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} 缺少值`);
  return value;
}

function extractEnvFile(args: readonly string[]): EnvFileSelection {
  const remaining: string[] = [];
  let selectedPath = DEFAULT_ENV_FILE;
  let explicit = false;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument !== "--env-file") {
      remaining.push(argument);
      continue;
    }
    if (explicit) throw new Error("--env-file 只能指定一次");
    selectedPath = resolve(readValue(args, index, argument));
    explicit = true;
    index++;
  }

  return { args: remaining, path: selectedPath, explicit };
}

function loadEnvFile(path: string, explicit: boolean): void {
  if (!existsSync(path)) {
    if (explicit) throw new Error("指定的 --env-file 不存在");
    return;
  }

  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    throw new Error("env 文件无法读取");
  }
  if (source.length > 1_048_576 || source.includes("\0")) {
    throw new Error("env 文件过大或包含无效字符");
  }

  let parsed: Record<string, string | undefined>;
  try {
    parsed = parseEnv(source.replace(/^\uFEFF/u, ""));
  } catch {
    throw new Error("env 文件格式无效");
  }

  for (const [name, value] of Object.entries(parsed)) {
    if (ENV_FILE_ALLOWLIST.has(name)
      && value !== undefined
      && process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

function parseInteger(value: string, option: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${option} 必须是 ${minimum}..${maximum} 的安全整数`);
  }
  return parsed;
}

function validatePublicIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/u.test(normalized)) {
    throw new Error(`${name} 格式无效`);
  }
  if (findPotentialSecrets({ value: normalized }).length > 0) {
    throw new Error(`${name} 疑似包含凭据，已拒绝`);
  }
  return normalized;
}

function validateOutputDirectory(value: string): string {
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error("输出目录格式无效");
  }
  const resolved = resolve(normalized);
  if (findPotentialSecrets({ value: resolved }).length > 0) {
    throw new Error("输出目录疑似包含凭据，已拒绝");
  }
  return resolved;
}

function parseArgs(args: readonly string[]): DirectCliOptions | null {
  const envInteger = (
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number => {
    const value = process.env[name]?.trim();
    return value ? parseInteger(value, name, minimum, maximum) : fallback;
  };

  let seed = envInteger(
    "ARENA_SEED",
    20_260_820,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  const agentCliModels = ["", "", "", ""];
  let matchId = process.env.ARENA_MATCH_ID?.trim() ?? "";
  let outputDir = process.env.ARENA_OUTPUT_DIR?.trim() ?? "";
  let maxActionsPerAgent = envInteger(
    "ARENA_MAX_ACTIONS_PER_AGENT",
    DEFAULT_MAX_ACTIONS_PER_AGENT,
    40,
    320,
  );
  let decisionTimeoutMs = envInteger(
    "ARENA_DECISION_TIMEOUT_MS",
    DEFAULT_DECISION_TIMEOUT_MS,
    1,
    600_000,
  );
  let maxOutputTokens = envInteger(
    "ARENA_MAX_OUTPUT_TOKENS",
    DEFAULT_MAX_OUTPUT_TOKENS,
    16,
    4_096,
  );
  let confirmLiveRun = false;
  let checkConfig = false;
  let probeProviderConnections = false;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return null;
    if (argument === "--confirm-live-run") {
      confirmLiveRun = true;
      continue;
    }
    if (argument === "--check-config") {
      checkConfig = true;
      continue;
    }
    if (argument === "--probe-providers") {
      probeProviderConnections = true;
      continue;
    }
    const agentModelIndex = AGENT_MODEL_OPTIONS.indexOf(
      argument as (typeof AGENT_MODEL_OPTIONS)[number],
    );
    if (agentModelIndex >= 0) {
      agentCliModels[agentModelIndex] = readValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--output-dir") {
      outputDir = readValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--match-id") {
      matchId = readValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--seed") {
      seed = parseInteger(readValue(args, index, argument), argument, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      index++;
      continue;
    }
    if (argument === "--max-actions-per-agent") {
      maxActionsPerAgent = parseInteger(readValue(args, index, argument), argument, 40, 320);
      index++;
      continue;
    }
    if (argument === "--decision-timeout-ms") {
      decisionTimeoutMs = parseInteger(readValue(args, index, argument), argument, 1, 600_000);
      index++;
      continue;
    }
    if (argument === "--max-output-tokens") {
      maxOutputTokens = parseInteger(readValue(args, index, argument), argument, 16, 4_096);
      index++;
      continue;
    }
    throw new Error("存在未知参数；请运行 --help 查看支持的选项");
  }

  const agents = AGENT_LETTERS.map((letter, slot) => {
    const prefix = `ARENA_AGENT_${letter}`;
    const provider = process.env[`${prefix}_PROVIDER`]?.trim() ?? "";
    const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim() ?? "";
    const apiKey = process.env[`${prefix}_API_KEY`]?.trim() ?? "";
    const thinkingMode = process.env[`${prefix}_THINKING`]?.trim();
    const rawModel = agentCliModels[slot].trim()
      || process.env[`${prefix}_MODEL`]?.trim()
      || "";
    if (!provider) throw new Error(`Agent ${letter} 缺少 ${prefix}_PROVIDER`);
    if (!baseUrl) throw new Error(`Agent ${letter} 缺少 ${prefix}_BASE_URL`);
    if (!rawModel) throw new Error(`Agent ${letter} 缺少 ${prefix}_MODEL`);
    if (/[\r\n\0]/u.test(apiKey)) throw new Error(`Agent ${letter} API Key 格式无效`);
    return normalizeAgentProviderConfig({
      provider,
      baseUrl,
      apiKey,
      model: validatePublicIdentifier(rawModel, `Agent ${letter} model`),
      maxOutputTokens,
      ...(thinkingMode ? { thinkingMode } : {}),
    });
  });

  if (probeProviderConnections && (confirmLiveRun || checkConfig)) {
    throw new Error("--probe-providers 与 --confirm-live-run、--check-config 互斥");
  }
  if (confirmLiveRun && checkConfig) {
    throw new Error("--confirm-live-run 与 --check-config 互斥");
  }
  if (!outputDir && !checkConfig && !probeProviderConnections) {
    throw new Error("完整比赛缺少 --output-dir 或 ARENA_OUTPUT_DIR");
  }
  const validatedOutputDir = outputDir ? validateOutputDirectory(outputDir) : undefined;
  matchId = validatePublicIdentifier(matchId || `arena-direct-${seed}`, "matchId");

  return {
    seed,
    agents,
    matchId,
    ...(validatedOutputDir ? { outputDir: validatedOutputDir } : {}),
    maxActionsPerAgent,
    decisionTimeoutMs,
    maxOutputTokens,
    confirmLiveRun,
    checkConfig,
    probeProviders: probeProviderConnections,
  };
}

function artifactTargets(outputDir: string): ArtifactTargets {
  return {
    replay: join(outputDir, "replay.json"),
    traces: join(outputDir, "episode-traces.json"),
    report: join(outputDir, "run-report.json"),
    html: join(outputDir, "replay.html"),
  };
}

function assertArtifactsDoNotExist(targets: ArtifactTargets): void {
  const existing = Object.values(targets).filter(path => existsSync(path));
  if (existing.length > 0) {
    throw new Error("输出目录已有 Arena 产物；为避免覆盖，请改用新目录");
  }
}

function prepareArtifactDirectory(outputDir: string, targets: ArtifactTargets): void {
  try {
    mkdirSync(outputDir, { recursive: true });
    accessSync(outputDir, constants.W_OK);
  } catch {
    throw new Error("输出目录无法创建或不可写；尚未发起模型请求");
  }
  assertArtifactsDoNotExist(targets);
}

function writeArtifacts(
  options: DirectCliOptions,
  output: Awaited<ReturnType<typeof runMatch>>,
  targets: ArtifactTargets,
): void {
  assertArtifactsDoNotExist(targets);
  const report = buildDirectRunReport({
    matchId: options.matchId,
    seed: options.seed,
    maxActionsPerAgent: options.maxActionsPerAgent,
    decisionTimeoutMs: options.decisionTimeoutMs,
    maxOutputTokens: options.maxOutputTokens,
  }, output);
  if (findPotentialSecrets(report).length > 0) {
    throw new Error("运行报告包含疑似凭据，已拒绝写入");
  }

  mkdirSync(dirname(targets.replay), { recursive: true });
  writeFileSync(targets.replay, `${JSON.stringify(output.replay, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  writeFileSync(targets.traces, `${JSON.stringify(output.traces, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  writeFileSync(targets.report, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function configurationSummary(options: DirectCliOptions): string {
  const agentLines = DEFAULT_DIRECT_AGENT_SPECS.flatMap((spec, index) => {
    const config = options.agents[index];
    return [
      `  Agent ${AGENT_LETTERS[index]} · ${spec.displayName}`,
      `    Provider: ${config.provider}`,
      `    Base URL: ${config.baseUrl}`,
      `    Model: ${config.model}`,
      ...(config.provider === "deepseek" ? [`    Thinking: ${config.thinkingMode}`] : []),
      `    API Key: ${config.apiKey ? "已配置（不显示）" : "未配置"}`,
    ];
  });
  return [
    "Direct 多 Provider 对局配置：",
    `  matchId: ${options.matchId}`,
    ...agentLines,
    ...(options.outputDir ? [`  输出目录: ${options.outputDir}`] : []),
    options.probeProviders
      ? `  本次 Provider Probe 请求: ${AGENT_COUNT}（每槽位恰好一次）`
      : `  最多模型请求: ${AGENT_COUNT * options.maxActionsPerAgent}`,
    `  单次决策时限: ${options.decisionTimeoutMs} ms`,
    `  单次输出上限: ${options.maxOutputTokens} tokens`,
    "  自动重试: 0",
  ].join("\n");
}

function createConfiguredDrivers(options: DirectCliOptions): DirectModelDriver[] {
  return DEFAULT_DIRECT_AGENT_SPECS.map((spec, slot) => {
    const provider = createDirectProviderAdapter(options.agents[slot]);
    return new DirectModelDriver({ ...spec, slot, provider });
  });
}

function buildOfflineReplay(targets: ArtifactTargets): void {
  const buildEnvironment = { ...process.env };
  for (const credentialName of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "DASHSCOPE_API_KEY",
    "MOONSHOT_API_KEY",
    "ARENA_AGENT_A_API_KEY",
    "ARENA_AGENT_B_API_KEY",
    "ARENA_AGENT_C_API_KEY",
    "ARENA_AGENT_D_API_KEY",
  ]) {
    delete buildEnvironment[credentialName];
  }
  const result = spawnSync(process.execPath, [
    join(REPOSITORY_ROOT, "scripts", "build-arena-replay.mjs"),
    "--input",
    targets.replay,
    "--output",
    targets.html,
  ], {
    cwd: REPOSITORY_ROOT,
    env: buildEnvironment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      "比赛 JSON/Trace/Report 已安全写入，但 replay.html 构建失败；可用 arena:replay 从现有 replay.json 重试",
    );
  }
}

async function main(): Promise<void> {
  const processArgs = process.argv.slice(2);
  const rawArgs = processArgs[0] === "--" ? processArgs.slice(1) : processArgs;
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const envFile = extractEnvFile(rawArgs);
  loadEnvFile(envFile.path, envFile.explicit);
  const options = parseArgs(envFile.args);
  if (options === null) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (options.checkConfig) {
    process.stdout.write(`${configurationSummary(options)}\n`);
    return;
  }

  const missingKeyAgents = options.agents
    .map((agent, index) => agent.apiKey ? "" : AGENT_LETTERS[index])
    .filter(Boolean);
  if (missingKeyAgents.length > 0) {
    throw new Error(`Agent ${missingKeyAgents.join("/")} 缺少独立 API Key`);
  }

  const drivers = createConfiguredDrivers(options);
  if (options.probeProviders) {
    process.stderr.write(`${configurationSummary(options)}\n\n`);
    const probe = await probeProviders({
      seed: options.seed,
      scenario: DEFAULT_SCENARIO,
      drivers,
      decisionTimeoutMs: options.decisionTimeoutMs,
    });
    process.stdout.write(`${JSON.stringify(probe, null, 2)}\n`);
    if (!probe.passed) throw new Error("Provider Probe 未全部通过；未启动完整比赛");
    return;
  }
  if (!options.confirmLiveRun) {
    throw new Error("在线 Direct 对局必须显式传入 --confirm-live-run");
  }
  if (!options.outputDir) {
    throw new Error("完整比赛缺少输出目录；尚未发起模型请求");
  }

  const targets = artifactTargets(options.outputDir);
  prepareArtifactDirectory(options.outputDir, targets);
  process.stderr.write(`${configurationSummary(options)}\n\n`);

  const output = await runMatch({
    matchId: options.matchId,
    seed: options.seed,
    scenario: DEFAULT_SCENARIO,
    drivers,
    maxActionsPerAgent: options.maxActionsPerAgent,
    decisionTimeoutMs: options.decisionTimeoutMs,
  });
  writeArtifacts(options, output, targets);
  buildOfflineReplay(targets);

  process.stdout.write(`Direct Arena 产物已写入：${options.outputDir}\n`);
  process.stdout.write(`离线页面：${targets.html}\n`);
  process.stdout.write(`Replay hash：${output.replay.replayHash}\n`);
  for (const report of output.report.episodeReports) {
    process.stdout.write(`- ${report.agentId}: ${report.status}, actions=${report.actionCount}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "未知错误";
  process.stderr.write(`Direct Arena Runner 失败：${message}\n`);
  process.exitCode = 1;
});
