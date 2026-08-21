import type { ProviderThinkingMode, TechnicalFailureCategory } from "../core/contracts.js";
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
  readonly requestCount: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly timedOutRequests: number;
  readonly validActions: number;
  readonly invalidActions: number;
  readonly dnf: boolean;
  readonly exitDay: number;
  readonly status: string;
  readonly errorCategories: Readonly<Partial<Record<TechnicalFailureCategory, number>>>;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
    readonly requestsWithoutUsage: number;
  };
  readonly latency: LatencyStatistics;
}

export interface ArenaDirectRunReport {
  readonly artifactType: "arena-direct-run-report-v3";
  readonly executionMode: "direct";
  readonly matchId: string;
  readonly seed: number;
  readonly replayHash: string;
  readonly competitionAudit: NonNullable<MatchRunOutput["replay"]["competitionAudit"]>;
  readonly limits: {
    readonly agents: number;
    readonly maxActionsPerAgent: number;
    readonly maxModelRequests: number;
    readonly decisionTimeoutMs: number;
    readonly maxOutputTokensPerRequest: number;
    readonly automaticRetries: 0;
  };
  readonly totals: {
    readonly requestCount: number;
    readonly successfulRequests: number;
    readonly failedRequests: number;
    readonly timedOutRequests: number;
    readonly validActions: number;
    readonly invalidActions: number;
    readonly dnfAgents: number;
    readonly errorCategories: Readonly<Partial<Record<TechnicalFailureCategory, number>>>;
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
  readonly maxOutputTokens: number;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function aggregateErrors(
  reports: readonly ArenaRunAgentReport[],
): Readonly<Partial<Record<TechnicalFailureCategory, number>>> {
  const totals: Partial<Record<TechnicalFailureCategory, number>> = {};
  for (const report of reports) {
    for (const [category, count] of Object.entries(report.errorCategories)) {
      const typed = category as TechnicalFailureCategory;
      totals[typed] = (totals[typed] ?? 0) + (count ?? 0);
    }
  }
  return Object.freeze(totals);
}

function combineLatency(reports: readonly ArenaRunAgentReport[]): LatencyStatistics {
  const samples = reports.reduce((sum, report) => sum + report.latency.samples, 0);
  const totalMs = rounded(reports.reduce((sum, report) => sum + report.latency.totalMs, 0));
  const minima = reports.flatMap(report => report.latency.minimumMs === null ? [] : [report.latency.minimumMs]);
  const maxima = reports.flatMap(report => report.latency.maximumMs === null ? [] : [report.latency.maximumMs]);
  return Object.freeze({
    samples,
    totalMs,
    minimumMs: minima.length ? Math.min(...minima) : null,
    maximumMs: maxima.length ? Math.max(...maxima) : null,
    averageMs: samples ? rounded(totalMs / samples) : null,
  });
}

export function buildDirectRunReport(
  options: RunReportOptions,
  output: MatchRunOutput,
): ArenaDirectRunReport {
  if (output.report.executionMode !== "direct" || !output.replay.competitionAudit) {
    throw new Error("只能为 Direct Match 生成 Direct run-report");
  }
  const agentById = new Map(output.replay.agents.map(agent => [agent.id, agent]));
  const agents: ArenaRunAgentReport[] = output.report.episodeReports.map(episode => {
    const agent = agentById.get(episode.agentId);
    const metrics = episode.requestMetrics;
    if (!agent?.provider || !agent.model || !agent.providerAdapterVersion || !metrics) {
      throw new Error(`Direct run-report 缺少 Agent ${episode.agentId} 的 Provider 或请求指标`);
    }
    const errorCategories: Partial<Record<TechnicalFailureCategory, number>> = {
      ...metrics.errorCounts,
    };
    if (episode.technicalFailure
      && errorCategories[episode.technicalFailure.category] === undefined) {
      errorCategories[episode.technicalFailure.category] = 1;
    }
    return Object.freeze({
      agentId: agent.id,
      agentSlot: agent.slot,
      provider: agent.provider,
      model: agent.model,
      providerAdapterVersion: agent.providerAdapterVersion,
      ...(agent.providerThinkingMode
        ? { providerThinkingMode: agent.providerThinkingMode }
        : {}),
      requestCount: metrics.requestCount,
      successfulRequests: metrics.successfulRequestCount,
      failedRequests: metrics.failedRequestCount,
      timedOutRequests: episode.timeoutCount,
      validActions: episode.validActionCount,
      invalidActions: episode.invalidActionCount,
      dnf: !agent.rankEligible,
      exitDay: agent.finalResult.endDay,
      status: agent.status,
      errorCategories: Object.freeze(errorCategories),
      tokens: Object.freeze({
        input: metrics.inputTokens,
        output: metrics.outputTokens,
        total: metrics.totalTokens,
        requestsWithoutUsage: metrics.requestCount - metrics.usageReportedRequestCount,
      }),
      latency: Object.freeze({
        samples: metrics.requestCount,
        totalMs: metrics.latencyMs.total,
        minimumMs: metrics.latencyMs.minimum,
        maximumMs: metrics.latencyMs.maximum,
        averageMs: metrics.latencyMs.average,
      }),
    });
  });
  const totals = Object.freeze({
    requestCount: agents.reduce((sum, agent) => sum + agent.requestCount, 0),
    successfulRequests: agents.reduce((sum, agent) => sum + agent.successfulRequests, 0),
    failedRequests: agents.reduce((sum, agent) => sum + agent.failedRequests, 0),
    timedOutRequests: agents.reduce((sum, agent) => sum + agent.timedOutRequests, 0),
    validActions: agents.reduce((sum, agent) => sum + agent.validActions, 0),
    invalidActions: agents.reduce((sum, agent) => sum + agent.invalidActions, 0),
    dnfAgents: agents.filter(agent => agent.dnf).length,
    errorCategories: aggregateErrors(agents),
    tokens: Object.freeze({
      input: agents.reduce((sum, agent) => sum + agent.tokens.input, 0),
      output: agents.reduce((sum, agent) => sum + agent.tokens.output, 0),
      total: agents.reduce((sum, agent) => sum + agent.tokens.total, 0),
      requestsWithoutUsage: agents.reduce((sum, agent) => sum + agent.tokens.requestsWithoutUsage, 0),
    }),
    latency: combineLatency(agents),
  });
  return Object.freeze({
    artifactType: "arena-direct-run-report-v3",
    executionMode: "direct",
    matchId: options.matchId,
    seed: options.seed,
    replayHash: output.replay.replayHash,
    competitionAudit: output.replay.competitionAudit,
    limits: Object.freeze({
      agents: agents.length,
      maxActionsPerAgent: options.maxActionsPerAgent,
      maxModelRequests: agents.length * options.maxActionsPerAgent,
      decisionTimeoutMs: options.decisionTimeoutMs,
      maxOutputTokensPerRequest: options.maxOutputTokens,
      automaticRetries: 0,
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
