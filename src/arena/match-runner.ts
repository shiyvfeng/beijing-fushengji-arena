import type {
  ArenaExecutionMode,
  CompetitionAudit,
  EpisodeTrace,
  MatchReplay,
  ScenarioConfig,
} from "../core/contracts.js";
import { DEFAULT_SCENARIO } from "../core/scenario.js";
import { assembleMatchReplay } from "./replay.js";
import type { AgentDriver } from "./agent-driver.js";
import { runEpisode, type EpisodeRunReport } from "./episode-runner.js";
import { createSampleScriptedDrivers } from "./scripted-driver.js";

export interface MatchRunConfig {
  readonly matchId: string;
  readonly seed: number;
  readonly scenario: ScenarioConfig;
  readonly drivers: readonly AgentDriver[];
  readonly maxActionsPerAgent?: number;
  readonly resetTimeoutMs?: number;
  readonly decisionTimeoutMs?: number;
  readonly totalWallClockMs?: number;
  readonly slotRotationIndex?: number;
}

export interface MatchRunReport {
  readonly executionMode: ArenaExecutionMode;
  readonly competitionAudit?: CompetitionAudit;
  readonly episodeReports: readonly EpisodeRunReport[];
  readonly limitations: readonly string[];
}

export interface MatchRunOutput {
  readonly traces: readonly EpisodeTrace[];
  readonly replay: MatchReplay;
  readonly report: MatchRunReport;
}

function normalizedProviderIdentity(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "gpt": return "openai";
    case "claude": return "anthropic";
    case "dashscope": return "qwen";
    case "moonshot": return "kimi";
    case "openai-chat": return "openai-compatible";
    default: return value.trim().toLowerCase();
  }
}

function validateDrivers(drivers: readonly AgentDriver[]): ArenaExecutionMode {
  if (drivers.length === 0) throw new Error("Match 至少需要一个 AgentDriver");
  const slots = new Set<number>();
  const ids = new Set<string>();
  const driverKinds = new Set(drivers.map(driver => driver.descriptor.driver));
  if (driverKinds.has("mcp")) {
    throw new Error("Match Runner 尚未实现 MCP Host 执行，不能将 MCP 契约伪装成已执行");
  }
  if (driverKinds.size !== 1) {
    throw new Error("同一 Match 必须全部使用 scripted 或全部使用 direct，不能混合执行模式");
  }
  const executionMode = drivers[0].descriptor.driver;
  if (executionMode !== "scripted" && executionMode !== "direct") {
    throw new Error(`不支持的 Match 执行模式：${executionMode}`);
  }
  if (executionMode === "direct" && drivers.length !== 5) {
    throw new Error("Direct Match 必须恰好包含五个 Agent");
  }
  for (const [entryIndex, driver] of drivers.entries()) {
    const descriptor = driver.descriptor;
    if (slots.has(descriptor.slot) || ids.has(descriptor.id)) {
      throw new Error("AgentDriver 的 slot 和 ID 必须唯一");
    }
    if (!Number.isSafeInteger(descriptor.slot) || descriptor.slot < 0) {
      throw new Error("AgentDriver slot 必须为非负安全整数");
    }
    if (executionMode === "direct" && (
      !descriptor.provider?.trim()
      || !descriptor.model?.trim()
      || !descriptor.providerAdapterVersion?.trim()
      || !descriptor.providerReasoningEffort
      || descriptor.providerReasoningEffort === "default"
      || !descriptor.decisionPolicyId?.trim()
      || !/^sha256:[0-9a-f]{64}$/.test(descriptor.decisionPolicyHash ?? "")
      || !driver.competitionProfile
    )) {
      throw new Error(
        "Direct AgentDescriptor 必须声明 Provider、模型、适配器、显式思考等级和统一决策策略",
      );
    }
    if (executionMode === "direct" && (descriptor.displayName !== undefined
      || descriptor.personaId !== undefined)) {
      throw new Error("Direct AgentDescriptor 禁止 displayName、personaId 或策略身份");
    }
    if (executionMode === "direct" && descriptor.id !== `competitor-${entryIndex + 1}`) {
      throw new Error("Direct Match 内部 Agent ID 必须按配置顺序使用 competitor-1...5");
    }
    slots.add(descriptor.slot);
    ids.add(descriptor.id);
  }
  if (executionMode === "direct") {
    const sortedSlots = [...slots].sort((a, b) => a - b);
    if (sortedSlots.some((slot, index) => slot !== index)) {
      throw new Error("Direct Match 的 slot 必须连续覆盖 0..4");
    }
    const identities = new Set(drivers.map(driver => (
      `${normalizedProviderIdentity(driver.descriptor.provider!)}\0${driver.descriptor.model!.trim()}`
    )));
    if (identities.size !== 5) {
      throw new Error("Direct Match 的五个 Provider + model 组合必须互不重复");
    }
  }
  return executionMode;
}

function competitionAuditFor(
  config: MatchRunConfig,
  executionMode: ArenaExecutionMode,
): CompetitionAudit | undefined {
  if (executionMode !== "direct") return undefined;
  const profiles = config.drivers.map(driver => driver.competitionProfile!);
  const first = profiles[0];
  if (!profiles.every(profile => profile.decisionPolicyId === first.decisionPolicyId
    && profile.decisionPolicyHash === first.decisionPolicyHash
    && profile.modelObservationVersion === first.modelObservationVersion
    && profile.contextPolicyVersion === first.contextPolicyVersion
    && profile.samplingPolicyVersion === first.samplingPolicyVersion
    && profile.maxOutputTokensPerRequest === first.maxOutputTokensPerRequest)) {
    throw new Error("Direct Match 的五个 Agent 必须共享同一决策、上下文、采样策略和输出上限");
  }
  const rotationIndex = config.slotRotationIndex ?? 0;
  if (!Number.isSafeInteger(rotationIndex) || rotationIndex < 0 || rotationIndex > 4) {
    throw new Error("slotRotationIndex 必须为 0..4 的整数");
  }
  const mappings = config.drivers.map((driver, entryIndex) => {
    const expectedSlot = (entryIndex + rotationIndex) % 5;
    if (driver.descriptor.slot !== expectedSlot) {
      throw new Error("Direct Match slot 映射不符合 cyclic-v1");
    }
    return Object.freeze({ entryIndex, agentId: driver.descriptor.id, slot: expectedSlot });
  });
  const maxActions = config.maxActionsPerAgent ?? config.scenario.totalDays * 8;
  const decisionTimeoutMs = config.decisionTimeoutMs ?? 30_000;
  const totalWallClockMs = config.totalWallClockMs ?? maxActions * decisionTimeoutMs;
  return Object.freeze({
    fairnessClass: "controlled-exhibition",
    decisionPolicyId: first.decisionPolicyId,
    decisionPolicyHash: first.decisionPolicyHash,
    modelObservationVersion: first.modelObservationVersion,
    contextPolicyVersion: first.contextPolicyVersion,
    samplingPolicyVersion: first.samplingPolicyVersion,
    publicRandomization: "shared-seed",
    personalRandomization: "slot-isolated",
    slotRotation: Object.freeze({
      version: "cyclic-v1",
      rotationIndex,
      mappings: Object.freeze(mappings),
    }),
    maxActionsPerAgent: maxActions,
    decisionTimeoutMs,
    totalWallClockMsPerAgent: totalWallClockMs,
    maxOutputTokensPerRequest: first.maxOutputTokensPerRequest,
    automaticRetries: 0,
  });
}

function limitationsFor(executionMode: ArenaExecutionMode): readonly string[] {
  if (executionMode === "direct") {
    return Object.freeze([
      "本次对局经 DirectModelDriver 请求已配置的 Provider Adapter；Runner 不推断 Adapter 是在线模型还是测试替身。",
      "五个参赛者使用同一 neutral-v1 决策策略、full-history-v1 上下文与无身份模型观察；Provider、模型、slot 和审计 ID 不进入模型上下文。",
      "公共随机流共享 seed，个人随机事件按 cyclic-v1 轮换后的 slot 隔离，因此本场属于受控五模型展示赛。",
      "Provider/模型标识进入可验证 Replay；密钥、原始交换和系统指令正文不进入 Trace/Replay。",
      "采访、导演高光、奖项、结局和 MCP Host 不属于当前 Direct-only Arena 验收范围。",
    ]);
  }
  return Object.freeze([
    "本次金样只执行确定性 Scripted Agent，未调用真实模型。",
    "Scripted 产物只能通过显式 internal:arena:sample 流程生成，不代表 Direct Model 在线验收。",
    "StrictMcpEpisodePort 仅为接口占位；当前版本不实现也不宣称 MCP Host 能力。",
  ]);
}

export async function runMatch(config: MatchRunConfig): Promise<MatchRunOutput> {
  const executionMode = validateDrivers(config.drivers);
  const competitionAudit = competitionAuditFor(config, executionMode);
  const outputs = await Promise.all(config.drivers.map(driver => runEpisode({
    matchId: config.matchId,
    seed: config.seed,
    scenario: config.scenario,
    driver,
    ...(config.maxActionsPerAgent !== undefined ? { maxActions: config.maxActionsPerAgent } : {}),
    ...(config.resetTimeoutMs !== undefined ? { resetTimeoutMs: config.resetTimeoutMs } : {}),
    ...(config.decisionTimeoutMs !== undefined ? { decisionTimeoutMs: config.decisionTimeoutMs } : {}),
    ...(config.totalWallClockMs !== undefined ? { totalWallClockMs: config.totalWallClockMs } : {}),
  })));
  outputs.sort((a, b) => a.trace.agentSlot - b.trace.agentSlot);
  const traces = outputs.map(output => output.trace);
  const replay = assembleMatchReplay(
    config.matchId,
    traces,
    config.scenario,
    competitionAudit,
  );
  return {
    traces,
    replay,
    report: Object.freeze({
      executionMode,
      ...(competitionAudit ? { competitionAudit } : {}),
      episodeReports: outputs.map(output => output.report),
      limitations: limitationsFor(executionMode),
    }),
  };
}

export async function runSampleScriptedMatch(seed = 20_260_820): Promise<MatchRunOutput> {
  return runMatch({
    matchId: `arena-scripted-sample-${seed}`,
    seed,
    scenario: DEFAULT_SCENARIO,
    drivers: createSampleScriptedDrivers(),
  });
}
