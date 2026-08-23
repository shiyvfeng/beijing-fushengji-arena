import { performance } from "node:perf_hooks";
import type {
  FaultDomain,
  GameAction,
  ProviderReasoningEffort,
  ProviderThinkingMode,
  ScenarioConfig,
  TechnicalFailureCategory,
} from "../core/contracts.js";
import { GameEnvironment } from "../core/game-environment.js";
import { scenarioIntegrityHash } from "../core/integrity.js";
import { findPotentialSecrets } from "../core/secret-scan.js";
import { immutableClone, integrityHash } from "../core/stable-value.js";
import type {
  AgentDecisionOutput,
  AgentActionDecisionOutput,
  AgentDailyPlanDecisionOutput,
  AgentDriver,
  ModelRevisionAudit,
  ProviderTokenUsage,
  SamplingAudit,
} from "./agent-driver.js";
import { DirectProviderRequestError } from "./agent-driver.js";
import {
  COMPLETION_ASSISTANCE_POLICY_VERSION,
  COMPLETION_CANDIDATE_POLICY_VERSION,
  COMPLETION_CONTEXT_POLICY_VERSION,
  COMPLETION_DAILY_PLAN_POLICY_VERSION,
  COMPLETION_DECISION_POLICY_HASH,
  COMPLETION_MAX_ATTEMPTS_PER_DAY,
  COMPLETION_MAX_PLAN_CANDIDATES,
  COMPLETION_MAX_PREP_ACTIONS,
  COMPLETION_PROVIDER_TIME_BUDGET_MS,
  COMPLETION_RECOVERY_POLICY_VERSION,
  COMPLETION_RUN_TRACK,
  generateDailyPlanOptions,
  type DailyPlanSelection,
} from "./completion-assisted.js";
import {
  DIRECT_CONTEXT_POLICY_VERSION,
  DIRECT_DECISION_POLICY_HASH,
  DIRECT_DECISION_POLICY_ID,
  DIRECT_MAX_ATTEMPTS_PER_DECISION,
  DIRECT_MAX_REPAIR_RETRIES_PER_DECISION,
  DIRECT_MAX_TRANSIENT_RETRIES_PER_DECISION,
  DIRECT_MODEL_OBSERVATION_VERSION,
  DIRECT_RECOVERY_POLICY_VERSION,
  DIRECT_SAMPLING_POLICY_VERSION,
} from "./direct-context.js";

export interface ProbeFaultAudit {
  readonly category: TechnicalFailureCategory;
  readonly domain: FaultDomain;
  readonly countsTowardModelFailure: boolean;
  readonly httpStatus?: number;
}

export interface ProviderProbeEntry {
  readonly agentId: string;
  readonly agentSlot: number;
  readonly provider: string;
  readonly model: string;
  readonly providerAdapterVersion: string;
  readonly providerThinkingMode?: ProviderThinkingMode;
  readonly providerReasoningEffort: ProviderReasoningEffort;
  readonly passed: boolean;
  readonly action: GameAction | null;
  readonly dailyPlanSelection?: DailyPlanSelection | null;
  readonly usage: ProviderTokenUsage | null;
  readonly usageMissing: boolean;
  readonly latencyMs: number;
  readonly sampling: SamplingAudit;
  readonly modelRevision: ModelRevisionAudit;
  readonly fault: ProbeFaultAudit | null;
}

export interface ProviderProbeResult {
  readonly artifactType: "arena-provider-probe-v3" | "arena-provider-probe-v4";
  readonly runTrack?: typeof COMPLETION_RUN_TRACK;
  readonly matchId: string;
  readonly createdAt: string;
  readonly passed: boolean;
  readonly requestCount: 5;
  readonly configFingerprint: string;
  readonly decisionPolicyId: typeof DIRECT_DECISION_POLICY_ID;
  readonly decisionPolicyHash: string;
  readonly modelObservationVersion: typeof DIRECT_MODEL_OBSERVATION_VERSION;
  readonly contextPolicyVersion:
    | typeof DIRECT_CONTEXT_POLICY_VERSION
    | typeof COMPLETION_CONTEXT_POLICY_VERSION;
  readonly recoveryPolicyVersion:
    | typeof DIRECT_RECOVERY_POLICY_VERSION
    | typeof COMPLETION_RECOVERY_POLICY_VERSION;
  readonly samplingPolicyVersion: typeof DIRECT_SAMPLING_POLICY_VERSION;
  readonly dailyPlanPolicyVersion?: typeof COMPLETION_DAILY_PLAN_POLICY_VERSION;
  readonly candidatePolicyVersion?: typeof COMPLETION_CANDIDATE_POLICY_VERSION;
  readonly assistancePolicyVersion?: typeof COMPLETION_ASSISTANCE_POLICY_VERSION;
  readonly entries: readonly ProviderProbeEntry[];
  readonly probeSummaryHash: string;
}

export interface ProbeFingerprintAgent {
  readonly entryIndex: number;
  readonly provider: string;
  readonly model: string;
  readonly providerAdapterVersion: string;
  readonly endpointFingerprint: string;
  readonly declaredModelRevision: string | null;
  readonly thinkingMode: ProviderThinkingMode;
  readonly reasoningEffort: ProviderReasoningEffort;
}

export interface ProbeFingerprintInput {
  readonly matchId: string;
  readonly seed: number;
  readonly scenario: ScenarioConfig;
  readonly agents: readonly ProbeFingerprintAgent[];
  readonly maxActionsPerAgent: number;
  readonly decisionTimeoutMs: number;
  readonly totalWallClockMs: number;
  readonly maxOutputTokens: number;
  readonly slotRotationIndex: number;
  readonly completionAssisted?: boolean;
  readonly providerTimeBudgetMs?: number;
  readonly maxDailyDecisionsPerAgent?: number;
}

export interface ProviderProbeConfig {
  readonly matchId: string;
  readonly seed: number;
  readonly scenario: ScenarioConfig;
  readonly drivers: readonly AgentDriver[];
  readonly decisionTimeoutMs: number;
  readonly slotRotationIndex: number;
  readonly configFingerprint: string;
  readonly completionAssisted?: boolean;
  readonly createdAt?: string;
}

function normalizedProviderIdentity(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "gpt": return "openai";
    case "claude": return "anthropic";
    case "dashscope": return "qwen";
    case "moonshot": return "kimi";
    case "openai-chat": return "openai-compatible";
    default: return value.trim().toLowerCase();
  }
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

function normalizeDecision(value: GameAction | AgentDecisionOutput): AgentActionDecisionOutput {
  if (value && typeof value === "object" && "dailyPlanSelection" in value) {
    throw new Error("Strict Provider Probe 收到 Daily Plan 决策");
  }
  if (value && typeof value === "object" && "action" in value) {
    return value as AgentActionDecisionOutput;
  }
  return Object.freeze({ action: value as GameAction });
}

function normalizeDailyPlanDecision(value: GameAction | AgentDecisionOutput): AgentDailyPlanDecisionOutput {
  if (value && typeof value === "object" && "dailyPlanSelection" in value) {
    return value as AgentDailyPlanDecisionOutput;
  }
  throw new Error("Completion-Assisted Provider Probe 收到 Strict Action 决策");
}

function fallbackSampling(driver: AgentDriver): SamplingAudit {
  const reasoningEffort = driver.descriptor.providerReasoningEffort ?? "default";
  return Object.freeze({
    policyVersion: DIRECT_SAMPLING_POLICY_VERSION,
    temperature: "omitted",
    topP: "omitted",
    maxOutputTokens: driver.competitionProfile?.maxOutputTokensPerRequest ?? 0,
    jsonMode: "none",
    thinking: Object.freeze({
      mode: driver.descriptor.providerThinkingMode ?? "default",
      sent: (driver.descriptor.providerThinkingMode ?? "default") !== "default",
    }),
    reasoningEffort: Object.freeze({
      level: reasoningEffort,
      sent: reasoningEffort !== "default",
    }),
  });
}

function fallbackRevision(driver: AgentDriver): ModelRevisionAudit {
  const declared = driver.descriptor.declaredModelRevision?.trim() || null;
  return Object.freeze({
    declared,
    response: null,
    resolved: declared ?? "unavailable",
    mismatch: false,
  });
}

function entryBase(driver: AgentDriver) {
  const descriptor = driver.descriptor;
  return {
    agentId: descriptor.id,
    agentSlot: descriptor.slot,
    provider: descriptor.provider ?? "unknown",
    model: descriptor.model ?? "unknown",
    providerAdapterVersion: descriptor.providerAdapterVersion ?? "unknown",
    ...(descriptor.providerThinkingMode ? { providerThinkingMode: descriptor.providerThinkingMode } : {}),
    providerReasoningEffort: descriptor.providerReasoningEffort ?? "default",
  };
}

function metricsForLastCall(driver: AgentDriver) {
  return driver.getRunMetrics?.().calls.at(-1);
}

async function probeOne(config: ProviderProbeConfig, driver: AgentDriver): Promise<ProviderProbeEntry> {
  const base = entryBase(driver);
  const environment = new GameEnvironment();
  const observation = environment.reset({
    matchId: config.matchId,
    episodeId: `${config.matchId}:probe:slot-${driver.descriptor.slot}`,
    agentId: driver.descriptor.id,
    agentSlot: driver.descriptor.slot,
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
    const dailyPlanOptions = config.completionAssisted
      ? generateDailyPlanOptions(environment)
      : undefined;
    const rawDecision = await Promise.race([
      Promise.resolve(driver.decide({
        matchId: config.matchId,
        observation,
        actionIndex: 0,
        history: [],
        ...(dailyPlanOptions ? { dailyPlanOptions } : {}),
        signal: controller.signal,
      })),
      timeout,
    ]);
    const decision = config.completionAssisted
      ? normalizeDailyPlanDecision(rawDecision)
      : normalizeDecision(rawDecision);
    const execution = "dailyPlanSelection" in decision
      ? (() => {
        const plan = dailyPlanOptions!.plans.find(item => item.id === decision.dailyPlanSelection.planId);
        if (!plan) throw new Error("Probe Daily Plan ID 未命中预验证候选");
        const prepRevalidation = environment.previewActions(plan.actions);
        if (!prepRevalidation.success
          || integrityHash(prepRevalidation.after) !== plan.resultingStateHash) {
          throw new Error("Probe Daily Plan 候选状态重验证失败");
        }
        const fullRevalidation = environment.previewDailyPlan(
          plan.actions,
          decision.dailyPlanSelection.destinationId,
        );
        if (!fullRevalidation.success) {
          throw new Error("Probe Daily Plan 日内操作与移动无法整体执行");
        }
        return environment.executeDailyPlan(
          plan.actions,
          decision.dailyPlanSelection.destinationId,
          decision.evidence,
          integrityHash(fullRevalidation.after),
        );
      })()
      : environment.step(decision.action, decision.evidence);
    const call = metricsForLastCall(driver);
    if (!execution.success || !call) {
      return Object.freeze({
        ...base,
        passed: false,
        action: "action" in decision ? decision.action : null,
        ...(config.completionAssisted
          ? { dailyPlanSelection: "dailyPlanSelection" in decision ? decision.dailyPlanSelection : null }
          : {}),
        usage: call?.tokenUsage ?? null,
        usageMissing: call?.usageMissing ?? true,
        latencyMs: call?.latencyMs ?? safeLatency(startedAt),
        sampling: call?.sampling ?? fallbackSampling(driver),
        modelRevision: call?.modelRevision ?? fallbackRevision(driver),
        fault: Object.freeze({
          category: "invalid_action",
          domain: "model",
          countsTowardModelFailure: true,
        }),
      });
    }
    return Object.freeze({
      ...base,
      passed: true,
      action: "action" in decision ? decision.action : null,
      ...(config.completionAssisted
        ? { dailyPlanSelection: "dailyPlanSelection" in decision ? decision.dailyPlanSelection : null }
        : {}),
      usage: call.tokenUsage,
      usageMissing: call.usageMissing,
      latencyMs: call.latencyMs,
      sampling: call.sampling,
      modelRevision: call.modelRevision,
      fault: null,
    });
  } catch (error: unknown) {
    let fault: ProbeFaultAudit;
    if (error instanceof ProbeTimeoutError
      || (controller.signal.aborted && controller.signal.reason instanceof ProbeTimeoutError)) {
      driver.recordExternalDecisionFailure?.("timeout", "undetermined", false);
      fault = Object.freeze({
        category: "timeout",
        domain: "undetermined",
        countsTowardModelFailure: false,
      });
    } else if (error instanceof DirectProviderRequestError) {
      fault = Object.freeze({
        category: error.code,
        domain: error.domain,
        countsTowardModelFailure: error.countsTowardModelFailure,
        ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
      });
    } else {
      driver.recordExternalDecisionFailure?.("driver_error", "runner", false);
      fault = Object.freeze({
        category: "driver_error",
        domain: "runner",
        countsTowardModelFailure: false,
      });
    }
    const call = metricsForLastCall(driver);
    return Object.freeze({
      ...base,
      passed: false,
      action: null,
      ...(config.completionAssisted ? { dailyPlanSelection: null } : {}),
      usage: call?.tokenUsage ?? null,
      usageMissing: call?.usageMissing ?? true,
      latencyMs: call?.latencyMs ?? safeLatency(startedAt),
      sampling: call?.sampling ?? fallbackSampling(driver),
      modelRevision: call?.modelRevision ?? fallbackRevision(driver),
      fault,
    });
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

export function computeProbeConfigFingerprint(input: ProbeFingerprintInput): string {
  if (input.agents.length !== 5) throw new Error("Probe 配置指纹必须包含五个 Agent");
  if (input.completionAssisted) {
    const providerTimeBudgetMs = input.providerTimeBudgetMs ?? COMPLETION_PROVIDER_TIME_BUDGET_MS;
    const maxDailyDecisionsPerAgent = input.maxDailyDecisionsPerAgent ?? input.scenario.totalDays;
    return integrityHash({
      contract: "arena-provider-probe-config-v5",
      runTrack: COMPLETION_RUN_TRACK,
      matchId: input.matchId,
      seed: input.seed,
      scenarioId: input.scenario.id,
      scenarioHash: scenarioIntegrityHash(input.scenario),
      agents: input.agents,
      budgets: {
        maxDailyDecisionsPerAgent,
        attemptTimeoutMs: input.decisionTimeoutMs,
        providerTimeBudgetMs,
        maxOutputTokens: input.maxOutputTokens,
      },
      slotRotation: {
        version: "cyclic-v1",
        rotationIndex: input.slotRotationIndex,
      },
      policies: {
        decisionPolicyId: DIRECT_DECISION_POLICY_ID,
        decisionPolicyHash: COMPLETION_DECISION_POLICY_HASH,
        modelObservationVersion: DIRECT_MODEL_OBSERVATION_VERSION,
        contextPolicyVersion: COMPLETION_CONTEXT_POLICY_VERSION,
        recoveryPolicyVersion: COMPLETION_RECOVERY_POLICY_VERSION,
        samplingPolicyVersion: DIRECT_SAMPLING_POLICY_VERSION,
        dailyPlanPolicyVersion: COMPLETION_DAILY_PLAN_POLICY_VERSION,
        candidatePolicyVersion: COMPLETION_CANDIDATE_POLICY_VERSION,
        assistancePolicyVersion: COMPLETION_ASSISTANCE_POLICY_VERSION,
        maxAttemptsPerDay: COMPLETION_MAX_ATTEMPTS_PER_DAY,
        maxPlanCandidates: COMPLETION_MAX_PLAN_CANDIDATES,
        maxPrepActionsPerDay: COMPLETION_MAX_PREP_ACTIONS,
      },
    });
  }
  return integrityHash({
    contract: "arena-provider-probe-config-v4",
    matchId: input.matchId,
    seed: input.seed,
    scenarioId: input.scenario.id,
    scenarioHash: scenarioIntegrityHash(input.scenario),
    agents: input.agents,
    budgets: {
      maxActionsPerAgent: input.maxActionsPerAgent,
      decisionTimeoutMs: input.decisionTimeoutMs,
      totalWallClockMs: input.totalWallClockMs,
      maxOutputTokens: input.maxOutputTokens,
    },
    slotRotation: {
      version: "cyclic-v1",
      rotationIndex: input.slotRotationIndex,
    },
    policies: {
      decisionPolicyId: DIRECT_DECISION_POLICY_ID,
      decisionPolicyHash: DIRECT_DECISION_POLICY_HASH,
      modelObservationVersion: DIRECT_MODEL_OBSERVATION_VERSION,
      contextPolicyVersion: DIRECT_CONTEXT_POLICY_VERSION,
      recoveryPolicyVersion: DIRECT_RECOVERY_POLICY_VERSION,
      samplingPolicyVersion: DIRECT_SAMPLING_POLICY_VERSION,
      maxAttemptsPerDecision: DIRECT_MAX_ATTEMPTS_PER_DECISION,
      maxRepairRetriesPerDecision: DIRECT_MAX_REPAIR_RETRIES_PER_DECISION,
      maxTransientRetriesPerDecision: DIRECT_MAX_TRANSIENT_RETRIES_PER_DECISION,
    },
  });
}

export async function probeProviders(config: ProviderProbeConfig): Promise<ProviderProbeResult> {
  if (config.drivers.length !== 5) throw new Error("Provider Probe 必须恰好配置五个 Agent");
  if (!Number.isSafeInteger(config.slotRotationIndex)
    || config.slotRotationIndex < 0
    || config.slotRotationIndex > 4) {
    throw new Error("Provider Probe slotRotationIndex 必须为 0..4");
  }
  if (!Number.isSafeInteger(config.decisionTimeoutMs)
    || config.decisionTimeoutMs < 1
    || config.decisionTimeoutMs > 600_000) {
    throw new Error("Provider Probe decisionTimeoutMs 必须为 1..600000 的安全整数");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(config.configFingerprint)) {
    throw new Error("Provider Probe configFingerprint 无效");
  }
  const slots = new Set(config.drivers.map(driver => driver.descriptor.slot));
  if (slots.size !== 5 || [...slots].sort((a, b) => a - b).some((slot, index) => slot !== index)) {
    throw new Error("Provider Probe 的 Agent slot 必须唯一覆盖 0..4");
  }
  const identities = new Set<string>();
  const expectedContextPolicy = config.completionAssisted
    ? COMPLETION_CONTEXT_POLICY_VERSION
    : DIRECT_CONTEXT_POLICY_VERSION;
  const expectedRecoveryPolicy = config.completionAssisted
    ? COMPLETION_RECOVERY_POLICY_VERSION
    : DIRECT_RECOVERY_POLICY_VERSION;
  for (const [entryIndex, driver] of config.drivers.entries()) {
    const descriptor = driver.descriptor;
    if (descriptor.driver !== "direct"
      || descriptor.id !== `competitor-${entryIndex + 1}`
      || descriptor.slot !== (entryIndex + config.slotRotationIndex) % 5
      || descriptor.displayName !== undefined
      || descriptor.personaId !== undefined
      || !descriptor.provider?.trim()
      || !descriptor.model?.trim()
      || !descriptor.providerAdapterVersion?.trim()
      || !descriptor.providerReasoningEffort
      || descriptor.providerReasoningEffort === "default"
      || driver.competitionProfile?.contextPolicyVersion !== expectedContextPolicy
      || driver.competitionProfile?.recoveryPolicyVersion !== expectedRecoveryPolicy
      || driver.competitionProfile?.samplingPolicyVersion !== DIRECT_SAMPLING_POLICY_VERSION) {
      throw new Error("Provider Probe 的五个 Direct Agent 配置或 cyclic-v1 映射无效");
    }
    identities.add(`${normalizedProviderIdentity(descriptor.provider)}\0${descriptor.model.trim()}`);
  }
  if (identities.size !== 5) throw new Error("Provider Probe 的五组 Provider + model 必须互不重复");
  const entries = (await Promise.all(config.drivers.map(driver => probeOne(config, driver))))
    .sort((a, b) => a.agentSlot - b.agentSlot);
  const requestCount = config.drivers.reduce(
    (sum, driver) => sum + (driver.getRunMetrics?.().requestCount ?? 0),
    0,
  );
  if (requestCount !== 5) {
    throw new Error(`Provider Probe 请求计数守卫失败：预期 5，实际 ${requestCount}`);
  }
  const body = {
    artifactType: config.completionAssisted
      ? "arena-provider-probe-v4" as const
      : "arena-provider-probe-v3" as const,
    ...(config.completionAssisted ? { runTrack: COMPLETION_RUN_TRACK } : {}),
    matchId: config.matchId,
    createdAt: config.createdAt ?? new Date().toISOString(),
    passed: entries.every(entry => entry.passed),
    requestCount: 5 as const,
    configFingerprint: config.configFingerprint,
    decisionPolicyId: DIRECT_DECISION_POLICY_ID,
    decisionPolicyHash: config.completionAssisted
      ? COMPLETION_DECISION_POLICY_HASH
      : DIRECT_DECISION_POLICY_HASH,
    modelObservationVersion: DIRECT_MODEL_OBSERVATION_VERSION,
    contextPolicyVersion: expectedContextPolicy,
    recoveryPolicyVersion: expectedRecoveryPolicy,
    samplingPolicyVersion: DIRECT_SAMPLING_POLICY_VERSION,
    ...(config.completionAssisted ? {
      dailyPlanPolicyVersion: COMPLETION_DAILY_PLAN_POLICY_VERSION,
      candidatePolicyVersion: COMPLETION_CANDIDATE_POLICY_VERSION,
      assistancePolicyVersion: COMPLETION_ASSISTANCE_POLICY_VERSION,
    } : {}),
    entries: Object.freeze(entries),
  };
  return immutableClone({
    ...body,
    probeSummaryHash: integrityHash(body),
  }) as ProviderProbeResult;
}

export function assertMatchingProviderProbe(
  value: unknown,
  configFingerprint: string,
  expectedCompletionAssisted = false,
  options: { readonly allowFailed?: boolean } = {},
): asserts value is ProviderProbeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("probe-summary.json 结构无效");
  }
  const summary = value as Partial<ProviderProbeResult>;
  const { probeSummaryHash, ...body } = summary;
  const entries = Array.isArray(summary.entries) ? summary.entries : [];
  const entryIds = new Set(entries.map(entry => entry?.agentId));
  const entrySlots = new Set(entries.map(entry => entry?.agentSlot));
  const completionAssisted = summary.runTrack === COMPLETION_RUN_TRACK;
  const expectedArtifactType = completionAssisted
    ? "arena-provider-probe-v4"
    : "arena-provider-probe-v3";
  const expectedDecisionHash = completionAssisted
    ? COMPLETION_DECISION_POLICY_HASH
    : DIRECT_DECISION_POLICY_HASH;
  const expectedContextPolicy = completionAssisted
    ? COMPLETION_CONTEXT_POLICY_VERSION
    : DIRECT_CONTEXT_POLICY_VERSION;
  const expectedRecoveryPolicy = completionAssisted
    ? COMPLETION_RECOVERY_POLICY_VERSION
    : DIRECT_RECOVERY_POLICY_VERSION;
  const allowFailed = options.allowFailed === true;
  const aggregatePassed = entries.length === 5 && entries.every(entry => entry?.passed === true);
  if ((allowFailed && !expectedCompletionAssisted)
    || completionAssisted !== expectedCompletionAssisted
    || (!completionAssisted && summary.runTrack !== undefined)
    || summary.artifactType !== expectedArtifactType
    || summary.requestCount !== 5
    || summary.passed !== aggregatePassed
    || (!allowFailed && summary.passed !== true)
    || entries.length !== 5
    || entries.some(entry => !entry || typeof entry !== "object"
      || typeof entry.passed !== "boolean"
      || (entry.passed
        ? ((completionAssisted ? !entry.dailyPlanSelection : entry.action === null)
          || entry.fault !== null)
        : (!allowFailed
          || !entry.fault
          || typeof entry.fault.category !== "string"
          || typeof entry.fault.domain !== "string"
          || typeof entry.fault.countsTowardModelFailure !== "boolean"))
      || typeof entry.provider !== "string"
      || typeof entry.model !== "string"
      || typeof entry.providerAdapterVersion !== "string"
      || typeof entry.providerReasoningEffort !== "string"
      || entry.providerReasoningEffort === "default"
      || typeof entry.usageMissing !== "boolean"
      || typeof entry.latencyMs !== "number"
      || !Number.isFinite(entry.latencyMs)
      || entry.latencyMs < 0
      || entry.sampling?.policyVersion !== DIRECT_SAMPLING_POLICY_VERSION
      || entry.sampling.reasoningEffort?.level !== entry.providerReasoningEffort
      || entry.sampling.reasoningEffort.sent !== true)
    || entryIds.size !== 5
    || [...entryIds].sort().join("\0") !== [1, 2, 3, 4, 5].map(index => `competitor-${index}`).join("\0")
    || entrySlots.size !== 5
    || [...entrySlots].sort((a, b) => Number(a) - Number(b)).some((slot, index) => slot !== index)
    || summary.configFingerprint !== configFingerprint
    || summary.decisionPolicyId !== DIRECT_DECISION_POLICY_ID
    || summary.decisionPolicyHash !== expectedDecisionHash
    || summary.modelObservationVersion !== DIRECT_MODEL_OBSERVATION_VERSION
    || summary.contextPolicyVersion !== expectedContextPolicy
    || summary.recoveryPolicyVersion !== expectedRecoveryPolicy
    || (completionAssisted && (summary.dailyPlanPolicyVersion !== COMPLETION_DAILY_PLAN_POLICY_VERSION
      || summary.candidatePolicyVersion !== COMPLETION_CANDIDATE_POLICY_VERSION
      || summary.assistancePolicyVersion !== COMPLETION_ASSISTANCE_POLICY_VERSION))
    || summary.samplingPolicyVersion !== DIRECT_SAMPLING_POLICY_VERSION
    || typeof summary.createdAt !== "string"
    || Number.isNaN(Date.parse(summary.createdAt))
    || !probeSummaryHash
    || !/^sha256:[0-9a-f]{64}$/u.test(probeSummaryHash)
    || findPotentialSecrets(summary).length > 0
    || integrityHash(body) !== probeSummaryHash) {
    throw new Error("缺少配置匹配且五组全部通过的 Provider Probe 摘要");
  }
}
