import { performance } from "node:perf_hooks";
import type {
  GameAction,
  ProviderThinkingMode,
  ScenarioConfig,
  TechnicalFailureCategory,
} from "../core/contracts.js";
import { GameEnvironment } from "../core/game-environment.js";
import type { AgentDriver, ProviderTokenUsage } from "./agent-driver.js";
import { DirectProviderRequestError } from "./agent-driver.js";

export interface ProviderProbeEntry {
  readonly agentId: string;
  readonly agentSlot: number;
  readonly provider: string;
  readonly model: string;
  readonly providerAdapterVersion: string;
  readonly providerThinkingMode?: ProviderThinkingMode;
  readonly passed: boolean;
  readonly action?: GameAction;
  readonly usage?: ProviderTokenUsage;
  readonly latencyMs: number;
  readonly errorCategory?: TechnicalFailureCategory;
  readonly httpStatus?: number;
}

export interface ProviderProbeResult {
  readonly artifactType: "arena-provider-probe-v1";
  readonly passed: boolean;
  readonly requestCount: number;
  readonly entries: readonly ProviderProbeEntry[];
}

export interface ProviderProbeConfig {
  readonly seed: number;
  readonly scenario: ScenarioConfig;
  readonly drivers: readonly AgentDriver[];
  readonly decisionTimeoutMs: number;
}

class ProbeTimeoutError extends Error {
  constructor() {
    super("Provider probe timed out");
    this.name = "ProbeTimeoutError";
  }
}

function safeLatency(startedAt: number): number {
  return Math.round(Math.max(0, performance.now() - startedAt) * 1_000) / 1_000;
}

async function probeOne(config: ProviderProbeConfig, driver: AgentDriver): Promise<ProviderProbeEntry> {
  const descriptor = driver.descriptor;
  const base = {
    agentId: descriptor.id,
    agentSlot: descriptor.slot,
    provider: descriptor.provider ?? "unknown",
    model: descriptor.model ?? "unknown",
    providerAdapterVersion: descriptor.providerAdapterVersion ?? "unknown",
    ...(descriptor.providerThinkingMode
      ? { providerThinkingMode: descriptor.providerThinkingMode }
      : {}),
  };
  const environment = new GameEnvironment();
  const observation = environment.reset({
    matchId: "arena-provider-probe",
    episodeId: `arena-provider-probe:slot-${descriptor.slot}`,
    agentId: descriptor.id,
    agentSlot: descriptor.slot,
    seed: config.seed,
    scenario: config.scenario,
  });
  const controller = new AbortController();
  const startedAt = performance.now();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const timeoutError = new ProbeTimeoutError();
        controller.abort(timeoutError);
        reject(timeoutError);
      }, config.decisionTimeoutMs);
    });
    const action = await Promise.race([
      Promise.resolve(driver.decide({
        observation,
        actionIndex: 0,
        recentResults: [],
        signal: controller.signal,
      })),
      timeout,
    ]);
    const step = environment.step(action);
    if (!step.success) {
      return Object.freeze({
        ...base,
        passed: false,
        latencyMs: safeLatency(startedAt),
        errorCategory: "invalid_response" as const,
      });
    }
    const metrics = driver.getRunMetrics?.();
    const usage = metrics && metrics.usageReportedRequestCount === 1
      ? Object.freeze({
          inputTokens: metrics.inputTokens,
          outputTokens: metrics.outputTokens,
          totalTokens: metrics.totalTokens,
        })
      : undefined;
    return Object.freeze({
      ...base,
      passed: true,
      action,
      ...(usage ? { usage } : {}),
      latencyMs: safeLatency(startedAt),
    });
  } catch (error: unknown) {
    if (error instanceof ProbeTimeoutError
      || (controller.signal.aborted && controller.signal.reason instanceof ProbeTimeoutError)) {
      return Object.freeze({
        ...base,
        passed: false,
        latencyMs: safeLatency(startedAt),
        errorCategory: "timeout" as const,
      });
    }
    if (error instanceof DirectProviderRequestError) {
      return Object.freeze({
        ...base,
        passed: false,
        latencyMs: safeLatency(startedAt),
        errorCategory: error.code,
        ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
      });
    }
    return Object.freeze({
      ...base,
      passed: false,
      latencyMs: safeLatency(startedAt),
      errorCategory: "driver_error" as const,
    });
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

export async function probeProviders(config: ProviderProbeConfig): Promise<ProviderProbeResult> {
  if (config.drivers.length !== 4) throw new Error("Provider Probe 必须恰好配置四个 Agent");
  if (!Number.isSafeInteger(config.decisionTimeoutMs)
    || config.decisionTimeoutMs < 1
    || config.decisionTimeoutMs > 600_000) {
    throw new Error("Provider Probe decisionTimeoutMs 必须为 1..600000 的安全整数");
  }
  const slots = new Set(config.drivers.map(driver => driver.descriptor.slot));
  if (slots.size !== 4 || [...slots].sort((a, b) => a - b).some((slot, index) => slot !== index)) {
    throw new Error("Provider Probe 的 Agent slot 必须唯一覆盖 0..3");
  }
  const entries = (await Promise.all(config.drivers.map(driver => probeOne(config, driver))))
    .sort((a, b) => a.agentSlot - b.agentSlot);
  const requestCount = config.drivers.reduce(
    (sum, driver) => sum + (driver.getRunMetrics?.().requestCount ?? 0),
    0,
  );
  if (requestCount !== 4) {
    throw new Error(`Provider Probe 请求计数守卫失败：预期 4，实际 ${requestCount}`);
  }
  return Object.freeze({
    artifactType: "arena-provider-probe-v1",
    passed: entries.every(entry => entry.passed),
    requestCount,
    entries: Object.freeze(entries),
  });
}
