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
  for (const driver of drivers) {
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
      || !descriptor.personaId?.trim()
      || !descriptor.decisionPolicyId?.trim()
      || !/^sha256:[0-9a-f]{64}$/.test(descriptor.decisionPolicyHash ?? "")
      || !driver.competitionProfile
    )) {
      throw new Error(
        "Direct AgentDescriptor 必须声明展示身份、Provider、模型、适配器和统一决策策略",
      );
    }
    slots.add(descriptor.slot);
    ids.add(descriptor.id);
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
    && profile.maxOutputTokensPerRequest === first.maxOutputTokensPerRequest)) {
    throw new Error("Direct Match 的四个 Agent 必须共享同一决策策略、观察版本和输出上限");
  }
  return Object.freeze({
    fairnessClass: "controlled-exhibition",
    decisionPolicyId: first.decisionPolicyId,
    decisionPolicyHash: first.decisionPolicyHash,
    modelObservationVersion: first.modelObservationVersion,
    publicRandomization: "shared-seed",
    personalRandomization: "slot-isolated",
    maxActionsPerAgent: config.maxActionsPerAgent ?? config.scenario.totalDays * 8,
    decisionTimeoutMs: config.decisionTimeoutMs ?? 30_000,
    maxOutputTokensPerRequest: first.maxOutputTokensPerRequest,
    automaticRetries: 0,
  });
}

function limitationsFor(executionMode: ArenaExecutionMode): readonly string[] {
  if (executionMode === "direct") {
    return Object.freeze([
      "本次对局经 DirectModelDriver 请求已配置的 Provider Adapter；Runner 不推断 Adapter 是在线模型还是测试替身。",
      "四个槽位使用同一 neutral-v1 决策策略与无身份模型观察；展示身份和审计身份不进入模型请求。",
      "公共随机流共享 seed，个人随机事件仍按槽位隔离，因此本场属于受控四模型展示赛。",
      "Provider/模型标识进入可验证 Replay；密钥、原始响应和系统指令正文不进入 Trace/Replay。",
      "采访、导演高光、奖项、结局和 MCP Host 不属于当前 Direct-only Arena 验收范围。",
    ]);
  }
  return Object.freeze([
    "本次金样只执行确定性 Scripted Agent，未调用真实模型。",
    "Scripted 金样只能通过显式 arena:sample 流程生成，不代表 Direct Model 在线验收。",
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
