import type {
  AgentDescriptor,
  ArenaEvent,
  EpisodeTrace,
  FaultDomain,
  FinalResult,
  GameAction,
  ModelDecisionEvidence,
  ModelObservation,
  Observation,
  ProviderThinkingMode,
  StepResult,
  TechnicalFailureCategory,
} from "../core/contracts.js";
import type { StateDiff } from "../core/state-diff.js";

export interface AgentDecisionHistoryEntry {
  readonly actionIndex: number;
  readonly action: GameAction | Readonly<Record<string, unknown>>;
  readonly result: {
    readonly success: boolean;
    readonly code: string | null;
    readonly message: string;
    readonly effects: ArenaEvent["result"]["effects"];
  };
  readonly stateDiff: StateDiff;
}

export interface AgentDecisionInput {
  readonly matchId: string;
  readonly observation: Observation;
  readonly actionIndex: number;
  readonly history: readonly AgentDecisionHistoryEntry[];
  readonly signal: AbortSignal;
}

export interface AgentDecisionOutput {
  readonly action: GameAction;
  readonly evidence?: ModelDecisionEvidence;
}

export interface AgentResetInput {
  readonly signal: AbortSignal;
}

export interface ModelCallEvidenceLink {
  readonly actionEventId?: string;
  readonly terminationEventId?: string;
}

/** Shared boundary for scripted, Direct Model and future strict-MCP drivers. */
export interface AgentDriver {
  readonly descriptor: AgentDescriptor;
  readonly competitionProfile?: DirectCompetitionProfile;
  reset?(input: AgentResetInput): void | Promise<void>;
  decide(input: AgentDecisionInput): GameAction | AgentDecisionOutput | Promise<GameAction | AgentDecisionOutput>;
  getRunMetrics?(): DirectModelRunMetrics;
  getActiveDecisionEvidence?(): ModelDecisionEvidence | undefined;
  recordExternalDecisionFailure?(
    category: TechnicalFailureCategory,
    domain: FaultDomain,
    countsTowardModelFailure: boolean,
  ): ModelDecisionEvidence | undefined;
  linkModelCallEvidence?(modelCallId: string, link: ModelCallEvidenceLink): void;
}

export interface DirectModelDecisionInput extends Omit<AgentDecisionInput, "observation"> {
  readonly observation: ModelObservation;
  readonly modelCallId: string;
  readonly fullContextHash: string;
  readonly systemInstruction: string;
  readonly userContext: string;
}

export type DirectProviderErrorCode =
  | "transport_error"
  | "http_error"
  | "invalid_response"
  | "invalid_action"
  | "refusal"
  | "incomplete"
  | "context_limit";

const ERROR_OBSERVATION: Readonly<Record<DirectProviderErrorCode, {
  readonly domain: FaultDomain;
  readonly countsTowardModelFailure: boolean;
}>> = Object.freeze({
  transport_error: Object.freeze({ domain: "platform", countsTowardModelFailure: false }),
  http_error: Object.freeze({ domain: "provider", countsTowardModelFailure: false }),
  invalid_response: Object.freeze({ domain: "protocol", countsTowardModelFailure: false }),
  invalid_action: Object.freeze({ domain: "model", countsTowardModelFailure: true }),
  refusal: Object.freeze({ domain: "model", countsTowardModelFailure: true }),
  incomplete: Object.freeze({ domain: "model", countsTowardModelFailure: true }),
  context_limit: Object.freeze({ domain: "model", countsTowardModelFailure: true }),
});

/** Safe-to-report provider error. It never retains bodies, headers, keys or causes. */
export class DirectProviderRequestError extends Error {
  readonly code: DirectProviderErrorCode;
  readonly providerId: string;
  readonly httpStatus?: number;
  readonly domain: FaultDomain;
  readonly countsTowardModelFailure: boolean;
  readonly responseModelRevision?: string;

  constructor(
    providerId: string,
    code: DirectProviderErrorCode,
    message: string,
    httpStatus?: number,
    observation: {
      readonly domain?: FaultDomain;
      readonly countsTowardModelFailure?: boolean;
      readonly responseModelRevision?: string;
    } = {},
  ) {
    super(message);
    this.name = "DirectProviderRequestError";
    this.providerId = providerId;
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
    this.domain = observation.domain ?? ERROR_OBSERVATION[code].domain;
    this.countsTowardModelFailure = observation.countsTowardModelFailure
      ?? ERROR_OBSERVATION[code].countsTowardModelFailure;
    if (observation.responseModelRevision?.trim()) {
      this.responseModelRevision = observation.responseModelRevision.trim();
    }
  }
}

export interface ProviderTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface DirectProviderDecisionResult {
  readonly action: unknown;
  readonly usage?: ProviderTokenUsage;
  readonly responseModelRevision?: string;
}

export interface SamplingAudit {
  readonly policyVersion: "provider-default-audited-v1";
  readonly temperature: "omitted";
  readonly topP: "omitted";
  readonly maxOutputTokens: number;
  readonly jsonMode: "none" | "json-object" | "json-schema";
  readonly thinking: {
    readonly mode: ProviderThinkingMode;
    readonly sent: boolean;
  };
}

export interface DirectCompetitionProfile {
  readonly decisionPolicyId: string;
  readonly decisionPolicyHash: string;
  readonly modelObservationVersion: string;
  readonly contextPolicyVersion: "full-history-v1";
  readonly samplingPolicyVersion: "provider-default-audited-v1";
  readonly maxOutputTokensPerRequest: number;
}

export interface ModelRevisionAudit {
  readonly declared: string | null;
  readonly response: string | null;
  readonly resolved: string;
  readonly mismatch: boolean;
}

export interface ModelCallFailureAudit {
  readonly category: TechnicalFailureCategory;
  readonly domain: FaultDomain;
  readonly countsTowardModelFailure: boolean;
  readonly httpStatus?: number;
}

export interface ArenaModelCallAudit {
  readonly artifactType: "arena-model-call-v1";
  readonly modelCallId: string;
  readonly agentId: string;
  readonly agentSlot: number;
  readonly actionIndex: number;
  readonly observationHash: string;
  readonly fullContextHash: string;
  readonly status: "succeeded" | "failed";
  readonly latencyMs: number;
  readonly tokenUsage: ProviderTokenUsage | null;
  readonly usageMissing: boolean;
  readonly sampling: SamplingAudit;
  readonly modelRevision: ModelRevisionAudit;
  readonly actionEventId: string | null;
  readonly terminationEventId: string | null;
  readonly failure: ModelCallFailureAudit | null;
}

export interface DirectModelRunMetrics {
  readonly calls: readonly ArenaModelCallAudit[];
  readonly requestCount: number;
  readonly successfulRequestCount: number;
  readonly failedRequestCount: number;
  readonly usageReportedRequestCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly latencyMs: {
    readonly total: number;
    readonly minimum: number | null;
    readonly maximum: number | null;
    readonly average: number | null;
  };
  readonly errorCounts: Readonly<Partial<Record<TechnicalFailureCategory, number>>>;
}

/** A provider adapter owns the external call and returns untrusted data. */
export interface DirectModelProviderAdapter {
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly modelId: string;
  readonly maxOutputTokens: number;
  readonly thinkingMode?: ProviderThinkingMode;
  readonly declaredModelRevision?: string;
  readonly samplingAudit?: SamplingAudit;
  requestDecision(input: DirectModelDecisionInput): Promise<DirectProviderDecisionResult>;
}

/** Contract only; the Host owns a future strict MCP tool loop. */
export interface StrictMcpEpisodePort {
  readonly descriptor: AgentDescriptor;
  observe(): Observation;
  dispatch(action: unknown): StepResult | Promise<StepResult>;
  finalize(): FinalResult | Promise<FinalResult>;
  exportTrace(): EpisodeTrace | Promise<EpisodeTrace>;
}
