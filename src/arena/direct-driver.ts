import { performance } from "node:perf_hooks";
import type {
  AgentDescriptor,
  FaultDomain,
  GameAction,
  ModelDecisionEvidence,
  ModelObservation,
  Observation,
  TechnicalFailureCategory,
} from "../core/contracts.js";
import { immutableClone, stableHash } from "../core/stable-value.js";
import type {
  AgentDecisionInput,
  AgentDecisionOutput,
  AgentDriver,
  ArenaModelCallAudit,
  DirectCompetitionProfile,
  DirectModelProviderAdapter,
  DirectModelRunMetrics,
  ModelCallEvidenceLink,
  ModelRevisionAudit,
  ProviderTokenUsage,
  SamplingAudit,
} from "./agent-driver.js";
import { DirectProviderRequestError } from "./agent-driver.js";
import {
  buildFullHistoryUserContext,
  DIRECT_CONTEXT_POLICY_VERSION,
  DIRECT_DECISION_POLICY_HASH,
  DIRECT_DECISION_POLICY_ID,
  DIRECT_MODEL_OBSERVATION_VERSION,
  DIRECT_SAMPLING_POLICY_VERSION,
  DIRECT_SYSTEM_INSTRUCTION,
  fullContextHash,
  serializeFullHistoryUserContext,
} from "./direct-context.js";

export {
  DIRECT_CONTEXT_POLICY_VERSION,
  DIRECT_DECISION_POLICY_HASH,
  DIRECT_DECISION_POLICY_ID,
  DIRECT_MODEL_OBSERVATION_VERSION,
  DIRECT_SAMPLING_POLICY_VERSION,
  DIRECT_SYSTEM_INSTRUCTION,
} from "./direct-context.js";

export interface DirectModelDriverConfig {
  readonly id: string;
  readonly slot: number;
  readonly provider: DirectModelProviderAdapter;
}

export interface DefaultDirectAgentSpec {
  readonly id: string;
}

export const DEFAULT_DIRECT_AGENT_SPECS: readonly DefaultDirectAgentSpec[] = Object.freeze(
  Array.from({ length: 5 }, (_, index) => Object.freeze({ id: `competitor-${index + 1}` })),
);

interface MutableModelCall {
  readonly artifactType: "arena-model-call-v1";
  readonly modelCallId: string;
  readonly agentId: string;
  readonly agentSlot: number;
  readonly actionIndex: number;
  readonly observationHash: string;
  readonly fullContextHash: string;
  readonly startedAt: number;
  status?: "succeeded" | "failed";
  latencyMs?: number;
  tokenUsage?: ProviderTokenUsage;
  usageMissing?: boolean;
  responseModelRevision?: string;
  failure?: ArenaModelCallAudit["failure"];
  actionEventId?: string;
  terminationEventId?: string;
}

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

/** Strictly parse the only value that may reach GameEnvironment. */
export function parseDirectGameAction(value: unknown): GameAction {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Direct Model 返回值不是合法的 GameAction 对象");
  }
  switch (value.type) {
    case "move":
      if (hasExactKeys(value, ["type", "locationId"]) && isNonNegativeSafeInteger(value.locationId)) {
        return Object.freeze({ type: "move", locationId: value.locationId });
      }
      break;
    case "buy":
    case "sell":
      if (hasExactKeys(value, ["type", "itemId", "quantity"])
        && isNonNegativeSafeInteger(value.itemId)
        && isPositiveSafeInteger(value.quantity)) {
        return Object.freeze({ type: value.type, itemId: value.itemId, quantity: value.quantity });
      }
      break;
    case "deposit":
    case "withdraw":
    case "repay_debt":
      if (hasExactKeys(value, ["type", "amount"]) && isPositiveSafeInteger(value.amount)) {
        return Object.freeze({ type: value.type, amount: value.amount });
      }
      break;
    case "heal":
      if (hasExactKeys(value, ["type", "points"]) && isPositiveSafeInteger(value.points)) {
        return Object.freeze({ type: "heal", points: value.points });
      }
      break;
    case "expand_capacity":
      if (hasExactKeys(value, ["type"])) return Object.freeze({ type: "expand_capacity" });
      break;
  }
  throw new Error("Direct Model 返回的动作不符合严格 GameAction 契约");
}

function defaultSamplingAudit(provider: DirectModelProviderAdapter): SamplingAudit {
  const mode = provider.thinkingMode ?? "default";
  return Object.freeze({
    policyVersion: DIRECT_SAMPLING_POLICY_VERSION,
    temperature: "omitted",
    topP: "omitted",
    maxOutputTokens: provider.maxOutputTokens,
    jsonMode: "none",
    thinking: Object.freeze({ mode, sent: mode !== "default" }),
  });
}

function rounded(value: number): number {
  return Math.max(0, Math.round(value * 1_000) / 1_000);
}

export class DirectModelDriver implements AgentDriver {
  readonly descriptor: AgentDescriptor;
  readonly competitionProfile: DirectCompetitionProfile;
  private readonly provider: DirectModelProviderAdapter;
  private readonly sampling: SamplingAudit;
  private readonly calls = new Map<string, MutableModelCall>();
  private currentEvidence: ModelDecisionEvidence | undefined;

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
    this.sampling = config.provider.samplingAudit ?? defaultSamplingAudit(config.provider);
    this.competitionProfile = Object.freeze({
      decisionPolicyId: DIRECT_DECISION_POLICY_ID,
      decisionPolicyHash: DIRECT_DECISION_POLICY_HASH,
      modelObservationVersion: DIRECT_MODEL_OBSERVATION_VERSION,
      contextPolicyVersion: DIRECT_CONTEXT_POLICY_VERSION,
      samplingPolicyVersion: DIRECT_SAMPLING_POLICY_VERSION,
      maxOutputTokensPerRequest: config.provider.maxOutputTokens,
    });
    this.descriptor = Object.freeze({
      id: requireNonEmpty(config.id, "Agent id"),
      slot: config.slot,
      driver: "direct" as const,
      decisionPolicyId: DIRECT_DECISION_POLICY_ID,
      decisionPolicyHash: DIRECT_DECISION_POLICY_HASH,
      provider: providerId,
      model: modelId,
      providerAdapterVersion,
      ...(config.provider.thinkingMode ? { providerThinkingMode: config.provider.thinkingMode } : {}),
      ...(config.provider.declaredModelRevision
        ? { declaredModelRevision: requireNonEmpty(config.provider.declaredModelRevision, "model revision") }
        : {}),
    });
  }

  async decide(input: AgentDecisionInput): Promise<AgentDecisionOutput> {
    if (input.signal.aborted) {
      throw input.signal.reason instanceof Error ? input.signal.reason : new Error("Direct Model 决策已取消");
    }
    const observation = createDirectModelObservation(input.observation);
    const contextObject = buildFullHistoryUserContext(input.actionIndex, observation, input.history);
    const userContext = serializeFullHistoryUserContext(contextObject);
    const contextHash = fullContextHash(DIRECT_SYSTEM_INSTRUCTION, userContext);
    const modelCallId = `model-call_${stableHash({
      matchId: input.matchId,
      agentId: this.descriptor.id,
      actionIndex: input.actionIndex,
    })}`;
    if (this.calls.has(modelCallId)) throw new Error(`重复 modelCallId：${modelCallId}`);
    const call: MutableModelCall = {
      artifactType: "arena-model-call-v1",
      modelCallId,
      agentId: this.descriptor.id,
      agentSlot: this.descriptor.slot,
      actionIndex: input.actionIndex,
      observationHash: input.observation.observationHash,
      fullContextHash: contextHash,
      startedAt: performance.now(),
    };
    this.calls.set(modelCallId, call);
    this.currentEvidence = Object.freeze({ modelCallId, fullContextHash: contextHash });

    try {
      const result = await this.provider.requestDecision({
        ...input,
        observation,
        modelCallId,
        fullContextHash: contextHash,
        systemInstruction: DIRECT_SYSTEM_INSTRUCTION,
        userContext,
      });
      let action: GameAction;
      try {
        action = parseDirectGameAction(result.action);
      } catch {
        throw new DirectProviderRequestError(
          this.provider.providerId,
          "invalid_action",
          `${this.provider.providerId} 返回的动作不符合 Arena 契约`,
          undefined,
          { responseModelRevision: result.responseModelRevision },
        );
      }
      if (!observation.allowedActions.includes(action.type)) {
        throw new DirectProviderRequestError(
          this.provider.providerId,
          "invalid_action",
          `${this.provider.providerId} 返回了当前不可用的 Arena 动作`,
          undefined,
          { responseModelRevision: result.responseModelRevision },
        );
      }
      this.finishCall(call, "succeeded", result.usage, result.responseModelRevision);
      return Object.freeze({ action, evidence: this.currentEvidence });
    } catch (error: unknown) {
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error ? input.signal.reason : new Error("Direct Model 决策已取消");
      }
      if (error instanceof DirectProviderRequestError) {
        this.finishCall(call, "failed", undefined, error.responseModelRevision, {
          category: error.code,
          domain: error.domain,
          countsTowardModelFailure: error.countsTowardModelFailure,
          ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
        });
      } else {
        this.finishCall(call, "failed", undefined, undefined, {
          category: "driver_error",
          domain: "runner",
          countsTowardModelFailure: false,
        });
      }
      throw error;
    }
  }

  getActiveDecisionEvidence(): ModelDecisionEvidence | undefined {
    return this.currentEvidence;
  }

  recordExternalDecisionFailure(
    category: TechnicalFailureCategory,
    domain: FaultDomain,
    countsTowardModelFailure: boolean,
  ): ModelDecisionEvidence | undefined {
    const evidence = this.currentEvidence;
    if (!evidence) return undefined;
    const call = this.calls.get(evidence.modelCallId);
    if (call && call.status === undefined) {
      this.finishCall(call, "failed", undefined, undefined, {
        category,
        domain,
        countsTowardModelFailure,
      });
    }
    return evidence;
  }

  linkModelCallEvidence(modelCallId: string, link: ModelCallEvidenceLink): void {
    const call = this.calls.get(modelCallId);
    if (!call) throw new Error(`未知 modelCallId：${modelCallId}`);
    if (link.actionEventId) call.actionEventId = link.actionEventId;
    if (link.terminationEventId) call.terminationEventId = link.terminationEventId;
    if (this.currentEvidence?.modelCallId === modelCallId) this.currentEvidence = undefined;
  }

  getRunMetrics(): DirectModelRunMetrics {
    const calls = [...this.calls.values()]
      .sort((a, b) => a.actionIndex - b.actionIndex)
      .map(call => this.snapshotCall(call));
    const latencies = calls.map(call => call.latencyMs);
    const usage = calls.flatMap(call => call.tokenUsage ? [call.tokenUsage] : []);
    const errorCounts: Partial<Record<TechnicalFailureCategory, number>> = {};
    for (const call of calls) {
      if (call.failure) {
        errorCounts[call.failure.category] = (errorCounts[call.failure.category] ?? 0) + 1;
      }
    }
    const totalLatency = rounded(latencies.reduce((sum, value) => sum + value, 0));
    return Object.freeze({
      calls: Object.freeze(calls),
      requestCount: calls.length,
      successfulRequestCount: calls.filter(call => call.status === "succeeded").length,
      failedRequestCount: calls.filter(call => call.status === "failed").length,
      usageReportedRequestCount: usage.length,
      inputTokens: usage.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: usage.reduce((sum, item) => sum + item.outputTokens, 0),
      totalTokens: usage.reduce((sum, item) => sum + item.totalTokens, 0),
      latencyMs: Object.freeze({
        total: totalLatency,
        minimum: latencies.length ? Math.min(...latencies) : null,
        maximum: latencies.length ? Math.max(...latencies) : null,
        average: latencies.length ? rounded(totalLatency / latencies.length) : null,
      }),
      errorCounts: Object.freeze(errorCounts),
    });
  }

  private finishCall(
    call: MutableModelCall,
    status: "succeeded" | "failed",
    usage?: ProviderTokenUsage,
    responseModelRevision?: string,
    failure?: NonNullable<ArenaModelCallAudit["failure"]>,
  ): void {
    if (call.status !== undefined) return;
    call.status = status;
    call.latencyMs = rounded(performance.now() - call.startedAt);
    call.usageMissing = usage === undefined;
    if (usage) call.tokenUsage = usage;
    const normalizedRevision = responseModelRevision?.trim();
    if (normalizedRevision) call.responseModelRevision = normalizedRevision;
    if (failure) call.failure = Object.freeze(failure);
  }

  private revisionAudit(call: MutableModelCall): ModelRevisionAudit {
    const declared = this.provider.declaredModelRevision?.trim() || null;
    const response = call.responseModelRevision?.trim() || null;
    return Object.freeze({
      declared,
      response,
      resolved: response ?? declared ?? "unavailable",
      mismatch: declared !== null && response !== null && declared !== response,
    });
  }

  private snapshotCall(call: MutableModelCall): ArenaModelCallAudit {
    const measuredLatency = call.latencyMs ?? rounded(performance.now() - call.startedAt);
    return immutableClone({
      artifactType: call.artifactType,
      modelCallId: call.modelCallId,
      agentId: call.agentId,
      agentSlot: call.agentSlot,
      actionIndex: call.actionIndex,
      observationHash: call.observationHash,
      fullContextHash: call.fullContextHash,
      status: call.status ?? "failed",
      latencyMs: measuredLatency,
      tokenUsage: call.tokenUsage ?? null,
      usageMissing: call.usageMissing ?? true,
      sampling: this.sampling,
      modelRevision: this.revisionAudit(call),
      actionEventId: call.actionEventId ?? null,
      terminationEventId: call.terminationEventId ?? null,
      failure: call.status === "succeeded"
        ? null
        : call.failure ?? {
          category: "driver_error",
          domain: "runner",
          countsTowardModelFailure: false,
        },
    }) as ArenaModelCallAudit;
  }
}

export function createDirectModelObservation(observation: Observation): ModelObservation {
  return immutableClone({
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
  }) as ModelObservation;
}

export function createDefaultDirectModelDrivers(
  provider: DirectModelProviderAdapter,
): DirectModelDriver[] {
  return DEFAULT_DIRECT_AGENT_SPECS.map((spec, slot) => new DirectModelDriver({
    id: spec.id,
    slot,
    provider,
  }));
}
