import type {
  EpisodeConfig,
  EpisodeTrace,
  StepResult,
  TechnicalFailureDetail,
} from "../core/contracts.js";
import { GameEnvironment } from "../core/game-environment.js";
import type { ScenarioConfig } from "../core/contracts.js";
import type { AgentDriver, DirectModelRunMetrics } from "./agent-driver.js";
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
  ) {
    super(`driver ${phase} timed out after ${timeoutMs}ms`);
    this.name = "DriverTimeoutError";
  }
}

function validateTimeout(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 600_000) {
    throw new RangeError(`${name} 必须是 1 到 600000 之间的整数毫秒值`);
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
  operation: (signal: AbortSignal) => T | Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const timeoutError = new DriverTimeoutError(phase, timeoutMs);
      reject(timeoutError);
      controller.abort(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout,
    ]);
  } catch (error: unknown) {
    // An abort-aware provider (for example fetch) can reject immediately from
    // the abort event. Always preserve the Arena timeout classification once
    // our deadline has fired, regardless of which rejection wins the race.
    if (controller.signal.aborted && controller.signal.reason instanceof DriverTimeoutError) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
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
  let actionCount = 0;
  let invalidActionCount = 0;
  let consecutiveInvalid = 0;
  let diagnostic: string | undefined;
  let timeoutPhase: "reset" | "decide" | undefined;
  let driverPhase: "reset" | "decide" | "action" = "reset";
  const recentResults: StepResult[] = [];

  environment.reset(episodeConfig);
  try {
    driverPhase = "reset";
    await withDriverTimeout(
      "reset",
      resetTimeoutMs,
      signal => config.driver.reset?.({ signal }),
    );
    while (environment.observe().state.status === "running") {
      if (actionCount >= maxActions) {
        environment.terminateTechnical(
          "tool_limit",
          `动作数达到上限 ${maxActions}。`,
          { category: "action_budget", phase: "action" },
        );
        break;
      }

      driverPhase = "decide";
      const action = await withDriverTimeout(
        "decide",
        decisionTimeoutMs,
        signal => config.driver.decide({
          observation: environment.observe(),
          actionIndex: actionCount,
          recentResults: recentResults.slice(-5),
          signal,
        }),
      );
      driverPhase = "action";
      const result = environment.step(action);
      actionCount++;
      recentResults.push(result);
      if (result.success) {
        consecutiveInvalid = 0;
      } else {
        invalidActionCount++;
        consecutiveInvalid++;
        if (consecutiveInvalid >= maxInvalid) {
          environment.terminateTechnical(
            "loop_terminated",
            `连续 ${maxInvalid} 次动作无效。`,
            { category: "invalid_action_loop", phase: "action" },
          );
          break;
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof DriverTimeoutError) {
      timeoutPhase = error.phase;
      diagnostic = `${error.phase}_timeout`;
      environment.terminateTechnical(
        "model_timeout",
        `Agent ${error.phase === "reset" ? "初始化" : "决策"}超时。`,
        { category: "timeout", phase: error.phase },
      );
    } else if (error instanceof DirectProviderRequestError) {
      diagnostic = error.code;
      environment.terminateTechnical(
        "runtime_error",
        "Provider 请求未能返回可执行的 Arena 动作。",
        {
          category: error.code,
          phase: "decide",
          provider: error.providerId,
          ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
        },
      );
    } else {
      diagnostic = "driver_threw";
      environment.terminateTechnical(
        "runtime_error",
        "Agent 驱动执行时抛出异常。",
        { category: "driver_error", phase: driverPhase },
      );
    }
  }

  environment.finalize();
  const trace = environment.exportTrace(descriptor);
  return {
    trace,
    report: Object.freeze({
      agentId: descriptor.id,
      agentSlot: descriptor.slot,
      driver: descriptor.driver,
      status: trace.finalResult.status,
      actionCount,
      validActionCount: actionCount - invalidActionCount,
      invalidActionCount,
      timeoutCount: timeoutPhase ? 1 : 0,
      traceHash: trace.traceHash,
      ...(trace.finalResult.technicalFailure
        ? { technicalFailure: trace.finalResult.technicalFailure }
        : {}),
      ...(config.driver.getRunMetrics
        ? { requestMetrics: config.driver.getRunMetrics() }
        : {}),
      ...(diagnostic ? { diagnostic } : {}),
      ...(timeoutPhase ? { timeoutPhase } : {}),
    }),
  };
}
