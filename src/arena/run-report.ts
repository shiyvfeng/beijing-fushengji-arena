import type {
  FaultDomain,
  ProviderReasoningEffort,
  ProviderThinkingMode,
  TechnicalFailureCategory,
  TechnicalFailureDetail,
} from "../core/contracts.js";
import type { ArenaModelCallAudit } from "./agent-driver.js";
import type { MatchRunOutput } from "./match-runner.js";

export interface LatencyStatistics {
  readonly samples: number;
  readonly totalMs: number;
  readonly minimumMs: number | null;
  readonly maximumMs: number | null;
  readonly averageMs: number | null;
}

export interface ArenaRunAgentReport {
  readonly agentId: string;
  readonly agentSlot: number;
  readonly provider: string;
  readonly model: string;
  readonly providerAdapterVersion: string;
  readonly providerThinkingMode?: ProviderThinkingMode;
  readonly providerReasoningEffort?: ProviderReasoningEffort;
  readonly requestCount: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly timedOutRequests: number;
  readonly retryAttempts: number;
  readonly recoveredDecisions: number;
  readonly validActions: number;
  readonly invalidActions: number;
  readonly dnf: boolean;
  readonly exitDay: number;
  readonly status: string;
  readonly technicalFailure: TechnicalFailureDetail | null;
  readonly countsTowardModelFailure: boolean;
  readonly errorCategories: Readonly<Partial<Record<TechnicalFailureCategory, number>>>;
  readonly faultDomains: Readonly<Partial<Record<FaultDomain, number>>>;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
    readonly requestsWithoutUsage: number;
  };
  readonly latency: LatencyStatistics;
  readonly modelCalls: readonly ArenaModelCallAudit[];
}

export interface ArenaDirectRunReport {
  readonly artifactType: "arena-direct-run-report-v5";
  readonly executionMode: "direct";
  readonly matchId: string;
  readonly seed: number;
  readonly replayHash: string;
  readonly probe: {
    readonly summaryHash: string;
    readonly createdAt: string;
  };
  readonly stability: {
    readonly summaryHash: string;
    readonly createdAt: string;
    readonly actionTargetPerAgent: 10;
  };
  readonly competitionAudit: NonNullable<MatchRunOutput["replay"]["competitionAudit"]>;
  readonly limits: {
    readonly agents: 5;
    readonly maxActionsPerAgent: number;
    readonly maxModelRequests: number;
    readonly decisionTimeoutMs: number;
    readonly attemptTimeoutMs: number;
    readonly totalWallClockMsPerAgent: number;
    readonly maxOutputTokensPerRequest: number;
    readonly maxAttemptsPerDecision: 3;
    readonly maxRepairRetriesPerDecision: 2;
    readonly maxTransientRetriesPerDecision: 1;
    readonly automaticRetries: 2;
  };
  readonly totals: {
    readonly requestCount: number;
    readonly successfulRequests: number;
    readonly failedRequests: number;
    readonly timedOutRequests: number;
    readonly retryAttempts: number;
    readonly recoveredDecisions: number;
    readonly validActions: number;
    readonly invalidActions: number;
    readonly dnfAgents: number;
    readonly modelFailureAgents: number;
    readonly errorCategories: Readonly<Partial<Record<TechnicalFailureCategory, number>>>;
    readonly faultDomains: Readonly<Partial<Record<FaultDomain, number>>>;
    readonly tokens: {
      readonly input: number;
      readonly output: number;
      readonly total: number;
      readonly requestsWithoutUsage: number;
    };
    readonly latency: LatencyStatistics;
  };
  readonly agents: readonly ArenaRunAgentReport[];
  readonly cost: {
    readonly status: "unavailable";
    readonly reason: "provider-pricing-not-estimated";
  };
  readonly limitations: readonly string[];
}

interface RunReportOptions {
  readonly matchId: string;
  readonly seed: number;
  readonly maxActionsPerAgent: number;
  readonly decisionTimeoutMs: number;
  readonly totalWallClockMs: number;
  readonly maxOutputTokens: number;
  readonly probeSummaryHash: string;
  readonly probeCreatedAt: string;
  readonly stabilitySummaryHash: string;
  readonly stabilityCreatedAt: string;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function countBy<T extends string>(values: readonly T[]): Readonly<Partial<Record<T, number>>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.freeze(counts);
}

function mergeCounts<T extends string>(
  values: readonly Readonly<Partial<Record<T, number>>>[],
): Readonly<Partial<Record<T, number>>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) {
    for (const [key, count] of Object.entries(value) as [T, number][]) {
      counts[key] = (counts[key] ?? 0) + count;
    }
  }
  return Object.freeze(counts);
}

function latencyFor(calls: readonly ArenaModelCallAudit[]): LatencyStatistics {
  const values = calls.map(call => call.latencyMs);
  const totalMs = rounded(values.reduce((sum, value) => sum + value, 0));
  return Object.freeze({
    samples: values.length,
    totalMs,
    minimumMs: values.length ? Math.min(...values) : null,
    maximumMs: values.length ? Math.max(...values) : null,
    averageMs: values.length ? rounded(totalMs / values.length) : null,
  });
}

function verifyCallLinks(
  agentId: string,
  calls: readonly ArenaModelCallAudit[],
  output: MatchRunOutput,
): void {
  const trace = output.traces.find(item => item.agentId === agentId);
  if (!trace) throw new Error(`缺少 Agent ${agentId} 的 Trace`);
  const events = new Map(trace.events.map(event => [event.id, event]));
  for (const call of calls) {
    const links = [call.actionEventId, call.terminationEventId, call.retryReason].filter(Boolean);
    if (links.length !== 1) {
      throw new Error(`modelCallId ${call.modelCallId} 必须恰好关联一个 action、technical termination 或 retry`);
    }
    if (call.retryReason) {
      if (call.status !== "failed"
        || call.failure?.category !== call.retryReason
        || call.attemptIndex >= 2) {
        throw new Error(`modelCallId ${call.modelCallId} 的 retry 证据无效`);
      }
      continue;
    }
    const eventId = call.actionEventId ?? call.terminationEventId;
    const event = eventId ? events.get(eventId) : undefined;
    if (!event
      || event.modelCallId !== call.modelCallId
      || event.fullContextHash !== call.fullContextHash
      || event.observationHash !== call.observationHash) {
      throw new Error(`modelCallId ${call.modelCallId} 的 Trace 证据无法对账`);
    }
    if ((call.actionEventId && event.type !== "action")
      || (call.terminationEventId && event.type !== "technical_termination")) {
      throw new Error(`modelCallId ${call.modelCallId} 的事件类型不匹配`);
    }
  }
}

export function buildDirectRunReport(
  options: RunReportOptions,
  output: MatchRunOutput,
): ArenaDirectRunReport {
  if (output.report.executionMode !== "direct" || !output.replay.competitionAudit) {
    throw new Error("只能为 Direct Match 生成 Direct run-report");
  }
  if (output.replay.agents.length !== 5) throw new Error("Direct run-report 必须包含五个 Agent");
  const audit = output.replay.competitionAudit;
  if (options.matchId !== output.replay.matchId
    || options.seed !== output.replay.seed
    || options.maxActionsPerAgent !== audit.maxActionsPerAgent
    || options.decisionTimeoutMs !== audit.decisionTimeoutMs
    || options.totalWallClockMs !== audit.totalWallClockMsPerAgent
    || options.maxOutputTokens !== audit.maxOutputTokensPerRequest) {
    throw new Error("Direct run-report 配置与 Replay competitionAudit 不一致");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(options.probeSummaryHash)
    || Number.isNaN(Date.parse(options.probeCreatedAt))
    || !/^sha256:[0-9a-f]{64}$/u.test(options.stabilitySummaryHash)
    || Number.isNaN(Date.parse(options.stabilityCreatedAt))) {
    throw new Error("Direct run-report 的 Probe 或 Stability 摘要引用无效");
  }
  const agentById = new Map(output.replay.agents.map(agent => [agent.id, agent]));
  const agents: ArenaRunAgentReport[] = output.report.episodeReports.map(episode => {
    const agent = agentById.get(episode.agentId);
    const metrics = episode.requestMetrics;
    if (!agent?.provider || !agent.model || !agent.providerAdapterVersion || !metrics) {
      throw new Error(`Direct run-report 缺少 Agent ${episode.agentId} 的 Provider 或请求账本`);
    }
    const calls = metrics.calls;
    verifyCallLinks(agent.id, calls, output);
    const trace = output.traces.find(item => item.agentId === agent.id)!;
    const eventById = new Map(trace.events.map(event => [event.id, event]));
    const actionEvents = calls.flatMap(call => {
      if (!call.actionEventId) return [];
      const event = eventById.get(call.actionEventId);
      return event ? [event] : [];
    });
    const failures = calls.flatMap(call => call.failure ? [call.failure] : []);
    const usage = calls.flatMap(call => call.tokenUsage ? [call.tokenUsage] : []);
    const technicalFailure = episode.technicalFailure ?? null;
    const technicalFailureAlreadyCounted = technicalFailure !== null && failures.some(failure => (
      failure.category === technicalFailure.category && failure.domain === technicalFailure.domain
    ));
    const observedFailures = technicalFailure && !technicalFailureAlreadyCounted
      ? [...failures, technicalFailure]
      : failures;
    const countsTowardModelFailure = failures.some(failure => failure.countsTowardModelFailure)
      || technicalFailure?.countsTowardModelFailure === true;
    return Object.freeze({
      agentId: agent.id,
      agentSlot: agent.slot,
      provider: agent.provider,
      model: agent.model,
      providerAdapterVersion: agent.providerAdapterVersion,
      ...(agent.providerThinkingMode ? { providerThinkingMode: agent.providerThinkingMode } : {}),
      ...(agent.providerReasoningEffort
        ? { providerReasoningEffort: agent.providerReasoningEffort }
        : {}),
      requestCount: calls.length,
      successfulRequests: calls.filter(call => call.status === "succeeded").length,
      failedRequests: calls.filter(call => call.status === "failed").length,
      timedOutRequests: failures.filter(failure => (
        failure.category === "timeout" || failure.category === "total_wall_clock"
      )).length,
      retryAttempts: metrics.retryAttemptCount,
      recoveredDecisions: episode.recoveredDecisionCount,
      validActions: actionEvents.filter(event => event.result.success).length,
      invalidActions: actionEvents.filter(event => !event.result.success).length,
      dnf: !agent.rankEligible,
      exitDay: agent.finalResult.endDay,
      status: agent.status,
      technicalFailure,
      countsTowardModelFailure,
      errorCategories: countBy(observedFailures.map(failure => failure.category)),
      faultDomains: countBy(observedFailures.map(failure => failure.domain)),
      tokens: Object.freeze({
        input: usage.reduce((sum, item) => sum + item.inputTokens, 0),
        output: usage.reduce((sum, item) => sum + item.outputTokens, 0),
        total: usage.reduce((sum, item) => sum + item.totalTokens, 0),
        requestsWithoutUsage: calls.filter(call => call.usageMissing).length,
      }),
      latency: latencyFor(calls),
      modelCalls: calls,
    });
  });
  const allCalls = agents.flatMap(agent => agent.modelCalls);
  const usage = allCalls.flatMap(call => call.tokenUsage ? [call.tokenUsage] : []);
  const totals = Object.freeze({
    requestCount: allCalls.length,
    successfulRequests: allCalls.filter(call => call.status === "succeeded").length,
    failedRequests: allCalls.filter(call => call.status === "failed").length,
    timedOutRequests: agents.reduce((sum, agent) => sum + agent.timedOutRequests, 0),
    retryAttempts: agents.reduce((sum, agent) => sum + agent.retryAttempts, 0),
    recoveredDecisions: agents.reduce((sum, agent) => sum + agent.recoveredDecisions, 0),
    validActions: agents.reduce((sum, agent) => sum + agent.validActions, 0),
    invalidActions: agents.reduce((sum, agent) => sum + agent.invalidActions, 0),
    dnfAgents: agents.filter(agent => agent.dnf).length,
    modelFailureAgents: agents.filter(agent => agent.countsTowardModelFailure).length,
    errorCategories: mergeCounts(agents.map(agent => agent.errorCategories)),
    faultDomains: mergeCounts(agents.map(agent => agent.faultDomains)),
    tokens: Object.freeze({
      input: usage.reduce((sum, item) => sum + item.inputTokens, 0),
      output: usage.reduce((sum, item) => sum + item.outputTokens, 0),
      total: usage.reduce((sum, item) => sum + item.totalTokens, 0),
      requestsWithoutUsage: allCalls.filter(call => call.usageMissing).length,
    }),
    latency: latencyFor(allCalls),
  });
  return Object.freeze({
    artifactType: "arena-direct-run-report-v5",
    executionMode: "direct",
    matchId: options.matchId,
    seed: options.seed,
    replayHash: output.replay.replayHash,
    probe: Object.freeze({
      summaryHash: options.probeSummaryHash,
      createdAt: options.probeCreatedAt,
    }),
    stability: Object.freeze({
      summaryHash: options.stabilitySummaryHash,
      createdAt: options.stabilityCreatedAt,
      actionTargetPerAgent: 10 as const,
    }),
    competitionAudit: audit,
    limits: Object.freeze({
      agents: 5 as const,
      maxActionsPerAgent: options.maxActionsPerAgent,
      maxModelRequests: 5 * options.maxActionsPerAgent * audit.maxAttemptsPerDecision,
      decisionTimeoutMs: options.decisionTimeoutMs,
      attemptTimeoutMs: audit.attemptTimeoutMs,
      totalWallClockMsPerAgent: options.totalWallClockMs,
      maxOutputTokensPerRequest: options.maxOutputTokens,
      maxAttemptsPerDecision: 3 as const,
      maxRepairRetriesPerDecision: 2 as const,
      maxTransientRetriesPerDecision: 1 as const,
      automaticRetries: 2 as const,
    }),
    totals,
    agents: Object.freeze(agents),
    cost: Object.freeze({
      status: "unavailable",
      reason: "provider-pricing-not-estimated",
    }),
    limitations: output.report.limitations,
  });
}
