import type {
  FaultDomain,
  ProviderReasoningEffort,
  ProviderThinkingMode,
  TechnicalFailureCategory,
  TechnicalFailureDetail,
} from "../core/contracts.js";
import { findPotentialSecrets } from "../core/secret-scan.js";
import { immutableClone, integrityHash } from "../core/stable-value.js";
import type { MatchRunOutput } from "./match-runner.js";
import type { ProviderProbeResult } from "./provider-probe.js";
import {
  DIRECT_CONTEXT_POLICY_VERSION,
  directAttemptTimeoutMs,
  DIRECT_MAX_ATTEMPTS_PER_DECISION,
  DIRECT_MAX_REPAIR_RETRIES_PER_DECISION,
  DIRECT_MAX_TRANSIENT_RETRIES_PER_DECISION,
  DIRECT_RECOVERY_POLICY_VERSION,
} from "./direct-context.js";
import {
  COMPLETION_ATTEMPT_TIMEOUT_MS,
  COMPLETION_CONTEXT_POLICY_VERSION,
  COMPLETION_MAX_ATTEMPTS_PER_DAY,
  COMPLETION_RECOVERY_POLICY_VERSION,
  COMPLETION_RUN_TRACK,
} from "./completion-assisted.js";

export const STABILITY_ACTION_TARGET = 10 as const;

export interface ProviderStabilityEntry {
  readonly agentId: string;
  readonly agentSlot: number;
  readonly provider: string;
  readonly model: string;
  readonly providerAdapterVersion: string;
  readonly providerThinkingMode?: ProviderThinkingMode;
  readonly providerReasoningEffort: ProviderReasoningEffort;
  readonly passed: boolean;
  readonly validActions: number;
  readonly autonomousDays?: number;
  readonly assistedDays?: number;
  readonly invalidActions: number;
  readonly recoveredDecisions: number;
  readonly requestCount: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly retryAttempts: number;
  readonly usageMissingRequests: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
  };
  readonly latencyMs: {
    readonly total: number;
    readonly minimum: number | null;
    readonly maximum: number | null;
    readonly average: number | null;
  };
  readonly errorCategories: Readonly<Partial<Record<TechnicalFailureCategory, number>>>;
  readonly faultDomains: Readonly<Partial<Record<FaultDomain, number>>>;
  readonly responseModelRevisions: readonly string[];
  readonly terminal: TechnicalFailureDetail | null;
}

export interface ProviderStabilityResult {
  readonly artifactType: "arena-provider-stability-v1" | "arena-provider-stability-v2";
  readonly runTrack?: typeof COMPLETION_RUN_TRACK;
  readonly matchId: string;
  readonly createdAt: string;
  readonly passed: boolean;
  readonly configFingerprint: string;
  readonly actionTargetPerAgent: typeof STABILITY_ACTION_TARGET;
  readonly autonomousDayTargetPerAgent?: typeof STABILITY_ACTION_TARGET;
  readonly contextPolicyVersion:
    | typeof DIRECT_CONTEXT_POLICY_VERSION
    | typeof COMPLETION_CONTEXT_POLICY_VERSION;
  readonly recoveryPolicyVersion:
    | typeof DIRECT_RECOVERY_POLICY_VERSION
    | typeof COMPLETION_RECOVERY_POLICY_VERSION;
  readonly maxAttemptsPerDecision:
    | typeof DIRECT_MAX_ATTEMPTS_PER_DECISION
    | typeof COMPLETION_MAX_ATTEMPTS_PER_DAY;
  readonly maxRepairRetriesPerDecision: typeof DIRECT_MAX_REPAIR_RETRIES_PER_DECISION;
  readonly maxTransientRetriesPerDecision: 1 | 2;
  readonly decisionTimeoutMs: number;
  readonly attemptTimeoutMs: number;
  readonly totalWallClockMsPerAgent: number;
  readonly probe: {
    readonly summaryHash: string;
    readonly createdAt: string;
  };
  readonly entries: readonly ProviderStabilityEntry[];
  readonly totals: {
    readonly validActions: number;
    readonly invalidActions: number;
    readonly recoveredDecisions: number;
    readonly requestCount: number;
    readonly failedRequests: number;
    readonly retryAttempts: number;
    readonly totalTokens: number;
  };
  readonly stabilitySummaryHash: string;
}

function countBy<T extends string>(values: readonly T[]): Readonly<Partial<Record<T, number>>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.freeze(counts);
}

export function buildProviderStabilityResult(
  output: MatchRunOutput,
  configFingerprint: string,
  probe: ProviderProbeResult,
  createdAt = new Date().toISOString(),
): ProviderStabilityResult {
  const assisted = output.replay.competitionAudit?.runTrack === COMPLETION_RUN_TRACK;
  if (output.report.executionMode !== "direct"
    || output.replay.matchId !== probe.matchId
    || output.replay.agents.length !== 5
    || output.report.episodeReports.length !== 5
    || (assisted
      ? output.replay.competitionAudit?.maxDailyDecisionsPerAgent !== STABILITY_ACTION_TARGET
      : output.replay.competitionAudit?.maxActionsPerAgent !== STABILITY_ACTION_TARGET)
    || (probe.runTrack === COMPLETION_RUN_TRACK) !== assisted
    || probe.configFingerprint !== configFingerprint
    || !probe.passed) {
    throw new Error("Stability Probe 输入与已通过的 Provider Probe 或十步配置不匹配");
  }
  const replayAgentById = new Map(output.replay.agents.map(agent => [agent.id, agent]));
  const audit = output.replay.competitionAudit;
  if (!audit) throw new Error("Stability Probe 缺少 competitionAudit");
  const entries = output.report.episodeReports.map(episode => {
    const agent = replayAgentById.get(episode.agentId);
    const metrics = episode.requestMetrics;
    if (!agent?.provider || !agent.model || !agent.providerAdapterVersion || !metrics) {
      throw new Error(`Stability Probe 缺少 ${episode.agentId} 的请求账本`);
    }
    const failures = metrics.calls.flatMap(call => call.failure ? [call.failure] : []);
    const revisions = [...new Set(metrics.calls
      .map(call => call.modelRevision.response)
      .filter((value): value is string => Boolean(value)))]
      .sort();
    const terminal = episode.technicalFailure ?? null;
    const passed = (assisted
      ? episode.reliability?.autonomousDays === STABILITY_ACTION_TARGET
        && episode.reliability.assistedDays === 0
      : episode.validActionCount === STABILITY_ACTION_TARGET)
      && episode.status === "tool_limit"
      && terminal?.category === "action_budget"
      && metrics.requestCount >= STABILITY_ACTION_TARGET
      && metrics.requestCount <= STABILITY_ACTION_TARGET * DIRECT_MAX_ATTEMPTS_PER_DECISION;
    return Object.freeze({
      agentId: episode.agentId,
      agentSlot: episode.agentSlot,
      provider: agent.provider,
      model: agent.model,
      providerAdapterVersion: agent.providerAdapterVersion,
      ...(agent.providerThinkingMode ? { providerThinkingMode: agent.providerThinkingMode } : {}),
      providerReasoningEffort: agent.providerReasoningEffort ?? "default",
      passed,
      validActions: episode.validActionCount,
      ...(assisted ? {
        autonomousDays: episode.reliability?.autonomousDays ?? 0,
        assistedDays: episode.reliability?.assistedDays ?? 0,
      } : {}),
      invalidActions: episode.invalidActionCount,
      recoveredDecisions: episode.recoveredDecisionCount,
      requestCount: metrics.requestCount,
      successfulRequests: metrics.successfulRequestCount,
      failedRequests: metrics.failedRequestCount,
      retryAttempts: metrics.retryAttemptCount,
      usageMissingRequests: metrics.requestCount - metrics.usageReportedRequestCount,
      tokens: Object.freeze({
        input: metrics.inputTokens,
        output: metrics.outputTokens,
        total: metrics.totalTokens,
      }),
      latencyMs: metrics.latencyMs,
      errorCategories: countBy(failures.map(failure => failure.category)),
      faultDomains: countBy(failures.map(failure => failure.domain)),
      responseModelRevisions: Object.freeze(revisions),
      terminal,
    });
  }).sort((a, b) => a.agentSlot - b.agentSlot);
  const totals = Object.freeze({
    validActions: entries.reduce((sum, entry) => sum + entry.validActions, 0),
    invalidActions: entries.reduce((sum, entry) => sum + entry.invalidActions, 0),
    recoveredDecisions: entries.reduce((sum, entry) => sum + entry.recoveredDecisions, 0),
    requestCount: entries.reduce((sum, entry) => sum + entry.requestCount, 0),
    failedRequests: entries.reduce((sum, entry) => sum + entry.failedRequests, 0),
    retryAttempts: entries.reduce((sum, entry) => sum + entry.retryAttempts, 0),
    totalTokens: entries.reduce((sum, entry) => sum + entry.tokens.total, 0),
  });
  const body = {
    artifactType: assisted
      ? "arena-provider-stability-v2" as const
      : "arena-provider-stability-v1" as const,
    ...(assisted ? { runTrack: COMPLETION_RUN_TRACK } : {}),
    matchId: output.replay.matchId,
    createdAt,
    passed: entries.every(entry => entry.passed),
    configFingerprint,
    actionTargetPerAgent: STABILITY_ACTION_TARGET,
    ...(assisted ? { autonomousDayTargetPerAgent: STABILITY_ACTION_TARGET } : {}),
    contextPolicyVersion: assisted
      ? COMPLETION_CONTEXT_POLICY_VERSION
      : DIRECT_CONTEXT_POLICY_VERSION,
    recoveryPolicyVersion: assisted
      ? COMPLETION_RECOVERY_POLICY_VERSION
      : DIRECT_RECOVERY_POLICY_VERSION,
    maxAttemptsPerDecision: assisted
      ? COMPLETION_MAX_ATTEMPTS_PER_DAY
      : DIRECT_MAX_ATTEMPTS_PER_DECISION,
    maxRepairRetriesPerDecision: DIRECT_MAX_REPAIR_RETRIES_PER_DECISION,
    maxTransientRetriesPerDecision: assisted ? 2 as const : DIRECT_MAX_TRANSIENT_RETRIES_PER_DECISION,
    decisionTimeoutMs: audit.decisionTimeoutMs,
    attemptTimeoutMs: audit.attemptTimeoutMs,
    totalWallClockMsPerAgent: audit.totalWallClockMsPerAgent,
    probe: Object.freeze({
      summaryHash: probe.probeSummaryHash,
      createdAt: probe.createdAt,
    }),
    entries: Object.freeze(entries),
    totals,
  };
  return immutableClone({
    ...body,
    stabilitySummaryHash: integrityHash(body),
  }) as ProviderStabilityResult;
}

export function assertMatchingProviderStability(
  value: unknown,
  configFingerprint: string,
  probe: ProviderProbeResult,
): asserts value is ProviderStabilityResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("stability-summary.json 结构无效");
  }
  const summary = value as Partial<ProviderStabilityResult>;
  const { stabilitySummaryHash, ...body } = summary;
  const entries = Array.isArray(summary.entries) ? summary.entries : [];
  const assisted = probe.runTrack === COMPLETION_RUN_TRACK;
  const ids = new Set(entries.map(entry => entry?.agentId));
  const slots = new Set(entries.map(entry => entry?.agentSlot));
  if (summary.artifactType !== (assisted
    ? "arena-provider-stability-v2"
    : "arena-provider-stability-v1")
    || (summary.runTrack === COMPLETION_RUN_TRACK) !== assisted
    || (!assisted && summary.runTrack !== undefined)
    || summary.matchId !== probe.matchId
    || summary.passed !== true
    || summary.configFingerprint !== configFingerprint
    || summary.actionTargetPerAgent !== STABILITY_ACTION_TARGET
    || (assisted && summary.autonomousDayTargetPerAgent !== STABILITY_ACTION_TARGET)
    || summary.contextPolicyVersion !== (assisted
      ? COMPLETION_CONTEXT_POLICY_VERSION
      : DIRECT_CONTEXT_POLICY_VERSION)
    || summary.recoveryPolicyVersion !== (assisted
      ? COMPLETION_RECOVERY_POLICY_VERSION
      : DIRECT_RECOVERY_POLICY_VERSION)
    || summary.maxAttemptsPerDecision !== (assisted
      ? COMPLETION_MAX_ATTEMPTS_PER_DAY
      : DIRECT_MAX_ATTEMPTS_PER_DECISION)
    || summary.maxRepairRetriesPerDecision !== DIRECT_MAX_REPAIR_RETRIES_PER_DECISION
    || summary.maxTransientRetriesPerDecision !== (assisted
      ? 2
      : DIRECT_MAX_TRANSIENT_RETRIES_PER_DECISION)
    || !Number.isSafeInteger(summary.decisionTimeoutMs)
    || Number(summary.decisionTimeoutMs) <= 0
    || summary.attemptTimeoutMs !== (assisted
      ? Number(summary.decisionTimeoutMs)
      : directAttemptTimeoutMs(Number(summary.decisionTimeoutMs)))
    || !Number.isSafeInteger(summary.totalWallClockMsPerAgent)
    || Number(summary.totalWallClockMsPerAgent) <= 0
    || summary.probe?.summaryHash !== probe.probeSummaryHash
    || summary.probe.createdAt !== probe.createdAt
    || typeof summary.createdAt !== "string"
    || Number.isNaN(Date.parse(summary.createdAt))
    || entries.length !== 5
    || entries.some(entry => !entry || entry.passed !== true
      || (assisted
        ? entry.autonomousDays !== STABILITY_ACTION_TARGET || entry.assistedDays !== 0
        : entry.validActions !== STABILITY_ACTION_TARGET)
      || entry.providerReasoningEffort === "default"
      || entry.requestCount < STABILITY_ACTION_TARGET
      || entry.requestCount > STABILITY_ACTION_TARGET * DIRECT_MAX_ATTEMPTS_PER_DECISION
      || entry.terminal?.category !== "action_budget")
    || ids.size !== 5
    || [...ids].sort().join("\0") !== [1, 2, 3, 4, 5].map(index => `competitor-${index}`).join("\0")
    || slots.size !== 5
    || [...slots].sort((a, b) => Number(a) - Number(b)).some((slot, index) => slot !== index)
    || !stabilitySummaryHash
    || !/^sha256:[0-9a-f]{64}$/u.test(stabilitySummaryHash)
    || integrityHash(body) !== stabilitySummaryHash
    || findPotentialSecrets(summary).length > 0) {
    throw new Error("缺少配置匹配且五组全部通过的十步 Stability Probe 摘要");
  }
}
