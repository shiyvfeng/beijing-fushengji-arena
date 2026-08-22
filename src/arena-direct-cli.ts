#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { RawExchangeRecorder } from "./arena/diagnostics.js";
import { createRawExchangeRecorder } from "./arena/diagnostics.js";
import { DEFAULT_DIRECT_AGENT_SPECS, DirectModelDriver } from "./arena/direct-driver.js";
import type { EpisodeProgressEvent } from "./arena/episode-runner.js";
import {
  COMPLETION_MAX_ATTEMPTS_PER_DAY,
  COMPLETION_PROVIDER_TIME_BUDGET_MS,
  COMPLETION_RUN_TRACK,
} from "./arena/completion-assisted.js";
import { runMatch } from "./arena/match-runner.js";
import {
  assertMatchingProviderProbe,
  computeProbeConfigFingerprint,
  probeProviders,
  type ProviderProbeResult,
} from "./arena/provider-probe.js";
import {
  createDirectProviderAdapter,
  normalizeAgentProviderConfig,
  type ArenaAgentProviderConfig,
} from "./arena/providers/provider-factory.js";
import { buildDirectRunReport } from "./arena/run-report.js";
import {
  assertMatchingProviderStability,
  buildProviderStabilityResult,
  STABILITY_ACTION_TARGET,
  type ProviderStabilityResult,
} from "./arena/stability-probe.js";
import { DEFAULT_SCENARIO } from "./core/scenario.js";
import { findPotentialSecrets } from "./core/secret-scan.js";
import { integrityHash } from "./core/stable-value.js";

const CONFIG_LETTERS = ["A", "B", "C", "D", "E"] as const;
const AGENT_COUNT = CONFIG_LETTERS.length;
const DEFAULT_MAX_ACTIONS_PER_AGENT = 160;
const DEFAULT_DECISION_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 512;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ENV_FILE = join(REPOSITORY_ROOT, ".env");
const DIAGNOSTICS_ROOT = join(REPOSITORY_ROOT, "dist", "arena-diagnostics");
const LIVE_PROGRESS_PREFIX = "[arena-progress] ";

const AGENT_MODEL_OPTIONS = CONFIG_LETTERS.map(letter => `--agent-${letter.toLowerCase()}-model`);
const AGENT_ENV_NAMES = CONFIG_LETTERS.flatMap(letter => [
  `ARENA_AGENT_${letter}_PROVIDER`,
  `ARENA_AGENT_${letter}_BASE_URL`,
  `ARENA_AGENT_${letter}_API_KEY`,
  `ARENA_AGENT_${letter}_MODEL`,
  `ARENA_AGENT_${letter}_MODEL_REVISION`,
  `ARENA_AGENT_${letter}_THINKING`,
  `ARENA_AGENT_${letter}_REASONING_EFFORT`,
]);
const ENV_FILE_ALLOWLIST = new Set<string>([
  ...AGENT_ENV_NAMES,
  "ARENA_OUTPUT_DIR",
  "ARENA_MATCH_ID",
  "ARENA_SEED",
  "ARENA_MAX_ACTIONS_PER_AGENT",
  "ARENA_DECISION_TIMEOUT_MS",
  "ARENA_TOTAL_WALL_CLOCK_MS",
  "ARENA_PROVIDER_TIME_BUDGET_MS",
  "ARENA_MAX_OUTPUT_TOKENS",
  "ARENA_SLOT_ROTATION_INDEX",
  "ARENA_SAVE_RAW_EXCHANGES",
]);

interface DirectCliOptions {
  readonly seed: number;
  readonly agents: readonly ArenaAgentProviderConfig[];
  readonly matchId: string;
  readonly outputDir?: string;
  readonly maxActionsPerAgent: number;
  readonly decisionTimeoutMs: number;
  readonly totalWallClockMs: number;
  readonly providerTimeBudgetMs: number;
  readonly maxOutputTokens: number;
  readonly slotRotationIndex: number;
  readonly saveRawExchanges: boolean;
  readonly confirmLiveRun: boolean;
  readonly checkConfig: boolean;
  readonly probeProviders: boolean;
  readonly stabilityProbe: boolean;
  readonly completionAssisted: boolean;
  readonly acceptAssistedStability: boolean;
}

interface EnvFileSelection {
  readonly args: readonly string[];
  readonly path: string;
  readonly explicit: boolean;
}

interface ArtifactTargets {
  readonly probe: string;
  readonly stability: string;
  readonly stabilityWaiver: string;
  readonly replay: string;
  readonly traces: string;
  readonly report: string;
  readonly html: string;
}

function usage(): string {
  return [
    "北京浮生记 Arena · 五模型 Direct Runner",
    "",
    "用法：",
    "  npm run arena:direct -- --probe-providers --output-dir <目录>",
    "  npm run arena:direct -- --stability-probe --output-dir <同一目录>",
    "  npm run arena:direct -- --output-dir <同一目录> --confirm-live-run",
    "",
    "必须配置 ARENA_AGENT_A...E 的 PROVIDER、BASE_URL、API_KEY、MODEL、REASONING_EFFORT。",
    "可选 MODEL_REVISION；DeepSeek 可额外配置 THINKING；凭据只从环境或 env 文件读取。",
    "",
    "可选参数：",
    "  --env-file <路径>",
    "  --agent-a-model <模型 ID>         A...E 均支持临时模型覆盖",
    "  --output-dir <目录>               Probe 与比赛均必须指定",
    "  --match-id <ID>",
    "  --seed <整数>",
    "  --max-actions-per-agent <40..320>",
    "  --decision-timeout-ms <1..600000>",
    "  --total-wall-clock-ms <1..2147483647>",
    "  --provider-time-budget-ms <1..2147483647>  Assisted 每 Agent 请求与退避预算",
    "  --max-output-tokens <16..4096>",
    "  --slot-rotation-index <0..4>",
    "  --completion-assisted             显式启用 completion-assisted-v1 独立轨道",
    "  --probe-providers                 五组并行各请求一次并原子写 probe-summary.json",
    "  --stability-probe                 五组并行各完成 10 个自主游戏日并写 stability-summary.json",
    "  --confirm-live-run                完整比赛必须显式确认并通过同目录 Probe + Stability 门禁",
    "  --accept-assisted-stability       仅 Assisted Match：保留失败事实并显式豁免已结算的辅助日",
    "  --check-config                    脱敏检查，不联网、不写产物",
    "  --help",
    "",
    `Strict 正式比赛理论最多请求：${AGENT_COUNT} × ${DEFAULT_MAX_ACTIONS_PER_AGENT} × 3 = ${AGENT_COUNT * DEFAULT_MAX_ACTIONS_PER_AGENT * 3}。`,
    `Completion-Assisted 正常约 ${AGENT_COUNT} × 40 = 200 次；失败日最多 ${COMPLETION_MAX_ATTEMPTS_PER_DAY} 次并受 45 分钟 Provider 预算约束。`,
    "正式比赛实时输出 arena-live-progress-v1 JSONL；只含脱敏事实与请求统计。",
    "ARENA_SAVE_RAW_EXCHANGES 默认为 false；开启后诊断只写 dist/arena-diagnostics。",
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
    if (name.startsWith("ARENA_AGENT_") && !ENV_FILE_ALLOWLIST.has(name)) {
      throw new Error("Direct Runner 只接受 ARENA_AGENT_A...E 的已知配置字段");
    }
    if (ENV_FILE_ALLOWLIST.has(name) && value !== undefined && process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

function rejectUnknownAgentEnvironment(): void {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("ARENA_AGENT_") && !ENV_FILE_ALLOWLIST.has(name)) {
      throw new Error("Direct Runner 只接受 ARENA_AGENT_A...E 的已知配置字段");
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

function parseBoolean(value: string | undefined, name: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} 仅支持 true/false、1/0、yes/no 或 on/off`);
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

function validateMatchId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized)) {
    throw new Error("matchId 只能包含字母、数字、点、下划线和连字符");
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
  rejectUnknownAgentEnvironment();
  const envInteger = (name: string, fallback: number, minimum: number, maximum: number): number => {
    const value = process.env[name]?.trim();
    return value ? parseInteger(value, name, minimum, maximum) : fallback;
  };
  let seed = envInteger("ARENA_SEED", 20_260_820, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const agentCliModels = new Array<string>(AGENT_COUNT).fill("");
  let matchId = process.env.ARENA_MATCH_ID?.trim() ?? "";
  let outputDir = process.env.ARENA_OUTPUT_DIR?.trim() ?? "";
  let maxActionsPerAgent = envInteger("ARENA_MAX_ACTIONS_PER_AGENT", DEFAULT_MAX_ACTIONS_PER_AGENT, 40, 320);
  let decisionTimeoutMs = envInteger("ARENA_DECISION_TIMEOUT_MS", DEFAULT_DECISION_TIMEOUT_MS, 1, 600_000);
  let totalWallClockOverride = process.env.ARENA_TOTAL_WALL_CLOCK_MS?.trim() ?? "";
  let providerTimeBudgetMs = envInteger(
    "ARENA_PROVIDER_TIME_BUDGET_MS",
    COMPLETION_PROVIDER_TIME_BUDGET_MS,
    1,
    2_147_483_647,
  );
  let maxOutputTokens = envInteger("ARENA_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS, 16, 4_096);
  let slotRotationIndex = envInteger("ARENA_SLOT_ROTATION_INDEX", 0, 0, 4);
  const saveRawExchanges = parseBoolean(process.env.ARENA_SAVE_RAW_EXCHANGES, "ARENA_SAVE_RAW_EXCHANGES");
  let confirmLiveRun = false;
  let checkConfig = false;
  let probeProviderConnections = false;
  let stabilityProbe = false;
  let completionAssisted = false;
  let acceptAssistedStability = false;

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
    if (argument === "--stability-probe") {
      stabilityProbe = true;
      continue;
    }
    if (argument === "--completion-assisted") {
      completionAssisted = true;
      continue;
    }
    if (argument === "--accept-assisted-stability") {
      acceptAssistedStability = true;
      continue;
    }
    const agentModelIndex = AGENT_MODEL_OPTIONS.indexOf(argument);
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
    if (argument === "--total-wall-clock-ms") {
      totalWallClockOverride = readValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--provider-time-budget-ms") {
      providerTimeBudgetMs = parseInteger(
        readValue(args, index, argument),
        argument,
        1,
        2_147_483_647,
      );
      index++;
      continue;
    }
    if (argument === "--max-output-tokens") {
      maxOutputTokens = parseInteger(readValue(args, index, argument), argument, 16, 4_096);
      index++;
      continue;
    }
    if (argument === "--slot-rotation-index") {
      slotRotationIndex = parseInteger(readValue(args, index, argument), argument, 0, 4);
      index++;
      continue;
    }
    throw new Error("存在未知参数；请运行 --help 查看支持的选项");
  }

  const totalWallClockMs = totalWallClockOverride
    ? parseInteger(totalWallClockOverride, "total wall clock", 1, 2_147_483_647)
    : maxActionsPerAgent * decisionTimeoutMs;
  const agents = CONFIG_LETTERS.map((letter, entryIndex) => {
    const prefix = `ARENA_AGENT_${letter}`;
    const provider = process.env[`${prefix}_PROVIDER`]?.trim() ?? "";
    const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim() ?? "";
    const apiKey = process.env[`${prefix}_API_KEY`]?.trim() ?? "";
    const thinkingMode = process.env[`${prefix}_THINKING`]?.trim();
    const reasoningEffort = process.env[`${prefix}_REASONING_EFFORT`]?.trim() ?? "";
    const modelRevision = process.env[`${prefix}_MODEL_REVISION`]?.trim();
    const rawModel = agentCliModels[entryIndex].trim() || process.env[`${prefix}_MODEL`]?.trim() || "";
    if (!provider) throw new Error(`配置 ${letter} 缺少 ${prefix}_PROVIDER`);
    if (!baseUrl) throw new Error(`配置 ${letter} 缺少 ${prefix}_BASE_URL`);
    if (!rawModel) throw new Error(`配置 ${letter} 缺少 ${prefix}_MODEL`);
    if (!reasoningEffort) throw new Error(`配置 ${letter} 缺少 ${prefix}_REASONING_EFFORT`);
    if (/[\r\n\0]/u.test(apiKey)) throw new Error(`配置 ${letter} API Key 格式无效`);
    return normalizeAgentProviderConfig({
      provider,
      baseUrl,
      apiKey,
      model: validatePublicIdentifier(rawModel, `配置 ${letter} model`),
      maxOutputTokens,
      reasoningEffort: validatePublicIdentifier(
        reasoningEffort,
        `配置 ${letter} reasoning effort`,
      ),
      ...(thinkingMode ? { thinkingMode } : {}),
      ...(modelRevision
        ? { modelRevision: validatePublicIdentifier(modelRevision, `配置 ${letter} model revision`) }
        : {}),
    });
  });
  const defaultEffortEntry = agents.findIndex(agent => agent.reasoningEffort === "default");
  if (defaultEffortEntry !== -1) {
    const letter = CONFIG_LETTERS[defaultEffortEntry];
    throw new Error(`配置 ${letter} 的 ARENA_AGENT_${letter}_REASONING_EFFORT 必须是显式等级，不能为 default`);
  }
  const identities = new Set(agents.map(agent => `${agent.provider}\0${agent.model.trim()}`));
  if (identities.size !== AGENT_COUNT) {
    throw new Error("归一化后的五个 Provider + model 组合必须互不重复");
  }
  const selectedModes = [probeProviderConnections, stabilityProbe, confirmLiveRun, checkConfig]
    .filter(Boolean).length;
  if (selectedModes > 1) {
    throw new Error("--probe-providers、--stability-probe、--confirm-live-run 与 --check-config 互斥");
  }
  if (acceptAssistedStability && (!completionAssisted || !confirmLiveRun)) {
    throw new Error("--accept-assisted-stability 只能与 --completion-assisted --confirm-live-run 同时使用");
  }
  if (!outputDir && !checkConfig) {
    throw new Error("Probe、Stability Probe 或完整比赛必须指定 --output-dir / ARENA_OUTPUT_DIR");
  }
  const validatedOutputDir = outputDir ? validateOutputDirectory(outputDir) : undefined;
  matchId = validateMatchId(matchId || (completionAssisted
    ? `arena-completion-assisted-${seed}`
    : `arena-direct-${seed}`));
  return {
    seed,
    agents,
    matchId,
    ...(validatedOutputDir ? { outputDir: validatedOutputDir } : {}),
    maxActionsPerAgent,
    decisionTimeoutMs,
    totalWallClockMs,
    providerTimeBudgetMs,
    maxOutputTokens,
    slotRotationIndex,
    saveRawExchanges,
    confirmLiveRun,
    checkConfig,
    probeProviders: probeProviderConnections,
    stabilityProbe,
    completionAssisted,
    acceptAssistedStability,
  };
}

function artifactTargets(outputDir: string): ArtifactTargets {
  return {
    probe: join(outputDir, "probe-summary.json"),
    stability: join(outputDir, "stability-summary.json"),
    stabilityWaiver: join(outputDir, "stability-waiver.json"),
    replay: join(outputDir, "replay.json"),
    traces: join(outputDir, "episode-traces.json"),
    report: join(outputDir, "run-report.json"),
    html: join(outputDir, "replay.html"),
  };
}

function completedArtifacts(targets: ArtifactTargets): string[] {
  return [targets.replay, targets.traces, targets.report, targets.html].filter(path => existsSync(path));
}

function prepareOutputDirectory(outputDir: string, targets: ArtifactTargets): void {
  try {
    mkdirSync(outputDir, { recursive: true });
    accessSync(outputDir, constants.W_OK);
  } catch {
    throw new Error("输出目录无法创建或不可写；尚未发起模型请求");
  }
  if (completedArtifacts(targets).length > 0) {
    throw new Error("输出目录已有比赛产物；为避免覆盖，不允许 Probe、Stability Probe 或比赛写入");
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

interface StabilityWaiverRecord {
  readonly artifactType: "arena-stability-waiver-v1";
  readonly runTrack: typeof COMPLETION_RUN_TRACK;
  readonly matchId: string;
  readonly createdAt: string;
  readonly scope: "match-gate-only";
  readonly disposition: "explicit-assisted-stability-waiver";
  readonly probeSummaryHash: string;
  readonly stabilitySummaryHash: string;
  readonly stabilityPassed: false;
  readonly failedEntries: readonly {
    readonly agentId: string;
    readonly provider: string;
    readonly model: string;
    readonly autonomousDays: number;
    readonly assistedDays: number;
  }[];
  readonly waiverHash: string;
}

function stabilityWaiverBody(
  stability: ProviderStabilityResult,
  probe: ProviderProbeResult,
  createdAt: string,
): Omit<StabilityWaiverRecord, "waiverHash"> {
  if (stability.runTrack !== COMPLETION_RUN_TRACK || stability.passed !== false) {
    throw new Error("Stability 豁免只适用于未通过的 completion-assisted-v1 摘要");
  }
  const failedEntries = stability.entries
    .filter(entry => !entry.passed)
    .map(entry => Object.freeze({
      agentId: entry.agentId,
      provider: entry.provider,
      model: entry.model,
      autonomousDays: entry.autonomousDays ?? 0,
      assistedDays: entry.assistedDays ?? 0,
    }));
  if (failedEntries.length === 0 || failedEntries.some(entry => entry.assistedDays <= 0)) {
    throw new Error("Stability 豁免要求失败项明确包含辅助日");
  }
  return {
    artifactType: "arena-stability-waiver-v1",
    runTrack: COMPLETION_RUN_TRACK,
    matchId: stability.matchId,
    createdAt,
    scope: "match-gate-only",
    disposition: "explicit-assisted-stability-waiver",
    probeSummaryHash: probe.probeSummaryHash,
    stabilitySummaryHash: stability.stabilitySummaryHash,
    stabilityPassed: false,
    failedEntries: Object.freeze(failedEntries),
  };
}

function writeOrVerifyStabilityWaiver(
  target: string,
  stability: ProviderStabilityResult,
  probe: ProviderProbeResult,
): StabilityWaiverRecord {
  const expectedEntries = stabilityWaiverBody(stability, probe, stability.createdAt).failedEntries;
  if (existsSync(target)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(target, "utf8")) as unknown;
    } catch {
      throw new Error("stability-waiver.json 无法读取或解析");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("stability-waiver.json 结构无效");
    }
    const waiver = parsed as Partial<StabilityWaiverRecord>;
    const { waiverHash, ...body } = waiver;
    if (waiver.artifactType !== "arena-stability-waiver-v1"
      || waiver.runTrack !== COMPLETION_RUN_TRACK
      || waiver.matchId !== stability.matchId
      || waiver.scope !== "match-gate-only"
      || waiver.disposition !== "explicit-assisted-stability-waiver"
      || waiver.probeSummaryHash !== probe.probeSummaryHash
      || waiver.stabilitySummaryHash !== stability.stabilitySummaryHash
      || waiver.stabilityPassed !== false
      || typeof waiver.createdAt !== "string"
      || Number.isNaN(Date.parse(waiver.createdAt))
      || integrityHash(waiver.failedEntries) !== integrityHash(expectedEntries)
      || typeof waiverHash !== "string"
      || integrityHash(body) !== waiverHash
      || findPotentialSecrets(waiver).length > 0) {
      throw new Error("stability-waiver.json 与当前 Probe/Stability 不匹配");
    }
    return waiver as StabilityWaiverRecord;
  }
  const body = stabilityWaiverBody(stability, probe, new Date().toISOString());
  const waiver = Object.freeze({ ...body, waiverHash: integrityHash(body) });
  if (findPotentialSecrets(waiver).length > 0) {
    throw new Error("Stability 豁免记录包含疑似凭据，已拒绝写入");
  }
  atomicWriteJson(target, waiver);
  return waiver;
}

function createConfiguredDrivers(
  options: DirectCliOptions,
  recorder?: RawExchangeRecorder,
): DirectModelDriver[] {
  return DEFAULT_DIRECT_AGENT_SPECS.map((spec, entryIndex) => {
    const slot = (entryIndex + options.slotRotationIndex) % AGENT_COUNT;
    const provider = createDirectProviderAdapter(options.agents[entryIndex], {
      ...(recorder ? { exchangeRecorder: recorder } : {}),
      completionAssisted: options.completionAssisted,
    });
    return new DirectModelDriver({
      id: spec.id,
      slot,
      provider,
      completionAssisted: options.completionAssisted,
    });
  });
}

function probeFingerprint(options: DirectCliOptions, drivers: readonly DirectModelDriver[]): string {
  return computeProbeConfigFingerprint({
    matchId: options.matchId,
    seed: options.seed,
    scenario: DEFAULT_SCENARIO,
    agents: drivers.map((driver, entryIndex) => ({
      entryIndex,
      provider: driver.descriptor.provider!,
      model: driver.descriptor.model!,
      providerAdapterVersion: driver.descriptor.providerAdapterVersion!,
      endpointFingerprint: integrityHash({
        provider: options.agents[entryIndex].provider,
        baseUrl: options.agents[entryIndex].baseUrl,
      }),
      declaredModelRevision: options.agents[entryIndex].modelRevision ?? null,
      thinkingMode: options.agents[entryIndex].thinkingMode,
      reasoningEffort: options.agents[entryIndex].reasoningEffort,
    })),
    maxActionsPerAgent: options.maxActionsPerAgent,
    decisionTimeoutMs: options.decisionTimeoutMs,
    totalWallClockMs: options.totalWallClockMs,
    maxOutputTokens: options.maxOutputTokens,
    slotRotationIndex: options.slotRotationIndex,
    completionAssisted: options.completionAssisted,
    providerTimeBudgetMs: options.providerTimeBudgetMs,
    maxDailyDecisionsPerAgent: DEFAULT_SCENARIO.totalDays,
  });
}

function configurationSummary(options: DirectCliOptions): string {
  const agentLines = options.agents.flatMap((config, index) => [
    `  本地配置 ${CONFIG_LETTERS[index]} → competitor-${index + 1}, slot ${(index + options.slotRotationIndex) % 5}`,
    `    Provider + Model: ${config.provider} + ${config.model}`,
    `    Base URL: ${config.baseUrl}`,
    ...(config.modelRevision ? [`    Model revision: ${config.modelRevision}`] : []),
    ...(config.provider === "deepseek" ? [`    Thinking: ${config.thinkingMode}`] : []),
    `    Reasoning effort: ${config.reasoningEffort}`,
    `    API Key: ${config.apiKey ? "已配置（不显示）" : "未配置"}`,
  ]);
  return [
    "Direct 五模型配置：",
    `  运行轨: ${options.completionAssisted ? COMPLETION_RUN_TRACK : "strict-direct-v1"}`,
    `  matchId: ${options.matchId}`,
    ...agentLines,
    ...(options.outputDir ? [`  输出目录: ${options.outputDir}`] : []),
    `  slot 轮换: cyclic-v1 / ${options.slotRotationIndex}`,
    `  单次决策时限: ${options.decisionTimeoutMs} ms`,
    `  单次尝试时限: ${options.completionAssisted
      ? options.decisionTimeoutMs
      : Math.max(1, Math.floor(options.decisionTimeoutMs / 2))} ms`,
    ...(options.completionAssisted
      ? [`  每 Agent Provider 请求与退避预算: ${options.providerTimeBudgetMs} ms`]
      : [`  每 Agent 总墙钟: ${options.totalWallClockMs} ms`]),
    `  单次输出上限: ${options.maxOutputTokens} tokens`,
    `  原始交换诊断: ${options.saveRawExchanges ? "开启" : "关闭"}`,
    ...(options.acceptAssistedStability
      ? ["  Stability 门禁: 显式接受已结算辅助日（失败事实不改写）"]
      : []),
    ...(options.saveRawExchanges
      ? [`  诊断目录: dist/arena-diagnostics/${options.matchId}/{probe,stability,match}`]
      : []),
    "  实时进度: arena-live-progress-v1 JSONL（仅脱敏事实字段）",
    options.completionAssisted
      ? "  恢复策略: completion-assisted-v1（每游戏日最多 3 次；15/45 秒退避；2/4/8 日熔断；显式辅助过日）"
      : "  恢复策略: bounded-retry-v2（每决策最多 3 次；修复重试 2 次；瞬态重试 1 次；携带脱敏具体反馈）",
  ].join("\n");
}

function writeLiveProgress(event: EpisodeProgressEvent): void {
  if (findPotentialSecrets(event).length > 0) {
    process.stderr.write("Arena 实时进度事件触发敏感信息守卫，已跳过该行。\n");
    return;
  }
  process.stdout.write(`${LIVE_PROGRESS_PREFIX}${JSON.stringify(event)}\n`);
}

function assertKeysConfigured(options: DirectCliOptions): void {
  const missing = options.agents
    .map((agent, index) => agent.apiKey ? "" : CONFIG_LETTERS[index])
    .filter(Boolean);
  if (missing.length) throw new Error(`配置 ${missing.join("/")} 缺少独立 API Key`);
}

function createRecorder(options: DirectCliOptions, phase: "probe" | "stability" | "match") {
  return createRawExchangeRecorder({
    enabled: options.saveRawExchanges,
    diagnosticsRoot: DIAGNOSTICS_ROOT,
    matchId: options.matchId,
    phase,
    secrets: options.agents.map(agent => agent.apiKey),
  });
}

function readMatchingProbe(
  targets: ArtifactTargets,
  fingerprint: string,
  completionAssisted: boolean,
): ProviderProbeResult {
  if (!existsSync(targets.probe)) {
    throw new Error("完整比赛前必须在同一输出目录完成 Provider Probe");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(targets.probe, "utf8")) as unknown;
  } catch {
    throw new Error("probe-summary.json 无法读取或解析");
  }
  assertMatchingProviderProbe(parsed, fingerprint, completionAssisted);
  return parsed;
}

function readMatchingStability(
  targets: ArtifactTargets,
  fingerprint: string,
  probe: ProviderProbeResult,
  allowAssistedDays: boolean,
): ProviderStabilityResult {
  if (!existsSync(targets.stability)) {
    throw new Error("完整比赛前必须在同一输出目录完成十步 Stability Probe");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(targets.stability, "utf8")) as unknown;
  } catch {
    throw new Error("stability-summary.json 无法读取或解析");
  }
  assertMatchingProviderStability(parsed, fingerprint, probe, { allowAssistedDays });
  return parsed;
}

function writeMatchArtifacts(
  options: DirectCliOptions,
  output: Awaited<ReturnType<typeof runMatch>>,
  probe: ProviderProbeResult,
  stability: ProviderStabilityResult,
  targets: ArtifactTargets,
): void {
  if (completedArtifacts(targets).length > 0) throw new Error("比赛产物已存在，拒绝覆盖");
  const report = buildDirectRunReport({
    matchId: options.matchId,
    seed: options.seed,
    maxActionsPerAgent: options.maxActionsPerAgent,
    decisionTimeoutMs: options.decisionTimeoutMs,
    totalWallClockMs: options.totalWallClockMs,
    maxOutputTokens: options.maxOutputTokens,
    completionAssisted: options.completionAssisted,
    ...(options.completionAssisted ? {
      maxDailyDecisionsPerAgent: DEFAULT_SCENARIO.totalDays,
      providerTimeBudgetMs: options.providerTimeBudgetMs,
    } : {}),
    probeSummaryHash: probe.probeSummaryHash,
    probeCreatedAt: probe.createdAt,
    stabilitySummaryHash: stability.stabilitySummaryHash,
    stabilityCreatedAt: stability.createdAt,
  }, output);
  for (const [label, artifact] of [["Replay", output.replay], ["Trace", output.traces], ["报告", report]] as const) {
    if (findPotentialSecrets(artifact).length > 0) throw new Error(`${label} 包含疑似凭据，已拒绝写入`);
  }
  writeFileSync(targets.replay, `${JSON.stringify(output.replay, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  writeFileSync(targets.traces, `${JSON.stringify(output.traces, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  writeFileSync(targets.report, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function buildOfflineReplay(targets: ArtifactTargets): void {
  const buildEnvironment = { ...process.env };
  for (const credentialName of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "DASHSCOPE_API_KEY",
    "MOONSHOT_API_KEY",
    ...CONFIG_LETTERS.map(letter => `ARENA_AGENT_${letter}_API_KEY`),
  ]) delete buildEnvironment[credentialName];
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
    throw new Error("比赛 JSON/Trace/Report 已写入，但 replay.html 构建失败；可离线重试 arena:replay");
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
  assertKeysConfigured(options);
  if (!options.outputDir) throw new Error("缺少输出目录");
  const targets = artifactTargets(options.outputDir);
  prepareOutputDirectory(options.outputDir, targets);
  process.stderr.write(`${configurationSummary(options)}\n\n`);

  if (options.probeProviders) {
    const recorder = createRecorder(options, "probe");
    const drivers = createConfiguredDrivers(options, recorder);
    const fingerprint = probeFingerprint(options, drivers);
    try {
      const summary = await probeProviders({
        matchId: options.matchId,
        seed: options.seed,
        scenario: DEFAULT_SCENARIO,
        drivers,
        decisionTimeoutMs: options.decisionTimeoutMs,
        slotRotationIndex: options.slotRotationIndex,
        configFingerprint: fingerprint,
        completionAssisted: options.completionAssisted,
      });
      if (findPotentialSecrets(summary).length > 0) {
        throw new Error("Probe 摘要包含疑似凭据，已拒绝写入");
      }
      await recorder?.flush();
      atomicWriteJson(targets.probe, summary);
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      if (!summary.passed) throw new Error("Provider Probe 未全部通过；未启动完整比赛");
    } finally {
      await recorder?.flush();
    }
    return;
  }

  if (options.stabilityProbe) {
    const gateDrivers = createConfiguredDrivers(options);
    const fingerprint = probeFingerprint(options, gateDrivers);
    const probe = readMatchingProbe(targets, fingerprint, options.completionAssisted);
    const recorder = createRecorder(options, "stability");
    const drivers = createConfiguredDrivers(options, recorder);
    let output: Awaited<ReturnType<typeof runMatch>>;
    try {
      output = await runMatch({
        matchId: options.matchId,
        seed: options.seed,
        scenario: DEFAULT_SCENARIO,
        drivers,
        ...(options.completionAssisted
          ? {
            completionAssisted: true,
            maxDailyDecisionsPerAgent: STABILITY_ACTION_TARGET,
            providerTimeBudgetMs: options.providerTimeBudgetMs,
          }
          : { maxActionsPerAgent: STABILITY_ACTION_TARGET }),
        decisionTimeoutMs: options.decisionTimeoutMs,
        ...(!options.completionAssisted ? {
          totalWallClockMs: Math.min(
            options.totalWallClockMs,
            STABILITY_ACTION_TARGET * options.decisionTimeoutMs,
          ),
        } : {}),
        slotRotationIndex: options.slotRotationIndex,
        onProgress: writeLiveProgress,
      });
      const summary = buildProviderStabilityResult(output, fingerprint, probe);
      if (findPotentialSecrets(summary).length > 0) {
        throw new Error("Stability Probe 摘要包含疑似凭据，已拒绝写入");
      }
      await recorder?.flush();
      atomicWriteJson(targets.stability, summary);
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      if (!summary.passed) throw new Error("十步 Stability Probe 未全部通过；未启动完整比赛");
    } finally {
      await recorder?.flush();
    }
    return;
  }

  if (!options.confirmLiveRun) throw new Error("在线 Direct 对局必须显式传入 --confirm-live-run");
  const gateDrivers = createConfiguredDrivers(options);
  const fingerprint = probeFingerprint(options, gateDrivers);
  const probe = readMatchingProbe(targets, fingerprint, options.completionAssisted);
  const stability = readMatchingStability(
    targets,
    fingerprint,
    probe,
    options.acceptAssistedStability,
  );
  if (options.acceptAssistedStability) {
    const waiver = writeOrVerifyStabilityWaiver(targets.stabilityWaiver, stability, probe);
    process.stderr.write(
      `已记录 Stability 辅助日豁免（事实仍为未通过）：${waiver.waiverHash}\n`,
    );
  }
  const recorder = createRecorder(options, "match");
  const drivers = createConfiguredDrivers(options, recorder);
  let output: Awaited<ReturnType<typeof runMatch>>;
  try {
    output = await runMatch({
      matchId: options.matchId,
      seed: options.seed,
      scenario: DEFAULT_SCENARIO,
      drivers,
      decisionTimeoutMs: options.decisionTimeoutMs,
      ...(options.completionAssisted ? {
        completionAssisted: true,
        maxDailyDecisionsPerAgent: DEFAULT_SCENARIO.totalDays,
        providerTimeBudgetMs: options.providerTimeBudgetMs,
      } : {
        maxActionsPerAgent: options.maxActionsPerAgent,
        totalWallClockMs: options.totalWallClockMs,
      }),
      slotRotationIndex: options.slotRotationIndex,
      onProgress: writeLiveProgress,
    });
  } finally {
    await recorder?.flush();
  }
  writeMatchArtifacts(options, output, probe, stability, targets);
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
