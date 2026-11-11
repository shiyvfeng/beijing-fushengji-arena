import type {
  FaultDomain,
  ProviderReasoningEffort,
  ProviderThinkingMode,
  TechnicalFailureCategory,
  TechnicalFailureDetail,
} from "../core/contracts.js";
import type { ArenaModelCallAudit } from "./agent-driver.js";
import { COMPLETION_RUN_TRACK, completionRate } from "./completion-assisted.js";
import type { ReliabilityScorecard } from "./episode-runner.js";
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
  readonly reliability?: ReliabilityScorecard;
}

export interface ArenaDirectRunReport {
  readonly artifactType: "arena-direct-run-report-v5" | "arena-direct-run-report-v6";
  readonly executionMode: "direct";
  readonly runTrack?: typeof COMPLETION_RUN_TRACK;
  readonly matchId: string;
  readonly seed: number;
  readonly replayHash: string;
  readonly probe: {
    readonly summaryHash: string;
    readonly createdAt: string;
    readonly passed: boolean;
    readonly waiver?: {
      readonly hash: string;
      readonly disposition: "explicit-failed-probe-waiver";
    };
  };
  readonly stability: {
    readonly summaryHash: string;
    readonly createdAt: string;
    readonly actionTargetPerAgent: 10;
    readonly autonomousDayTargetPerAgent?: 10;
    readonly passed: boolean;
    readonly skipped: boolean;
    readonly waiver?: {
      readonly hash: string;
      readonly disposition:
        | "explicit-assisted-stability-waiver"
        | "explicit-skipped-stability-waiver";
    };
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
    readonly maxTransientRetriesPerDecision: 1 | 2;
    readonly automaticRetries: 2;
    readonly maxDailyDecisionsPerAgent?: number;
    readonly providerTimeBudgetMsPerAgent?: number;
    readonly maxDailyPlanCandidates?: 128;
    readonly maxPrepActionsPerDay?: 2;
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
    readonly reliability?: ReliabilityScorecard;
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
  readonly completionAssisted?: boolean;
  readonly maxDailyDecisionsPerAgent?: number;
  readonly providerTimeBudgetMs?: number;
  readonly probeSummaryHash: string;
  readonly probeCreatedAt: string;
  readonly probePassed?: boolean;
  readonly probeWaiverHash?: string;
  readonly probeWaiverDisposition?: "explicit-failed-probe-waiver";
  readonly stabilitySummaryHash: string;
  readonly stabilityCreatedAt: string;
  readonly stabilityPassed?: boolean;
  readonly stabilitySkipped?: boolean;
  readonly stabilityWaiverHash?: string;
  readonly stabilityWaiverDisposition?:
    | "explicit-assisted-stability-waiver"
    | "explicit-skipped-stability-waiver";
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
    const links = [
      call.actionEventIds.length > 0,
      call.assistanceEventId,
      call.terminationEventId,
      call.retryReason,
    ].filter(Boolean);
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
    if (call.actionEventIds.length > 0) {
      if (call.status !== "succeeded") {
        throw new Error(`modelCallId ${call.modelCallId} 的成功动作关联了失败调用`);
      }
      const actualActionEventIds = trace.events
        .filter(event => event.type === "action" && event.modelCallId === call.modelCallId)
        .map(event => event.id);
      if (actualActionEventIds.length !== call.actionEventIds.length
        || actualActionEventIds.some((eventId, index) => eventId !== call.actionEventIds[index])) {
        throw new Error(`modelCallId ${call.modelCallId} 的整日动作账本不完整`);
      }
      for (const [index, eventId] of call.actionEventIds.entries()) {
        const event = events.get(eventId);
        if (!event
          || event.type !== "action"
          || event.modelCallId !== call.modelCallId
          || event.fullContextHash !== call.fullContextHash
          || (index === 0 && event.observationHash !== call.observationHash)) {
          throw new Error(`modelCallId ${call.modelCallId} 的动作 Trace 证据无法对账`);
        }
        if (index > 0) {
          const previous = events.get(call.actionEventIds[index - 1]);
          if (!previous || event.sequence !== previous.sequence + 1) {
            throw new Error(`modelCallId ${call.modelCallId} 的整日动作事件不连续`);
          }
        }
      }
      continue;
    }
    const eventId = call.assistanceEventId ?? call.terminationEventId;
    const event = eventId ? events.get(eventId) : undefined;
    if (!event) throw new Error(`modelCallId ${call.modelCallId} 的 Trace 证据无法对账`);
    if (call.assistanceEventId) {
      if (call.status !== "failed"
        || event.type !== "assistance"
        || !event.assistance?.triggerModelCallIds.includes(call.modelCallId)) {
        throw new Error(`modelCallId ${call.modelCallId} 的辅助事件证据无效`);
      }
    } else if (event.type !== "technical_termination"
      || event.modelCallId !== call.modelCallId
      || event.fullContextHash !== call.fullContextHash
      || event.observationHash !== call.observationHash) {
      throw new Error(`modelCallId ${call.modelCallId} 的终止事件证据无效`);
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
  const completionAssisted = audit.runTrack === COMPLETION_RUN_TRACK;
  if (completionAssisted !== (options.completionAssisted === true)
    || options.matchId !== output.replay.matchId
    || options.seed !== output.replay.seed
    || options.decisionTimeoutMs !== audit.decisionTimeoutMs
    || options.maxOutputTokens !== audit.maxOutputTokensPerRequest) {
    throw new Error("Direct run-report 配置与 Replay competitionAudit 不一致");
  }
  if (completionAssisted) {
    if (options.maxDailyDecisionsPerAgent !== audit.maxDailyDecisionsPerAgent
      || options.providerTimeBudgetMs !== audit.providerTimeBudgetMsPerAgent) {
      throw new Error("Completion-Assisted run-report 的日数或 Provider 时间预算不一致");
    }
  } else if (options.maxActionsPerAgent !== audit.maxActionsPerAgent
    || options.totalWallClockMs !== audit.totalWallClockMsPerAgent) {
    throw new Error("Strict Direct run-report 的动作或墙钟预算不一致");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(options.probeSummaryHash)
    || Number.isNaN(Date.parse(options.probeCreatedAt))
    || !/^sha256:[0-9a-f]{64}$/u.test(options.stabilitySummaryHash)
    || Number.isNaN(Date.parse(options.stabilityCreatedAt))) {
    throw new Error("Direct run-report 的 Probe 或 Stability 摘要引用无效");
  }
  const probePassed = options.probePassed ?? true;
  const hasProbeWaiver = options.probeWaiverHash !== undefined
    || options.probeWaiverDisposition !== undefined;
  if ((probePassed && hasProbeWaiver)
    || (!probePassed && (!completionAssisted
      || !/^sha256:[0-9a-f]{64}$/u.test(options.probeWaiverHash ?? "")
      || options.probeWaiverDisposition !== "explicit-failed-probe-waiver"))) {
    throw new Error("Direct run-report 的 Probe 通过或豁免状态无效");
  }
  const stabilityPassed = options.stabilityPassed ?? true;
  const stabilitySkipped = options.stabilitySkipped ?? false;
  const hasStabilityWaiver = options.stabilityWaiverHash !== undefined
    || options.stabilityWaiverDisposition !== undefined;
  if ((stabilitySkipped && (!completionAssisted || stabilityPassed))
    || (stabilityPassed && hasStabilityWaiver)
    || (!stabilityPassed && (!/^sha256:[0-9a-f]{64}$/u.test(options.stabilityWaiverHash ?? "")
      || !options.stabilityWaiverDisposition))
    || (stabilitySkipped
      !== (options.stabilityWaiverDisposition === "explicit-skipped-stability-waiver"))) {
    throw new Error("Direct run-report 的 Stability 通过、跳过或豁免状态无效");
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
      validActions: episode.validActionCount,
      invalidActions: episode.invalidActionCount,
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
      ...(episode.reliability ? { reliability: episode.reliability } : {}),
    });
  });
  const allCalls = agents.flatMap(agent => agent.modelCalls);
  const usage = allCalls.flatMap(call => call.tokenUsage ? [call.tokenUsage] : []);
  const reliabilityValues = agents.flatMap(agent => agent.reliability ? [agent.reliability] : []);
  const reliability = completionAssisted
    ? (() => {
      if (reliabilityValues.length !== agents.length) {
        throw new Error("Completion-Assisted run-report 缺少可靠性评分卡");
      }
      const sum = <K extends keyof ReliabilityScorecard>(key: K): number => (
        reliabilityValues.reduce((total, item) => total + Number(item[key]), 0)
      );
      const advancedDays = sum("advancedDays");
      const autonomousDays = sum("autonomousDays");
      const assistedDays = sum("assistedDays");
      const providerAttemptedDays = sum("providerAttemptedDays");
      const firstAttemptSuccessDays = sum("firstAttemptSuccessDays");
      const validPlanSelections = sum("validPlanSelections");
      const selectionResponseCount = sum("selectionResponseCount");
      const providerRequests = allCalls.length;
      const providerSuccesses = allCalls.filter(call => call.status === "succeeded").length;
      return Object.freeze({
        advancedDays,
        autonomousDays,
        assistedDays,
        autonomousDayRate: completionRate(autonomousDays, advancedDays),
        providerAttemptedDays,
        firstAttemptSuccessDays,
        firstAttemptSuccessRate: completionRate(firstAttemptSuccessDays, providerAttemptedDays),
        validPlanSelections,
        selectionResponseCount,
        validSelectionRate: completionRate(validPlanSelections, selectionResponseCount),
        providerRequestSuccessRate: completionRate(providerSuccesses, providerRequests),
        providerWaitMs: sum("providerWaitMs"),
        retryCount: sum("retryCount"),
        circuitSkippedDays: sum("circuitSkippedDays"),
        providerBudgetExhaustedDays: sum("providerBudgetExhaustedDays"),
        assistanceReasons: mergeCounts(reliabilityValues.map(item => item.assistanceReasons)),
      });
    })()
    : undefined;
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
    ...(reliability ? { reliability } : {}),
  });
  return Object.freeze({
    artifactType: completionAssisted
      ? "arena-direct-run-report-v6"
      : "arena-direct-run-report-v5",
    executionMode: "direct",
    ...(completionAssisted ? { runTrack: COMPLETION_RUN_TRACK } : {}),
    matchId: options.matchId,
    seed: options.seed,
    replayHash: output.replay.replayHash,
    probe: Object.freeze({
      summaryHash: options.probeSummaryHash,
      createdAt: options.probeCreatedAt,
      passed: probePassed,
      ...(hasProbeWaiver ? {
        waiver: Object.freeze({
          hash: options.probeWaiverHash!,
          disposition: options.probeWaiverDisposition!,
        }),
      } : {}),
    }),
    stability: Object.freeze({
      summaryHash: options.stabilitySummaryHash,
      createdAt: options.stabilityCreatedAt,
      actionTargetPerAgent: 10 as const,
      ...(completionAssisted ? { autonomousDayTargetPerAgent: 10 as const } : {}),
      passed: stabilityPassed,
      skipped: stabilitySkipped,
      ...(hasStabilityWaiver ? {
        waiver: Object.freeze({
          hash: options.stabilityWaiverHash!,
          disposition: options.stabilityWaiverDisposition!,
        }),
      } : {}),
    }),
    competitionAudit: audit,
    limits: Object.freeze({
      agents: 5 as const,
      maxActionsPerAgent: audit.maxActionsPerAgent,
      maxModelRequests: 5 * (completionAssisted
        ? audit.maxDailyDecisionsPerAgent
        : options.maxActionsPerAgent) * audit.maxAttemptsPerDecision,
      decisionTimeoutMs: options.decisionTimeoutMs,
      attemptTimeoutMs: audit.attemptTimeoutMs,
      totalWallClockMsPerAgent: completionAssisted
        ? audit.providerTimeBudgetMsPerAgent
        : options.totalWallClockMs,
      maxOutputTokensPerRequest: options.maxOutputTokens,
      maxAttemptsPerDecision: 3 as const,
      maxRepairRetriesPerDecision: 2 as const,
      maxTransientRetriesPerDecision: audit.maxTransientRetriesPerDecision,
      automaticRetries: 2 as const,
      ...(completionAssisted ? {
        maxDailyDecisionsPerAgent: audit.maxDailyDecisionsPerAgent,
        providerTimeBudgetMsPerAgent: audit.providerTimeBudgetMsPerAgent,
        maxDailyPlanCandidates: audit.maxDailyPlanCandidates,
        maxPrepActionsPerDay: audit.maxPrepActionsPerDay,
      } : {}),
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
