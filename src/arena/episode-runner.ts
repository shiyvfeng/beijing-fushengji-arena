import { performance } from "node:perf_hooks";
import type {
  DriverKind,
  EpisodeConfig,
  EpisodeStatus,
  EpisodeTrace,
  FaultDomain,
  GameAction,
  ModelDecisionEvidence,
  ScenarioConfig,
  TechnicalFailureCategory,
  TechnicalFailureDetail,
} from "../core/contracts.js";
import { GameEnvironment } from "../core/game-environment.js";
import type {
  AgentDecisionHistoryEntry,
  AgentDecisionOutput,
  AgentDriver,
  DirectModelRunMetrics,
} from "./agent-driver.js";
import { DirectProviderRequestError } from "./agent-driver.js";

export interface EpisodeRunConfig {
  readonly matchId: string;
  readonly seed: number;
  readonly scenario: ScenarioConfig;
  readonly driver: AgentDriver;
  readonly maxActions?: number;
  readonly maxConsecutiveInvalidActions?: number;
  readonly resetTimeoutMs?: number;
  readonly decisionTimeoutMs?: number;
  readonly totalWallClockMs?: number;
  readonly onProgress?: EpisodeProgressReporter;
}

interface EpisodeProgressBase {
  readonly artifactType: "arena-live-progress-v1";
  readonly agentId: string;
  readonly agentSlot: number;
  readonly driver: DriverKind;
  readonly provider: string | null;
  readonly model: string | null;
}

export type EpisodeProgressEvent = Readonly<EpisodeProgressBase & (
  | {
      readonly event: "episode_started";
      readonly day: number;
    }
  | {
      readonly event: "decision_started";
      readonly actionIndex: number;
      readonly day: number;
      readonly historyLength: number;
      readonly requestCount: number;
    }
  | {
      readonly event: "action_completed";
      readonly actionIndex: number;
      readonly actionType: GameAction["type"];
      readonly actionSucceeded: boolean;
      readonly dayBefore: number;
      readonly dayAfter: number;
      readonly stateStatus: EpisodeStatus;
      readonly requestCount: number;
      readonly successfulRequestCount: number;
      readonly failedRequestCount: number;
      readonly lastCallLatencyMs: number | null;
      readonly lastCallInputTokens: number | null;
      readonly lastCallOutputTokens: number | null;
      readonly cumulativeTotalTokens: number;
    }
  | {
      readonly event: "episode_completed";
      readonly status: Exclude<EpisodeStatus, "running">;
      readonly endDay: number;
      readonly actionCount: number;
      readonly validActionCount: number;
      readonly invalidActionCount: number;
      readonly requestCount: number;
      readonly successfulRequestCount: number;
      readonly failedRequestCount: number;
      readonly requestsWithoutUsage: number;
      readonly cumulativeInputTokens: number;
      readonly cumulativeOutputTokens: number;
      readonly cumulativeTotalTokens: number;
      readonly lastCallLatencyMs: number | null;
      readonly failureCategory: TechnicalFailureCategory | null;
      readonly faultDomain: FaultDomain | null;
      readonly countsTowardModelFailure: boolean | null;
      readonly httpStatus: number | null;
    }
)>;

export type EpisodeProgressReporter = (event: EpisodeProgressEvent) => void;

export interface EpisodeRunReport {
  readonly agentId: string;
  readonly agentSlot: number;
  readonly driver: "direct" | "mcp" | "scripted";
  readonly status: EpisodeTrace["finalResult"]["status"];
  readonly actionCount: number;
  readonly validActionCount: number;
  readonly invalidActionCount: number;
  readonly timeoutCount: number;
  readonly totalWallClockMs: number;
  readonly traceHash: string;
  readonly technicalFailure?: TechnicalFailureDetail;
  readonly requestMetrics?: DirectModelRunMetrics;
  readonly diagnostic?: string;
  readonly timeoutPhase?: "reset" | "decide";
}

export interface EpisodeRunOutput {
  readonly trace: EpisodeTrace;
  readonly report: EpisodeRunReport;
}

class DriverTimeoutError extends Error {
  constructor(
    readonly phase: "reset" | "decide",
    readonly timeoutMs: number,
    readonly category: "timeout" | "total_wall_clock" = "timeout",
  ) {
    super(`driver ${phase} timed out after ${timeoutMs}ms`);
    this.name = "DriverTimeoutError";
  }
}

function validateTimeout(value: number, name: string, maximum = 600_000): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} 必须是 1 到 ${maximum} 之间的整数毫秒值`);
  }
  return value;
}

function validateActionLimit(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} 必须是 1 到 ${maximum} 之间的整数`);
  }
  return value;
}

async function withDriverTimeout<T>(
  phase: "reset" | "decide",
  timeoutMs: number,
  category: "timeout" | "total_wall_clock",
  operation: (signal: AbortSignal) => T | Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const timeoutError = new DriverTimeoutError(phase, timeoutMs, category);
      reject(timeoutError);
      controller.abort(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]);
  } catch (error: unknown) {
    if (controller.signal.aborted && controller.signal.reason instanceof DriverTimeoutError) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

function normalizeDecisionOutput(value: GameAction | AgentDecisionOutput): AgentDecisionOutput {
  if (value && typeof value === "object" && "action" in value) return value as AgentDecisionOutput;
  return Object.freeze({ action: value as GameAction });
}

function linkActionEvidence(
  driver: AgentDriver,
  evidence: ModelDecisionEvidence | undefined,
  eventId: string | undefined,
): void {
  if (evidence && eventId) {
    driver.linkModelCallEvidence?.(evidence.modelCallId, { actionEventId: eventId });
  }
}

function linkTerminationEvidence(
  driver: AgentDriver,
  evidence: ModelDecisionEvidence | undefined,
  eventId: string | undefined,
): void {
  if (evidence && eventId) {
    driver.linkModelCallEvidence?.(evidence.modelCallId, { terminationEventId: eventId });
  }
}

function progressBase(driver: AgentDriver): EpisodeProgressBase {
  const descriptor = driver.descriptor;
  return {
    artifactType: "arena-live-progress-v1",
    agentId: descriptor.id,
    agentSlot: descriptor.slot,
    driver: descriptor.driver,
    provider: descriptor.provider ?? null,
    model: descriptor.model ?? null,
  };
}

/** Progress is a non-authoritative side channel and must never change match facts. */
function emitProgress(reporter: EpisodeProgressReporter | undefined, event: EpisodeProgressEvent): void {
  if (!reporter) return;
  try {
    reporter(Object.freeze(event));
  } catch {
    // A closed terminal or observer failure cannot terminate an Agent episode.
  }
}

export async function runEpisode(config: EpisodeRunConfig): Promise<EpisodeRunOutput> {
  const environment = new GameEnvironment();
  const descriptor = config.driver.descriptor;
  const episodeConfig: EpisodeConfig = {
    matchId: config.matchId,
    episodeId: `${config.matchId}:slot-${descriptor.slot}`,
    agentId: descriptor.id,
    agentSlot: descriptor.slot,
    seed: config.seed,
    scenario: config.scenario,
  };
  const scenarioActionCeiling = config.scenario.totalDays * 8;
  const maxActions = validateActionLimit(
    config.maxActions ?? scenarioActionCeiling,
    "maxActions",
    scenarioActionCeiling,
  );
  const maxInvalid = validateActionLimit(
    config.maxConsecutiveInvalidActions ?? 8,
    "maxConsecutiveInvalidActions",
    scenarioActionCeiling,
  );
  const resetTimeoutMs = validateTimeout(config.resetTimeoutMs ?? 5_000, "resetTimeoutMs");
  const decisionTimeoutMs = validateTimeout(config.decisionTimeoutMs ?? 30_000, "decisionTimeoutMs");
  const defaultWallClock = maxActions * decisionTimeoutMs;
  const totalWallClockMs = validateTimeout(
    config.totalWallClockMs ?? defaultWallClock,
    "totalWallClockMs",
    2_147_483_647,
  );
  let actionCount = 0;
  let invalidActionCount = 0;
  let consecutiveInvalid = 0;
  let diagnostic: string | undefined;
  let timeoutPhase: "reset" | "decide" | undefined;
  let driverPhase: "reset" | "decide" | "action" = "reset";
  const history: AgentDecisionHistoryEntry[] = [];

  environment.reset(episodeConfig);
  const base = progressBase(config.driver);
  if (config.onProgress) {
    emitProgress(config.onProgress, Object.freeze({
      ...base,
      event: "episode_started",
      day: environment.observe().state.day,
    }));
  }
  try {
    await withDriverTimeout("reset", resetTimeoutMs, "timeout", signal => config.driver.reset?.({ signal }));
    const wallClockStartedAt = performance.now();
    const wallClockDeadline = wallClockStartedAt + totalWallClockMs;
    while (environment.observe().state.status === "running") {
      if (actionCount >= maxActions) {
        environment.terminateTechnical(
          "tool_limit",
          `动作数达到上限 ${maxActions}。`,
          {
            category: "action_budget",
            phase: "action",
            domain: "model",
            countsTowardModelFailure: true,
          },
        );
        break;
      }

      const remainingWallClock = Math.floor(wallClockDeadline - performance.now());
      if (remainingWallClock <= 0) {
        environment.terminateTechnical(
          "model_timeout",
          "Agent 总墙钟已耗尽。",
          {
            category: "total_wall_clock",
            phase: "decide",
            domain: "undetermined",
            countsTowardModelFailure: false,
          },
        );
        diagnostic = "total_wall_clock";
        timeoutPhase = "decide";
        break;
      }
      const effectiveTimeout = Math.max(1, Math.min(decisionTimeoutMs, remainingWallClock));
      const timeoutCategory = remainingWallClock <= decisionTimeoutMs
        ? "total_wall_clock" as const
        : "timeout" as const;
      driverPhase = "decide";
      if (config.onProgress) {
        emitProgress(config.onProgress, Object.freeze({
          ...base,
          event: "decision_started",
          actionIndex: actionCount,
          day: environment.observe().state.day,
          historyLength: history.length,
          requestCount: config.driver.getRunMetrics?.().requestCount ?? 0,
        }));
      }
      const decision = normalizeDecisionOutput(await withDriverTimeout(
        "decide",
        effectiveTimeout,
        timeoutCategory,
        signal => config.driver.decide({
          matchId: config.matchId,
          observation: environment.observe(),
          actionIndex: actionCount,
          history: [...history],
          signal,
        }),
      ));
      driverPhase = "action";
      const result = environment.step(decision.action, decision.evidence);
      const actionIndex = actionCount;
      actionCount++;
      if (result.event) {
        linkActionEvidence(config.driver, decision.evidence, result.event.id);
        history.push(Object.freeze({
          actionIndex: actionCount - 1,
          action: result.event.action ?? decision.action,
          result: Object.freeze({
            success: result.event.result.success,
            code: result.event.result.code ?? null,
            message: result.event.result.message,
            effects: result.event.result.effects,
          }),
          stateDiff: result.event.stateDiff,
        }));
      }
      if (config.onProgress) {
        const metrics = config.driver.getRunMetrics?.();
        const lastCall = metrics?.calls.at(-1);
        emitProgress(config.onProgress, Object.freeze({
          ...base,
          event: "action_completed",
          actionIndex,
          actionType: decision.action.type,
          actionSucceeded: result.success,
          dayBefore: result.before.day,
          dayAfter: result.after.day,
          stateStatus: result.after.status,
          requestCount: metrics?.requestCount ?? 0,
          successfulRequestCount: metrics?.successfulRequestCount ?? 0,
          failedRequestCount: metrics?.failedRequestCount ?? 0,
          lastCallLatencyMs: lastCall?.latencyMs ?? null,
          lastCallInputTokens: lastCall?.tokenUsage?.inputTokens ?? null,
          lastCallOutputTokens: lastCall?.tokenUsage?.outputTokens ?? null,
          cumulativeTotalTokens: metrics?.totalTokens ?? 0,
        }));
      }
      if (result.success) {
        consecutiveInvalid = 0;
      } else {
        invalidActionCount++;
        consecutiveInvalid++;
        if (consecutiveInvalid >= maxInvalid) {
          environment.terminateTechnical(
            "loop_terminated",
            `连续 ${maxInvalid} 次动作无效。`,
            {
              category: "invalid_action_loop",
              phase: "action",
              domain: "model",
              countsTowardModelFailure: true,
            },
          );
          break;
        }
      }
    }
  } catch (error: unknown) {
    let evidence: ModelDecisionEvidence | undefined;
    let detail: TechnicalFailureDetail;
    let status: "model_timeout" | "runtime_error";
    let message: string;
    if (error instanceof DriverTimeoutError) {
      timeoutPhase = error.phase;
      diagnostic = error.category;
      evidence = config.driver.recordExternalDecisionFailure?.(
        error.category,
        "undetermined",
        false,
      );
      detail = {
        category: error.category,
        phase: error.phase,
        domain: "undetermined",
        countsTowardModelFailure: false,
      };
      status = "model_timeout";
      message = error.category === "total_wall_clock"
        ? "Agent 总墙钟已耗尽。"
        : `Agent ${error.phase === "reset" ? "初始化" : "决策"}超时。`;
    } else if (error instanceof DirectProviderRequestError) {
      diagnostic = error.code;
      evidence = config.driver.getActiveDecisionEvidence?.();
      detail = {
        category: error.code,
        phase: "decide",
        domain: error.domain,
        countsTowardModelFailure: error.countsTowardModelFailure,
        provider: error.providerId,
        ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
      };
      status = "runtime_error";
      message = error.code === "context_limit"
        ? "模型明确报告上下文超限。"
        : "Provider 请求未能返回可执行的 Arena 动作。";
    } else {
      diagnostic = "driver_threw";
      evidence = config.driver.recordExternalDecisionFailure?.("driver_error", "runner", false)
        ?? config.driver.getActiveDecisionEvidence?.();
      detail = {
        category: "driver_error",
        phase: driverPhase,
        domain: "runner",
        countsTowardModelFailure: false,
      };
      status = "runtime_error";
      message = "Agent 驱动执行时抛出异常。";
    }
    environment.terminateTechnical(status, message, detail, evidence);
    const termination = environment.eventLog.at(-1);
    linkTerminationEvidence(config.driver, evidence, termination?.type === "technical_termination"
      ? termination.id
      : undefined);
  }

  environment.finalize();
  const trace = environment.exportTrace(descriptor);
  const requestMetrics = config.driver.getRunMetrics?.();
  const report = Object.freeze({
    agentId: descriptor.id,
    agentSlot: descriptor.slot,
    driver: descriptor.driver,
    status: trace.finalResult.status,
    actionCount,
    validActionCount: actionCount - invalidActionCount,
    invalidActionCount,
    timeoutCount: timeoutPhase ? 1 : 0,
    totalWallClockMs,
    traceHash: trace.traceHash,
    ...(trace.finalResult.technicalFailure ? { technicalFailure: trace.finalResult.technicalFailure } : {}),
    ...(requestMetrics ? { requestMetrics } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    ...(timeoutPhase ? { timeoutPhase } : {}),
  });
  if (config.onProgress) {
    const lastCall = requestMetrics?.calls.at(-1);
    const failure = trace.finalResult.technicalFailure;
    emitProgress(config.onProgress, Object.freeze({
      ...base,
      event: "episode_completed",
      status: trace.finalResult.status,
      endDay: trace.finalResult.endDay,
      actionCount,
      validActionCount: actionCount - invalidActionCount,
      invalidActionCount,
      requestCount: requestMetrics?.requestCount ?? 0,
      successfulRequestCount: requestMetrics?.successfulRequestCount ?? 0,
      failedRequestCount: requestMetrics?.failedRequestCount ?? 0,
      requestsWithoutUsage: requestMetrics
        ? requestMetrics.requestCount - requestMetrics.usageReportedRequestCount
        : 0,
      cumulativeInputTokens: requestMetrics?.inputTokens ?? 0,
      cumulativeOutputTokens: requestMetrics?.outputTokens ?? 0,
      cumulativeTotalTokens: requestMetrics?.totalTokens ?? 0,
      lastCallLatencyMs: lastCall?.latencyMs ?? null,
      failureCategory: failure?.category ?? null,
      faultDomain: failure?.domain ?? null,
      countsTowardModelFailure: failure?.countsTowardModelFailure ?? null,
      httpStatus: failure?.httpStatus ?? null,
    }));
  }
  return {
    trace,
    report,
  };
}
