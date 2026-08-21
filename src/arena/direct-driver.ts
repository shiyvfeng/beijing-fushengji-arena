import { performance } from "node:perf_hooks";
import type { AgentDescriptor, GameAction, ModelObservation, Observation } from "../core/contracts.js";
import { immutableClone, integrityHash } from "../core/stable-value.js";
import type {
  AgentDecisionInput,
  AgentDriver,
  DirectCompetitionProfile,
  DirectModelProviderAdapter,
  DirectModelRunMetrics,
} from "./agent-driver.js";
import { DirectProviderRequestError } from "./agent-driver.js";

export const DIRECT_DECISION_POLICY_ID = "neutral-v1" as const;
export const DIRECT_MODEL_OBSERVATION_VERSION = "identity-free-v1" as const;
export const DIRECT_DECISION_POLICY_TEXT = [
  "Maximize final net worth while staying alive and completing the full 40-day episode.",
  "Use only the supplied facts and rules. Balance liquidity, health, debt, inventory risk and terminal liquidation.",
  "Do not adopt a persona, role, slot-specific style or provider-specific strategy.",
].join("\n");
export const DIRECT_DECISION_POLICY_HASH = integrityHash({
  policyId: DIRECT_DECISION_POLICY_ID,
  policyText: DIRECT_DECISION_POLICY_TEXT,
  modelObservationVersion: DIRECT_MODEL_OBSERVATION_VERSION,
  actionContract: "arena-game-action-v1",
});

export interface DirectModelDriverConfig {
  readonly id: string;
  readonly displayName: string;
  readonly personaId: string;
  readonly slot: number;
  readonly provider: DirectModelProviderAdapter;
}

export interface DefaultDirectAgentSpec {
  readonly id: string;
  readonly displayName: string;
  readonly personaId: string;
}

export const DEFAULT_DIRECT_AGENT_SPECS: readonly DefaultDirectAgentSpec[] = Object.freeze([
  Object.freeze({
    id: "agent-steady",
    displayName: "稳健铁算盘",
    personaId: "steady",
  }),
  Object.freeze({
    id: "agent-value",
    displayName: "胡同捡漏王",
    personaId: "value",
  }),
  Object.freeze({
    id: "agent-aggressive",
    displayName: "京城冲浪客",
    personaId: "aggressive",
  }),
  Object.freeze({
    id: "agent-cash",
    displayName: "现金守门员",
    personaId: "cash-first",
  }),
]);

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} 不能为空`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  if (!ownKeys.every((key): key is string => typeof key === "string")) return false;
  const actual = [...ownKeys].sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/**
 * Parse the untrusted provider result into the only value allowed to reach
 * GameEnvironment. Unknown fields, coercions and non-finite/fractional numbers
 * are rejected instead of being recorded in episode evidence.
 */
export function parseDirectGameAction(value: unknown): GameAction {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Direct Model 返回值不是合法的 GameAction 对象");
  }

  switch (value.type) {
    case "move":
      if (hasExactKeys(value, ["type", "locationId"])
        && isNonNegativeSafeInteger(value.locationId)) {
        return Object.freeze({ type: "move", locationId: value.locationId });
      }
      break;
    case "buy":
    case "sell":
      if (hasExactKeys(value, ["type", "itemId", "quantity"])
        && isNonNegativeSafeInteger(value.itemId)
        && isPositiveSafeInteger(value.quantity)) {
        return Object.freeze({
          type: value.type,
          itemId: value.itemId,
          quantity: value.quantity,
        });
      }
      break;
    case "deposit":
    case "withdraw":
    case "repay_debt":
      if (hasExactKeys(value, ["type", "amount"])
        && isPositiveSafeInteger(value.amount)) {
        return Object.freeze({ type: value.type, amount: value.amount });
      }
      break;
    case "heal":
      if (hasExactKeys(value, ["type", "points"])
        && isPositiveSafeInteger(value.points)) {
        return Object.freeze({ type: "heal", points: value.points });
      }
      break;
    case "expand_capacity":
      if (hasExactKeys(value, ["type"])) {
        return Object.freeze({ type: "expand_capacity" });
      }
      break;
  }

  throw new Error("Direct Model 返回的动作不符合严格 GameAction 契约");
}

export class DirectModelDriver implements AgentDriver {
  readonly descriptor: AgentDescriptor;
  readonly competitionProfile: DirectCompetitionProfile;
  private readonly provider: DirectModelProviderAdapter;
  private requestCount = 0;
  private successfulRequestCount = 0;
  private usageReportedRequestCount = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalTokens = 0;
  private readonly latencies: number[] = [];
  private nextRequestMetricId = 0;
  private readonly pendingRequestStartedAt = new Map<number, number>();
  private readonly errorCounts: Partial<Record<DirectProviderRequestError["code"], number>> = {};

  constructor(config: DirectModelDriverConfig) {
    if (!Number.isSafeInteger(config.slot) || config.slot < 0) {
      throw new Error("DirectModelDriver slot 必须为非负安全整数");
    }
    this.provider = config.provider;
    const providerId = requireNonEmpty(config.provider.providerId, "providerId");
    const modelId = requireNonEmpty(config.provider.modelId, "modelId");
    const providerAdapterVersion = requireNonEmpty(config.provider.adapterVersion, "adapterVersion");
    if (!Number.isSafeInteger(config.provider.maxOutputTokens)
      || config.provider.maxOutputTokens < 16
      || config.provider.maxOutputTokens > 4_096) {
      throw new Error("Provider maxOutputTokens 必须为 16..4096 的安全整数");
    }
    this.competitionProfile = Object.freeze({
      decisionPolicyId: DIRECT_DECISION_POLICY_ID,
      decisionPolicyHash: DIRECT_DECISION_POLICY_HASH,
      modelObservationVersion: DIRECT_MODEL_OBSERVATION_VERSION,
      maxOutputTokensPerRequest: config.provider.maxOutputTokens,
    });
    this.descriptor = Object.freeze({
      id: requireNonEmpty(config.id, "Agent id"),
      displayName: requireNonEmpty(config.displayName, "Agent displayName"),
      personaId: requireNonEmpty(config.personaId, "Agent personaId"),
      slot: config.slot,
      driver: "direct" as const,
      decisionPolicyId: DIRECT_DECISION_POLICY_ID,
      decisionPolicyHash: DIRECT_DECISION_POLICY_HASH,
      provider: providerId,
      model: modelId,
      providerAdapterVersion,
      ...(config.provider.thinkingMode
        ? { providerThinkingMode: config.provider.thinkingMode }
        : {}),
    });
  }

  async decide(input: AgentDecisionInput): Promise<GameAction> {
    if (input.signal.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error("Direct Model 决策已取消");
    }
    this.requestCount++;
    const startedAt = performance.now();
    const requestMetricId = this.nextRequestMetricId++;
    this.pendingRequestStartedAt.set(requestMetricId, startedAt);
    try {
      const result = await this.provider.requestDecision({
        ...input,
        observation: createDirectModelObservation(input.observation),
        recentResults: input.recentResults.map(recent => Object.freeze({
          success: recent.success,
          ...(recent.code ? { code: recent.code } : {}),
          message: recent.message,
        })),
      });
      let action: GameAction;
      try {
        action = parseDirectGameAction(result.action);
      } catch {
        throw new DirectProviderRequestError(
          this.provider.providerId,
          "invalid_response",
          `${this.provider.providerId} 返回的动作不符合 Arena 契约`,
        );
      }
      this.successfulRequestCount++;
      if (result.usage) {
        this.usageReportedRequestCount++;
        this.inputTokens += result.usage.inputTokens;
        this.outputTokens += result.usage.outputTokens;
        this.totalTokens += result.usage.totalTokens;
      }
      return action;
    } catch (error: unknown) {
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : new Error("Direct Model 决策已取消");
      }
      if (error instanceof DirectProviderRequestError) {
        this.errorCounts[error.code] = (this.errorCounts[error.code] ?? 0) + 1;
      }
      throw error;
    } finally {
      const pendingStartedAt = this.pendingRequestStartedAt.get(requestMetricId);
      if (pendingStartedAt !== undefined) {
        this.latencies.push(
          Math.max(0, Math.round((performance.now() - pendingStartedAt) * 1000) / 1000),
        );
        this.pendingRequestStartedAt.delete(requestMetricId);
      }
    }
  }

  getRunMetrics(): DirectModelRunMetrics {
    const measuredAt = performance.now();
    const latencySamples = [
      ...this.latencies,
      ...[...this.pendingRequestStartedAt.values()].map(startedAt => (
        Math.max(0, Math.round((measuredAt - startedAt) * 1000) / 1000)
      )),
    ];
    const totalLatency = latencySamples.reduce((sum, value) => sum + value, 0);
    return Object.freeze({
      requestCount: this.requestCount,
      successfulRequestCount: this.successfulRequestCount,
      failedRequestCount: this.requestCount - this.successfulRequestCount,
      usageReportedRequestCount: this.usageReportedRequestCount,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      latencyMs: Object.freeze({
        total: Math.round(totalLatency * 1000) / 1000,
        minimum: latencySamples.length ? Math.min(...latencySamples) : null,
        maximum: latencySamples.length ? Math.max(...latencySamples) : null,
        average: latencySamples.length
          ? Math.round((totalLatency / latencySamples.length) * 1000) / 1000
          : null,
      }),
      errorCounts: Object.freeze({ ...this.errorCounts }),
    });
  }
}

export function createDirectModelObservation(observation: Observation): ModelObservation {
  const modelObservation = {
    schemaVersion: observation.schemaVersion,
    rulesetVersion: observation.rulesetVersion,
    toolSchemaVersion: observation.toolSchemaVersion,
    scenarioId: observation.scenarioId,
    day: observation.day,
    daysLeft: observation.daysLeft,
    state: observation.state,
    items: observation.items,
    locations: observation.locations,
    allowedActions: observation.allowedActions,
  };
  return immutableClone(modelObservation) as ModelObservation;
}

export function createDefaultDirectModelDrivers(
  provider: DirectModelProviderAdapter,
): DirectModelDriver[] {
  return DEFAULT_DIRECT_AGENT_SPECS.map((spec, slot) => new DirectModelDriver({
    ...spec,
    slot,
    provider,
  }));
}
