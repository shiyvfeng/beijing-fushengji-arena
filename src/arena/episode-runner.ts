import { performance } from "node:perf_hooks";
import type {
  AssistanceReason,
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
import { integrityHash } from "../core/stable-value.js";
import type {
  AgentDecisionHistoryEntry,
  AgentActionDecisionOutput,
  AgentDailyPlanDecisionOutput,
  AgentDecisionOutput,
  AgentDriver,
  DecisionRetryFeedback,
  DirectModelRunMetrics,
} from "./agent-driver.js";
import { DirectProviderRequestError } from "./agent-driver.js";
import {
  directAttemptTimeoutMs,
  DIRECT_MAX_ATTEMPTS_PER_DECISION,
  DIRECT_MAX_REPAIR_RETRIES_PER_DECISION,
  DIRECT_MAX_TRANSIENT_RETRIES_PER_DECISION,
} from "./direct-context.js";
import {
  circuitSkipDays,
  COMPLETION_ASSISTANCE_POLICY_VERSION,
  COMPLETION_ATTEMPT_TIMEOUT_MS,
  COMPLETION_BACKOFF_SCHEDULE_MS,
  COMPLETION_CIRCUIT_FAILURE_THRESHOLD,
  COMPLETION_MAX_ATTEMPTS_PER_DAY,
  COMPLETION_PROVIDER_TIME_BUDGET_MS,
  completionFailureKind,
  completionRate,
  generateDailyPlanOptions,
} from "./completion-assisted.js";

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
  readonly completionAssisted?: boolean;
  readonly providerTimeBudgetMs?: number;
  readonly maxDailyDecisions?: number;
  /** Test-only override. Formal Match always uses the audited 15s/45s schedule. */
  readonly completionBackoffScheduleMs?: readonly [number, number];
  /** Test clock for deterministic recovery-policy verification. */
  readonly completionClock?: {
    readonly now: () => number;
    readonly sleep: (milliseconds: number) => Promise<void>;
  };
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
      readonly event: "attempt_started";
      readonly actionIndex: number;
      readonly attemptIndex: number;
      readonly day: number;
      readonly requestCount: number;
      readonly retryCategory: TechnicalFailureCategory | null;
    }
  | {
      readonly event: "attempt_failed";
      readonly actionIndex: number;
      readonly attemptIndex: number;
      readonly category: TechnicalFailureCategory;
      readonly faultDomain: FaultDomain;
      readonly willRetry: boolean;
      readonly requestCount: number;
      readonly lastCallLatencyMs: number | null;
    }
  | {
      readonly event: "action_completed";
      readonly actionIndex: number;
      readonly attemptIndex: number;
      readonly actionType: GameAction["type"];
      readonly actionSucceeded: boolean;
      readonly dayBefore: number;
      readonly dayAfter: number;
      readonly stateStatus: EpisodeStatus;
      readonly requestCount: number;
      readonly successfulRequestCount: number;
      readonly failedRequestCount: number;
      readonly retryAttemptCount: number;
      readonly recoveredByRetry: boolean;
      readonly lastCallLatencyMs: number | null;
      readonly lastCallInputTokens: number | null;
      readonly lastCallOutputTokens: number | null;
      readonly cumulativeTotalTokens: number;
    }
  | {
      readonly event: "daily_plan_completed";
      readonly actionIndex: number;
      readonly attemptIndex: number;
      readonly planId: string;
      readonly destinationId: number;
      readonly committedActions: number;
      readonly dayBefore: number;
      readonly dayAfter: number;
      readonly requestCount: number;
      readonly providerWaitMs: number;
    }
  | {
      readonly event: "assistance_completed";
      readonly dayBefore: number;
      readonly dayAfter: number;
      readonly reason: AssistanceReason;
      readonly failureCategory: TechnicalFailureCategory | null;
      readonly assistedDays: number;
      readonly providerWaitMs: number;
      readonly circuitSkipDaysRemaining: number | null;
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
      readonly retryAttemptCount: number;
      readonly recoveredDecisionCount: number;
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

export interface ReliabilityScorecard {
  readonly advancedDays: number;
  readonly autonomousDays: number;
  readonly assistedDays: number;
  readonly autonomousDayRate: number;
  readonly providerAttemptedDays: number;
  readonly firstAttemptSuccessDays: number;
  readonly firstAttemptSuccessRate: number;
  readonly validPlanSelections: number;
  readonly selectionResponseCount: number;
  readonly validSelectionRate: number;
  readonly providerRequestSuccessRate: number;
  readonly providerWaitMs: number;
  readonly retryCount: number;
  readonly circuitSkippedDays: number;
  readonly providerBudgetExhaustedDays: number;
  readonly assistanceReasons: Readonly<Partial<Record<AssistanceReason, number>>>;
}

export interface EpisodeRunReport {
  readonly agentId: string;
  readonly agentSlot: number;
  readonly driver: "direct" | "mcp" | "scripted";
  readonly status: EpisodeTrace["finalResult"]["status"];
  readonly actionCount: number;
  readonly validActionCount: number;
  readonly invalidActionCount: number;
  readonly timeoutCount: number;
  readonly attemptTimeoutMs: number;
  readonly retryAttemptCount: number;
  readonly recoveredDecisionCount: number;
  readonly totalWallClockMs: number;
  readonly traceHash: string;
  readonly technicalFailure?: TechnicalFailureDetail;
  readonly requestMetrics?: DirectModelRunMetrics;
  readonly diagnostic?: string;
  readonly timeoutPhase?: "reset" | "decide";
  readonly reliability?: ReliabilityScorecard;
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

function normalizeDecisionOutput(value: GameAction | AgentDecisionOutput): AgentActionDecisionOutput {
  if (value && typeof value === "object" && "dailyPlanSelection" in value) {
    throw new Error("Strict Episode 收到 Daily Plan 决策");
  }
  if (value && typeof value === "object" && "action" in value) {
    return value as AgentActionDecisionOutput;
  }
  return Object.freeze({ action: value as GameAction });
}

function linkActionEvidence(
  driver: AgentDriver,
  evidence: ModelDecisionEvidence | undefined,
  eventId: string | undefined,
): void {
  if (evidence && eventId) {
    driver.linkModelCallEvidence?.(evidence.modelCallId, { actionEventIds: [eventId] });
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

function linkRetryEvidence(
  driver: AgentDriver,
  evidence: ModelDecisionEvidence | undefined,
  category: TechnicalFailureCategory,
): void {
  if (evidence) driver.linkModelCallEvidence?.(evidence.modelCallId, { retryReason: category });
}

type RetryKind = "repair" | "transient";

function retryKindFor(error: unknown): RetryKind | null {
  if (error instanceof DriverTimeoutError) {
    return error.category === "timeout" ? "transient" : null;
  }
  if (!(error instanceof DirectProviderRequestError)) return null;
  if (error.code === "invalid_action" || error.code === "invalid_response") return "repair";
  if (error.code === "transport_error") return "transient";
  if (error.code === "http_error" && error.httpStatus !== undefined
    && (error.httpStatus === 408 || error.httpStatus === 429 || error.httpStatus >= 500)) {
    return "transient";
  }
  return null;
}

function failureFacts(error: DriverTimeoutError | DirectProviderRequestError): {
  readonly category: TechnicalFailureCategory;
  readonly domain: FaultDomain;
  readonly countsTowardModelFailure: boolean;
} {
  if (error instanceof DriverTimeoutError) {
    return {
      category: error.category,
      domain: "undetermined",
      countsTowardModelFailure: false,
    };
  }
  return {
    category: error.code,
    domain: error.domain,
    countsTowardModelFailure: error.countsTowardModelFailure,
  };
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

async function runStrictEpisode(config: EpisodeRunConfig): Promise<EpisodeRunOutput> {
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
  const attemptTimeoutMs = descriptor.driver === "direct"
    ? directAttemptTimeoutMs(decisionTimeoutMs)
    : decisionTimeoutMs;
  const defaultWallClock = maxActions * decisionTimeoutMs;
  const totalWallClockMs = validateTimeout(
    config.totalWallClockMs ?? defaultWallClock,
    "totalWallClockMs",
    2_147_483_647,
  );
  let actionCount = 0;
  let validActionCount = 0;
  let invalidActionCount = 0;
  let recoveredDecisionCount = 0;
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
      if (validActionCount >= maxActions) {
        environment.terminateTechnical(
          "tool_limit",
          `有效动作数达到上限 ${maxActions}。`,
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
      const actionIndex = validActionCount;
      const decisionDeadline = Math.min(
        wallClockDeadline,
        performance.now() + decisionTimeoutMs,
      );
      let attemptIndex = 0;
      let repairRetries = 0;
      let transientRetries = 0;
      let retryFeedback: DecisionRetryFeedback | undefined;
      if (config.onProgress) {
        emitProgress(config.onProgress, Object.freeze({
          ...base,
          event: "decision_started",
          actionIndex,
          day: environment.observe().state.day,
          historyLength: history.length,
          requestCount: config.driver.getRunMetrics?.().requestCount ?? 0,
        }));
      }
      while (environment.observe().state.status === "running") {
        const now = performance.now();
        const logicalRemaining = Math.floor(decisionDeadline - now);
        const wallRemaining = Math.floor(wallClockDeadline - now);
        if (logicalRemaining <= 0 || wallRemaining <= 0) {
          throw new DriverTimeoutError(
            "decide",
            decisionTimeoutMs,
            wallRemaining <= 0 ? "total_wall_clock" : "timeout",
          );
        }
        const effectiveAttemptTimeout = Math.max(
          1,
          Math.min(attemptTimeoutMs, logicalRemaining, wallRemaining),
        );
        const timeoutCategory = wallRemaining <= effectiveAttemptTimeout
          ? "total_wall_clock" as const
          : "timeout" as const;
        driverPhase = "decide";
        if (config.onProgress) {
          emitProgress(config.onProgress, Object.freeze({
            ...base,
            event: "attempt_started",
            actionIndex,
            attemptIndex,
            day: environment.observe().state.day,
            requestCount: config.driver.getRunMetrics?.().requestCount ?? 0,
            retryCategory: retryFeedback?.category ?? null,
          }));
        }

        let decision: AgentDecisionOutput;
        try {
          decision = normalizeDecisionOutput(await withDriverTimeout(
            "decide",
            effectiveAttemptTimeout,
            timeoutCategory,
            signal => config.driver.decide({
              matchId: config.matchId,
              observation: environment.observe(),
              actionIndex,
              attemptIndex,
              ...(retryFeedback ? { retryFeedback } : {}),
              history: [...history],
              signal,
            }),
          ));
        } catch (error: unknown) {
          if (!(error instanceof DriverTimeoutError)
            && !(error instanceof DirectProviderRequestError)) throw error;
          const facts = failureFacts(error);
          const evidence = error instanceof DriverTimeoutError
            ? config.driver.recordExternalDecisionFailure?.(
              facts.category,
              facts.domain,
              facts.countsTowardModelFailure,
            )
            : config.driver.getActiveDecisionEvidence?.();
          const retryKind = descriptor.driver === "direct" ? retryKindFor(error) : null;
          const withinAttemptLimit = attemptIndex + 1 < DIRECT_MAX_ATTEMPTS_PER_DECISION;
          const canRetryRepair = retryKind === "repair"
            && repairRetries < DIRECT_MAX_REPAIR_RETRIES_PER_DECISION;
          const canRetryTransient = retryKind === "transient"
            && transientRetries < DIRECT_MAX_TRANSIENT_RETRIES_PER_DECISION;
          const willRetry = withinAttemptLimit && (canRetryRepair || canRetryTransient)
            && performance.now() < decisionDeadline
            && performance.now() < wallClockDeadline;
          if (config.onProgress) {
            const metrics = config.driver.getRunMetrics?.();
            emitProgress(config.onProgress, Object.freeze({
              ...base,
              event: "attempt_failed",
              actionIndex,
              attemptIndex,
              category: facts.category,
              faultDomain: facts.domain,
              willRetry,
              requestCount: metrics?.requestCount ?? 0,
              lastCallLatencyMs: metrics?.calls.at(-1)?.latencyMs ?? null,
            }));
          }
          if (!willRetry) throw error;
          linkRetryEvidence(config.driver, evidence, facts.category);
          if (retryKind === "repair") repairRetries++;
          else transientRetries++;
          retryFeedback = Object.freeze({
            category: facts.category,
            ...(error instanceof DirectProviderRequestError && error.actionRepairCode
              ? { actionErrorCode: error.actionRepairCode }
              : {}),
            ...(error instanceof DirectProviderRequestError && error.rejectedAction
              ? { rejectedAction: error.rejectedAction }
              : {}),
          });
          attemptIndex++;
          continue;
        }

        driverPhase = "action";
        const result = environment.step(decision.action, decision.evidence);
        actionCount++;
        if (result.event) {
          linkActionEvidence(config.driver, decision.evidence, result.event.id);
          history.push(Object.freeze({
            actionIndex,
            attemptIndex,
            dayBefore: result.before.day,
            dayAfter: result.after.day,
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
            attemptIndex,
            actionType: decision.action.type,
            actionSucceeded: result.success,
            dayBefore: result.before.day,
            dayAfter: result.after.day,
            stateStatus: result.after.status,
            requestCount: metrics?.requestCount ?? 0,
            successfulRequestCount: metrics?.successfulRequestCount ?? 0,
            failedRequestCount: metrics?.failedRequestCount ?? 0,
            retryAttemptCount: metrics?.retryAttemptCount ?? 0,
            recoveredByRetry: result.success && attemptIndex > 0,
            lastCallLatencyMs: lastCall?.latencyMs ?? null,
            lastCallInputTokens: lastCall?.tokenUsage?.inputTokens ?? null,
            lastCallOutputTokens: lastCall?.tokenUsage?.outputTokens ?? null,
            cumulativeTotalTokens: metrics?.totalTokens ?? 0,
          }));
        }
        if (result.success) {
          validActionCount++;
          if (attemptIndex > 0) recoveredDecisionCount++;
          consecutiveInvalid = 0;
          break;
        }

        invalidActionCount++;
        consecutiveInvalid++;
        const canRepair = descriptor.driver === "direct"
          && attemptIndex + 1 < DIRECT_MAX_ATTEMPTS_PER_DECISION
          && repairRetries < DIRECT_MAX_REPAIR_RETRIES_PER_DECISION
          && performance.now() < decisionDeadline
          && performance.now() < wallClockDeadline;
        if (canRepair) {
          repairRetries++;
          retryFeedback = Object.freeze({
            category: "invalid_action",
            ...(result.event?.result.code ? { actionErrorCode: result.event.result.code } : {}),
            rejectedAction: decision.action,
          });
          attemptIndex++;
          continue;
        }
        if (consecutiveInvalid >= maxInvalid || descriptor.driver === "direct") {
          const limit = descriptor.driver === "direct"
            ? DIRECT_MAX_REPAIR_RETRIES_PER_DECISION + 1
            : maxInvalid;
          environment.terminateTechnical(
            "loop_terminated",
            `连续 ${limit} 次动作无效。`,
            {
              category: "invalid_action_loop",
              phase: "action",
              domain: "model",
              countsTowardModelFailure: true,
            },
          );
        }
        break;
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
    validActionCount,
    invalidActionCount,
    timeoutCount: timeoutPhase ? 1 : 0,
    attemptTimeoutMs,
    retryAttemptCount: requestMetrics?.retryAttemptCount ?? 0,
    recoveredDecisionCount,
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
      validActionCount,
      invalidActionCount,
      requestCount: requestMetrics?.requestCount ?? 0,
      successfulRequestCount: requestMetrics?.successfulRequestCount ?? 0,
      failedRequestCount: requestMetrics?.failedRequestCount ?? 0,
      retryAttemptCount: requestMetrics?.retryAttemptCount ?? 0,
      recoveredDecisionCount,
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

function normalizeDailyDecisionOutput(
  value: GameAction | AgentDecisionOutput,
): AgentDailyPlanDecisionOutput {
  if (value && typeof value === "object" && "dailyPlanSelection" in value) {
    return value as AgentDailyPlanDecisionOutput;
  }
  throw new Error("Completion-Assisted Episode 未收到 Daily Plan 选择");
}

function roundedMs(value: number): number {
  return Math.max(0, Math.round(value * 1_000) / 1_000);
}

async function waitForBackoff(
  milliseconds: number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  if (milliseconds <= 0) return;
  await sleep(milliseconds);
}

async function runCompletionAssistedEpisode(
  config: EpisodeRunConfig,
): Promise<EpisodeRunOutput> {
  if (config.driver.descriptor.driver !== "direct") {
    throw new Error("Completion-Assisted 仅支持 Direct Driver");
  }
  const descriptor = config.driver.descriptor;
  const episodeConfig: EpisodeConfig = {
    matchId: config.matchId,
    episodeId: `${config.matchId}:slot-${descriptor.slot}`,
    agentId: descriptor.id,
    agentSlot: descriptor.slot,
    seed: config.seed,
    scenario: config.scenario,
  };
  const attemptTimeoutMs = validateTimeout(
    config.decisionTimeoutMs ?? COMPLETION_ATTEMPT_TIMEOUT_MS,
    "Completion-Assisted attemptTimeoutMs",
  );
  const providerTimeBudgetMs = validateTimeout(
    config.providerTimeBudgetMs ?? COMPLETION_PROVIDER_TIME_BUDGET_MS,
    "Completion-Assisted providerTimeBudgetMs",
    2_147_483_647,
  );
  const maxDailyDecisions = validateActionLimit(
    config.maxDailyDecisions ?? config.scenario.totalDays,
    "Completion-Assisted maxDailyDecisions",
    config.scenario.totalDays,
  );
  const backoffSchedule = config.completionBackoffScheduleMs ?? COMPLETION_BACKOFF_SCHEDULE_MS;
  const clock = config.completionClock ?? {
    now: () => performance.now(),
    sleep: (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
  };
  if (backoffSchedule.length !== 2
    || backoffSchedule.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Completion-Assisted backoff schedule 无效");
  }

  const environment = new GameEnvironment();
  const history: AgentDecisionHistoryEntry[] = [];
  const base = progressBase(config.driver);
  let actionCount = 0;
  let validActionCount = 0;
  let invalidActionCount = 0;
  let timeoutCount = 0;
  let recoveredDecisionCount = 0;
  let autonomousDays = 0;
  let assistedDays = 0;
  let providerAttemptedDays = 0;
  let firstAttemptSuccessDays = 0;
  let validPlanSelections = 0;
  let selectionResponseCount = 0;
  let providerWaitMs = 0;
  let circuitSkippedDays = 0;
  let providerBudgetExhaustedDays = 0;
  const assistanceReasons: Partial<Record<AssistanceReason, number>> = {};
  let transientExhaustionStreak = 0;
  let circuitLevel = 0;
  let circuitSkipRemaining = 0;
  let halfOpenPending = false;
  let circuitTriggerModelCallIds: string[] = [];
  let circuitFailureCategory: TechnicalFailureCategory | undefined;
  let permanentFailureCategory: TechnicalFailureCategory | undefined;
  let permanentTriggerModelCallIds: string[] = [];
  let budgetExhausted = false;
  let budgetTriggerModelCallIds: string[] = [];
  let diagnostic: string | undefined;

  environment.reset(episodeConfig);
  if (config.onProgress) {
    emitProgress(config.onProgress, Object.freeze({
      ...base,
      event: "episode_started",
      day: environment.observe().state.day,
    }));
  }

  const applyAssistance = (
    reason: AssistanceReason,
    failureCategory: TechnicalFailureCategory | undefined,
    triggerModelCallIds: readonly string[],
    circuitDaysRemaining?: number,
  ) => {
    const result = environment.assistPassDay({
      policyVersion: COMPLETION_ASSISTANCE_POLICY_VERSION,
      reason,
      ...(failureCategory ? { failureCategory } : {}),
      triggerModelCallIds: Object.freeze([...triggerModelCallIds]),
      ...(circuitDaysRemaining !== undefined
        ? { circuitSkipDaysRemaining: circuitDaysRemaining }
        : {}),
    });
    if (!result.success || !result.event || result.event.type !== "assistance") {
      throw new Error("Completion-Assisted 辅助过日提交失败");
    }
    actionCount++;
    assistedDays++;
    assistanceReasons[reason] = (assistanceReasons[reason] ?? 0) + 1;
    if (reason === "circuit_open") circuitSkippedDays++;
    if (reason === "provider_time_budget_exhausted") providerBudgetExhaustedDays++;
    history.push(Object.freeze({
      actionIndex: result.before.day,
      attemptIndex: 0,
      dayBefore: result.before.day,
      dayAfter: result.after.day,
      action: result.event.action ?? Object.freeze({ type: "assisted_pass_day" }),
      result: Object.freeze({
        success: true,
        code: null,
        message: result.event.result.message,
        effects: result.event.result.effects,
      }),
      stateDiff: result.event.stateDiff,
    }));
    if (config.onProgress) {
      emitProgress(config.onProgress, Object.freeze({
        ...base,
        event: "assistance_completed",
        dayBefore: result.before.day,
        dayAfter: result.after.day,
        reason,
        failureCategory: failureCategory ?? null,
        assistedDays,
        providerWaitMs: roundedMs(providerWaitMs),
        circuitSkipDaysRemaining: circuitDaysRemaining ?? null,
      }));
    }
    return result.event;
  };

  try {
    await withDriverTimeout("reset", config.resetTimeoutMs ?? 5_000, "timeout", signal => (
      config.driver.reset?.({ signal })
    ));
    while (environment.observe().state.status === "running") {
      const currentDay = environment.observe().state.day;
      if (currentDay >= maxDailyDecisions) {
        environment.terminateTechnical(
          "tool_limit",
          `Completion-Assisted 日决策数达到门禁上限 ${maxDailyDecisions}。`,
          {
            category: "action_budget",
            phase: "action",
            domain: "runner",
            countsTowardModelFailure: false,
          },
        );
        break;
      }

      if (budgetExhausted || providerWaitMs >= providerTimeBudgetMs) {
        budgetExhausted = true;
        applyAssistance(
          "provider_time_budget_exhausted",
          "total_wall_clock",
          budgetTriggerModelCallIds,
        );
        continue;
      }
      if (permanentFailureCategory) {
        applyAssistance(
          "non_retryable_failure",
          permanentFailureCategory,
          permanentTriggerModelCallIds,
        );
        continue;
      }
      if (circuitSkipRemaining > 0) {
        const remainingAfterThisDay = circuitSkipRemaining - 1;
        applyAssistance(
          "circuit_open",
          circuitFailureCategory,
          circuitTriggerModelCallIds,
          remainingAfterThisDay,
        );
        circuitSkipRemaining = remainingAfterThisDay;
        if (circuitSkipRemaining === 0) halfOpenPending = true;
        continue;
      }

      const dailyPlanOptions = generateDailyPlanOptions(environment);
      const decisionDay = environment.observe().state.day;
      providerAttemptedDays++;
      const halfOpenThisDay = halfOpenPending;
      halfOpenPending = false;
      const attemptLimit = halfOpenThisDay ? 1 : COMPLETION_MAX_ATTEMPTS_PER_DAY;
      const triggerModelCallIds: string[] = [];
      let attemptIndex = 0;
      let transientRetryIndex = 0;
      let retryFeedback: DecisionRetryFeedback | undefined;
      let committed = false;
      let finalEvidence: ModelDecisionEvidence | undefined;
      let finalFailureCategory: TechnicalFailureCategory | undefined;
      let finalFailureKind: ReturnType<typeof completionFailureKind> | undefined;

      if (config.onProgress) {
        emitProgress(config.onProgress, Object.freeze({
          ...base,
          event: "decision_started",
          actionIndex: decisionDay,
          day: decisionDay,
          historyLength: history.length,
          requestCount: config.driver.getRunMetrics?.().requestCount ?? 0,
        }));
      }

      while (attemptIndex < attemptLimit && environment.observe().state.status === "running") {
        const remainingBudget = Math.floor(providerTimeBudgetMs - providerWaitMs);
        if (remainingBudget <= 0) {
          budgetExhausted = true;
          finalFailureCategory = "total_wall_clock";
          break;
        }
        const effectiveTimeout = Math.max(1, Math.min(attemptTimeoutMs, remainingBudget));
        if (config.onProgress) {
          emitProgress(config.onProgress, Object.freeze({
            ...base,
            event: "attempt_started",
            actionIndex: decisionDay,
            attemptIndex,
            day: decisionDay,
            requestCount: config.driver.getRunMetrics?.().requestCount ?? 0,
            retryCategory: retryFeedback?.category ?? null,
          }));
        }

        const requestStartedAt = clock.now();
        try {
          const decision = normalizeDailyDecisionOutput(await withDriverTimeout(
            "decide",
            effectiveTimeout,
            "timeout",
            signal => config.driver.decide({
              matchId: config.matchId,
              observation: environment.observe(),
              actionIndex: decisionDay,
              attemptIndex,
              ...(retryFeedback ? { retryFeedback } : {}),
              history: [...history],
              dailyPlanOptions,
              signal,
            }),
          ));
          providerWaitMs += Math.max(0, clock.now() - requestStartedAt);
          selectionResponseCount++;
          validPlanSelections++;
          const selectedPlan = dailyPlanOptions.plans.find(
            plan => plan.id === decision.dailyPlanSelection.planId,
          );
          if (!selectedPlan) throw new Error("已验证的 Daily Plan 在提交前消失");
          const prepRevalidation = environment.previewActions(selectedPlan.actions);
          if (!prepRevalidation.success
            || integrityHash(prepRevalidation.after) !== selectedPlan.resultingStateHash) {
            throw new Error("Daily Plan 候选状态与提交前重验证不一致");
          }
          const fullRevalidation = environment.previewDailyPlan(
            selectedPlan.actions,
            decision.dailyPlanSelection.destinationId,
          );
          if (!fullRevalidation.success) {
            throw new Error("Daily Plan 日内操作与移动无法整体执行");
          }
          const result = environment.executeDailyPlan(
            selectedPlan.actions,
            decision.dailyPlanSelection.destinationId,
            decision.evidence,
            integrityHash(fullRevalidation.after),
          );
          if (!result.success || result.events.length < 1) {
            throw new Error("Daily Plan 预验证与原子提交结果不一致");
          }
          if (decision.evidence) {
            budgetTriggerModelCallIds = [decision.evidence.modelCallId];
            config.driver.linkModelCallEvidence?.(decision.evidence.modelCallId, {
              actionEventIds: result.events.map(event => event.id),
            });
          }
          for (const event of result.events) {
            if (event.type !== "action" || !event.action) {
              throw new Error("Daily Plan 产生了非动作事件");
            }
            history.push(Object.freeze({
              actionIndex: decisionDay,
              attemptIndex,
              dayBefore: event.stateBefore.day,
              dayAfter: event.stateAfter.day,
              action: event.action,
              result: Object.freeze({
                success: event.result.success,
                code: event.result.code ?? null,
                message: event.result.message,
                effects: event.result.effects,
              }),
              stateDiff: event.stateDiff,
            }));
            actionCount++;
            validActionCount++;
            if (config.onProgress) {
              const metrics = config.driver.getRunMetrics?.();
              const lastCall = metrics?.calls.at(-1);
              emitProgress(config.onProgress, Object.freeze({
                ...base,
                event: "action_completed",
                actionIndex: decisionDay,
                attemptIndex,
                actionType: (event.action as GameAction).type,
                actionSucceeded: true,
                dayBefore: event.stateBefore.day,
                dayAfter: event.stateAfter.day,
                stateStatus: event.stateAfter.status,
                requestCount: metrics?.requestCount ?? 0,
                successfulRequestCount: metrics?.successfulRequestCount ?? 0,
                failedRequestCount: metrics?.failedRequestCount ?? 0,
                retryAttemptCount: metrics?.retryAttemptCount ?? 0,
                recoveredByRetry: attemptIndex > 0,
                lastCallLatencyMs: lastCall?.latencyMs ?? null,
                lastCallInputTokens: lastCall?.tokenUsage?.inputTokens ?? null,
                lastCallOutputTokens: lastCall?.tokenUsage?.outputTokens ?? null,
                cumulativeTotalTokens: metrics?.totalTokens ?? 0,
              }));
            }
          }
          autonomousDays++;
          if (attemptIndex === 0) firstAttemptSuccessDays++;
          else recoveredDecisionCount++;
          transientExhaustionStreak = 0;
          circuitLevel = 0;
          circuitTriggerModelCallIds = [];
          circuitFailureCategory = undefined;
          committed = true;
          if (config.onProgress) {
            emitProgress(config.onProgress, Object.freeze({
              ...base,
              event: "daily_plan_completed",
              actionIndex: decisionDay,
              attemptIndex,
              planId: selectedPlan.id,
              destinationId: decision.dailyPlanSelection.destinationId,
              committedActions: result.events.length,
              dayBefore: result.before.day,
              dayAfter: result.after.day,
              requestCount: config.driver.getRunMetrics?.().requestCount ?? 0,
              providerWaitMs: roundedMs(providerWaitMs),
            }));
          }
          break;
        } catch (error: unknown) {
          providerWaitMs += Math.max(0, clock.now() - requestStartedAt);
          if (!(error instanceof DriverTimeoutError)
            && !(error instanceof DirectProviderRequestError)) {
            throw error;
          }
          const facts = failureFacts(error);
          const evidence = error instanceof DriverTimeoutError
            ? config.driver.recordExternalDecisionFailure?.(
              facts.category,
              facts.domain,
              facts.countsTowardModelFailure,
            )
            : config.driver.getActiveDecisionEvidence?.();
          finalEvidence = evidence;
          if (evidence) {
            triggerModelCallIds.push(evidence.modelCallId);
            budgetTriggerModelCallIds = [evidence.modelCallId];
          }
          finalFailureCategory = facts.category;
          finalFailureKind = completionFailureKind(
            facts.category,
            error instanceof DirectProviderRequestError ? error.httpStatus : undefined,
            error instanceof DirectProviderRequestError ? error.retryDisposition : undefined,
          );
          if (facts.category === "timeout") timeoutCount++;
          if (finalFailureKind === "repair") {
            invalidActionCount++;
            selectionResponseCount++;
          }
          const retryCategory = facts.category;
          const nextAttemptFits = attemptIndex + 1 < attemptLimit;
          const backoffMs = finalFailureKind === "transient"
            ? backoffSchedule[Math.min(transientRetryIndex, backoffSchedule.length - 1)]
            : 0;
          const budgetAllowsRetry = providerWaitMs + backoffMs < providerTimeBudgetMs;
          const willRetry = finalFailureKind !== "non_retryable"
            && nextAttemptFits
            && budgetAllowsRetry;
          if (config.onProgress) {
            const metrics = config.driver.getRunMetrics?.();
            emitProgress(config.onProgress, Object.freeze({
              ...base,
              event: "attempt_failed",
              actionIndex: decisionDay,
              attemptIndex,
              category: facts.category,
              faultDomain: facts.domain,
              willRetry,
              requestCount: metrics?.requestCount ?? 0,
              lastCallLatencyMs: metrics?.calls.at(-1)?.latencyMs ?? null,
            }));
          }
          if (!willRetry) {
            if (!budgetAllowsRetry && finalFailureKind !== "non_retryable") {
              budgetExhausted = true;
              finalFailureCategory = "total_wall_clock";
            }
            break;
          }
          linkRetryEvidence(config.driver, evidence, retryCategory);
          retryFeedback = Object.freeze({
            category: retryCategory,
            ...(error instanceof DirectProviderRequestError && error.actionRepairCode
              ? { actionErrorCode: error.actionRepairCode }
              : {}),
            ...(error instanceof DirectProviderRequestError && error.rejectedAction
              ? { rejectedAction: error.rejectedAction }
              : {}),
          });
          if (finalFailureKind === "transient") {
            await waitForBackoff(backoffMs, clock.sleep);
            providerWaitMs += backoffMs;
            transientRetryIndex++;
          }
          attemptIndex++;
        }
      }

      if (committed) continue;

      let assistanceReason: AssistanceReason;
      if (budgetExhausted || providerWaitMs >= providerTimeBudgetMs) {
        budgetExhausted = true;
        assistanceReason = "provider_time_budget_exhausted";
        finalFailureCategory = "total_wall_clock";
        if (triggerModelCallIds.length > 0) {
          budgetTriggerModelCallIds = [...triggerModelCallIds];
        }
      } else if (finalFailureKind === "non_retryable") {
        assistanceReason = "non_retryable_failure";
        permanentFailureCategory = finalFailureCategory ?? "driver_error";
        permanentTriggerModelCallIds = [...triggerModelCallIds];
      } else if (finalFailureKind === "repair") {
        assistanceReason = "repair_retries_exhausted";
        transientExhaustionStreak = 0;
        circuitLevel = 0;
        circuitTriggerModelCallIds = [];
        circuitFailureCategory = undefined;
      } else {
        assistanceReason = "transient_retries_exhausted";
      }
      const assistanceEvent = applyAssistance(
        assistanceReason,
        finalFailureCategory,
        triggerModelCallIds,
      );
      if (finalEvidence) {
        config.driver.linkModelCallEvidence?.(finalEvidence.modelCallId, {
          assistanceEventId: assistanceEvent.id,
        });
      }

      if (assistanceReason === "transient_retries_exhausted") {
        if (halfOpenThisDay) {
          circuitSkipRemaining = circuitSkipDays(circuitLevel);
          circuitLevel++;
          circuitTriggerModelCallIds = [...triggerModelCallIds];
          circuitFailureCategory = finalFailureCategory;
          transientExhaustionStreak = 0;
        } else {
          transientExhaustionStreak++;
          if (transientExhaustionStreak >= COMPLETION_CIRCUIT_FAILURE_THRESHOLD) {
            circuitSkipRemaining = circuitSkipDays(circuitLevel);
            circuitLevel++;
            circuitTriggerModelCallIds = [...triggerModelCallIds];
            circuitFailureCategory = finalFailureCategory;
            transientExhaustionStreak = 0;
          }
        }
      }
    }
  } catch (error: unknown) {
    diagnostic = error instanceof DriverTimeoutError ? error.category : "driver_threw";
    const evidence = error instanceof DriverTimeoutError
      ? config.driver.recordExternalDecisionFailure?.(
        error.category,
        "runner",
        false,
      )
      : config.driver.getActiveDecisionEvidence?.();
    environment.terminateTechnical(
      error instanceof DriverTimeoutError ? "model_timeout" : "runtime_error",
      error instanceof DriverTimeoutError
        ? "Completion-Assisted Driver 初始化超时。"
        : "Completion-Assisted Runner 或事实层执行失败。",
      {
        category: error instanceof DriverTimeoutError ? error.category : "driver_error",
        phase: error instanceof DriverTimeoutError ? error.phase : "action",
        domain: "runner",
        countsTowardModelFailure: false,
      },
      evidence,
    );
    const termination = environment.eventLog.at(-1);
    linkTerminationEvidence(
      config.driver,
      evidence,
      termination?.type === "technical_termination" ? termination.id : undefined,
    );
  }

  environment.finalize();
  const trace = environment.exportTrace(descriptor);
  const requestMetrics = config.driver.getRunMetrics?.();
  const advancedDays = trace.finalResult.endDay;
  const reliability = Object.freeze({
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
    providerRequestSuccessRate: completionRate(
      requestMetrics?.successfulRequestCount ?? 0,
      requestMetrics?.requestCount ?? 0,
    ),
    providerWaitMs: roundedMs(providerWaitMs),
    retryCount: requestMetrics?.retryAttemptCount ?? 0,
    circuitSkippedDays,
    providerBudgetExhaustedDays,
    assistanceReasons: Object.freeze(assistanceReasons),
  });
  const report = Object.freeze({
    agentId: descriptor.id,
    agentSlot: descriptor.slot,
    driver: descriptor.driver,
    status: trace.finalResult.status,
    actionCount,
    validActionCount,
    invalidActionCount,
    timeoutCount,
    attemptTimeoutMs,
    retryAttemptCount: requestMetrics?.retryAttemptCount ?? 0,
    recoveredDecisionCount,
    totalWallClockMs: providerTimeBudgetMs,
    traceHash: trace.traceHash,
    reliability,
    ...(trace.finalResult.technicalFailure ? { technicalFailure: trace.finalResult.technicalFailure } : {}),
    ...(requestMetrics ? { requestMetrics } : {}),
    ...(diagnostic ? { diagnostic } : {}),
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
      validActionCount,
      invalidActionCount,
      requestCount: requestMetrics?.requestCount ?? 0,
      successfulRequestCount: requestMetrics?.successfulRequestCount ?? 0,
      failedRequestCount: requestMetrics?.failedRequestCount ?? 0,
      retryAttemptCount: requestMetrics?.retryAttemptCount ?? 0,
      recoveredDecisionCount,
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
  return { trace, report };
}

export async function runEpisode(config: EpisodeRunConfig): Promise<EpisodeRunOutput> {
  return config.completionAssisted
    ? runCompletionAssistedEpisode(config)
    : runStrictEpisode(config);
}
