import { performance } from "node:perf_hooks";
import type {
  FaultDomain,
  GameAction,
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
  AgentDriver,
  ModelRevisionAudit,
  ProviderTokenUsage,
  SamplingAudit,
} from "./agent-driver.js";
import { DirectProviderRequestError } from "./agent-driver.js";
import {
  DIRECT_CONTEXT_POLICY_VERSION,
  DIRECT_DECISION_POLICY_HASH,
  DIRECT_DECISION_POLICY_ID,
  DIRECT_MODEL_OBSERVATION_VERSION,
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
  readonly passed: boolean;
  readonly action: GameAction | null;
  readonly usage: ProviderTokenUsage | null;
  readonly usageMissing: boolean;
  readonly latencyMs: number;
  readonly sampling: SamplingAudit;
  readonly modelRevision: ModelRevisionAudit;
  readonly fault: ProbeFaultAudit | null;
}

export interface ProviderProbeResult {
  readonly artifactType: "arena-provider-probe-v2";
  readonly matchId: string;
  readonly createdAt: string;
  readonly passed: boolean;
  readonly requestCount: 5;
  readonly configFingerprint: string;
  readonly decisionPolicyId: typeof DIRECT_DECISION_POLICY_ID;
  readonly decisionPolicyHash: string;
  readonly modelObservationVersion: typeof DIRECT_MODEL_OBSERVATION_VERSION;
  readonly contextPolicyVersion: typeof DIRECT_CONTEXT_POLICY_VERSION;
  readonly samplingPolicyVersion: typeof DIRECT_SAMPLING_POLICY_VERSION;
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
}

export interface ProviderProbeConfig {
  readonly matchId: string;
  readonly seed: number;
  readonly scenario: ScenarioConfig;
  readonly drivers: readonly AgentDriver[];
  readonly decisionTimeoutMs: number;
  readonly slotRotationIndex: number;
  readonly configFingerprint: string;
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

function normalizeDecision(value: GameAction | AgentDecisionOutput): AgentDecisionOutput {
  if (value && typeof value === "object" && "action" in value) return value as AgentDecisionOutput;
  return Object.freeze({ action: value as GameAction });
}

function fallbackSampling(driver: AgentDriver): SamplingAudit {
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
    const decision = normalizeDecision(await Promise.race([
      Promise.resolve(driver.decide({
        matchId: config.matchId,
        observation,
        actionIndex: 0,
        history: [],
        signal: controller.signal,
      })),
      timeout,
    ]));
    const step = environment.step(decision.action, decision.evidence);
    const call = metricsForLastCall(driver);
    if (!step.success || !call) {
      return Object.freeze({
        ...base,
        passed: false,
        action: decision.action,
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
      action: decision.action,
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
  return integrityHash({
    contract: "arena-provider-probe-config-v2",
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
      samplingPolicyVersion: DIRECT_SAMPLING_POLICY_VERSION,
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
      || driver.competitionProfile?.contextPolicyVersion !== DIRECT_CONTEXT_POLICY_VERSION
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
    artifactType: "arena-provider-probe-v2" as const,
    matchId: config.matchId,
    createdAt: config.createdAt ?? new Date().toISOString(),
    passed: entries.every(entry => entry.passed),
    requestCount: 5 as const,
    configFingerprint: config.configFingerprint,
    decisionPolicyId: DIRECT_DECISION_POLICY_ID,
    decisionPolicyHash: DIRECT_DECISION_POLICY_HASH,
    modelObservationVersion: DIRECT_MODEL_OBSERVATION_VERSION,
    contextPolicyVersion: DIRECT_CONTEXT_POLICY_VERSION,
    samplingPolicyVersion: DIRECT_SAMPLING_POLICY_VERSION,
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
): asserts value is ProviderProbeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("probe-summary.json 结构无效");
  }
  const summary = value as Partial<ProviderProbeResult>;
  const { probeSummaryHash, ...body } = summary;
  const entries = Array.isArray(summary.entries) ? summary.entries : [];
  const entryIds = new Set(entries.map(entry => entry?.agentId));
  const entrySlots = new Set(entries.map(entry => entry?.agentSlot));
  if (summary.artifactType !== "arena-provider-probe-v2"
    || summary.requestCount !== 5
    || summary.passed !== true
    || entries.length !== 5
    || entries.some(entry => !entry || typeof entry !== "object"
      || entry.passed !== true
      || entry.action === null
      || entry.fault !== null
      || typeof entry.provider !== "string"
      || typeof entry.model !== "string"
      || typeof entry.providerAdapterVersion !== "string"
      || typeof entry.usageMissing !== "boolean"
      || typeof entry.latencyMs !== "number"
      || !Number.isFinite(entry.latencyMs)
      || entry.latencyMs < 0
      || entry.sampling?.policyVersion !== DIRECT_SAMPLING_POLICY_VERSION)
    || entryIds.size !== 5
    || [...entryIds].sort().join("\0") !== [1, 2, 3, 4, 5].map(index => `competitor-${index}`).join("\0")
    || entrySlots.size !== 5
    || [...entrySlots].sort((a, b) => Number(a) - Number(b)).some((slot, index) => slot !== index)
    || summary.configFingerprint !== configFingerprint
    || summary.decisionPolicyId !== DIRECT_DECISION_POLICY_ID
    || summary.decisionPolicyHash !== DIRECT_DECISION_POLICY_HASH
    || summary.modelObservationVersion !== DIRECT_MODEL_OBSERVATION_VERSION
    || summary.contextPolicyVersion !== DIRECT_CONTEXT_POLICY_VERSION
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
