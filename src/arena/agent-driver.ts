import type {
  AgentDescriptor,
  EpisodeTrace,
  FinalResult,
  GameAction,
  ModelObservation,
  Observation,
  ProviderThinkingMode,
  StepResult,
} from "../core/contracts.js";

export interface AgentDecisionInput {
  readonly observation: Observation;
  readonly actionIndex: number;
  readonly recentResults: readonly StepResult[];
  readonly signal: AbortSignal;
}

export interface AgentResetInput {
  readonly signal: AbortSignal;
}

/**
 * Shared decision boundary for scripted, Direct Model and external MCP adapters.
 * Scripted and Direct Model implementations share the same isolated
 * GameEnvironment semantics; MCP remains an external Host adapter contract.
 */
export interface AgentDriver {
  readonly descriptor: AgentDescriptor;
  readonly competitionProfile?: DirectCompetitionProfile;
  reset?(input: AgentResetInput): void | Promise<void>;
  decide(input: AgentDecisionInput): GameAction | Promise<GameAction>;
  getRunMetrics?(): DirectModelRunMetrics;
}

export interface DirectModelRecentResult {
  readonly success: boolean;
  readonly code?: string;
  readonly message: string;
}

export interface DirectModelDecisionInput extends Omit<AgentDecisionInput, "observation" | "recentResults"> {
  readonly observation: ModelObservation;
  readonly recentResults: readonly DirectModelRecentResult[];
}

export type DirectProviderErrorCode =
  | "transport_error"
  | "http_error"
  | "invalid_response"
  | "refusal"
  | "incomplete";

/** Safe-to-report provider error. It never retains bodies, headers, keys or causes. */
export class DirectProviderRequestError extends Error {
  readonly code: DirectProviderErrorCode;
  readonly providerId: string;
  readonly httpStatus?: number;

  constructor(
    providerId: string,
    code: DirectProviderErrorCode,
    message: string,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "DirectProviderRequestError";
    this.providerId = providerId;
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
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
}

export interface DirectCompetitionProfile {
  readonly decisionPolicyId: string;
  readonly decisionPolicyHash: string;
  readonly modelObservationVersion: string;
  readonly maxOutputTokensPerRequest: number;
}

export interface DirectModelRunMetrics {
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
  readonly errorCounts: Readonly<Partial<Record<DirectProviderErrorCode, number>>>;
}

/** A provider implementation owns the external model call and returns untrusted data. */
export interface DirectModelProviderAdapter {
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly modelId: string;
  readonly maxOutputTokens: number;
  readonly thinkingMode?: ProviderThinkingMode;
  requestDecision(input: DirectModelDecisionInput): Promise<DirectProviderDecisionResult>;
}

/**
 * Contract only: an MCP server adapter exposes this port to an external Host.
 * The Host owns the tool loop; every action still dispatches to one isolated
 * GameEnvironment instance.
 */
export interface StrictMcpEpisodePort {
  readonly descriptor: AgentDescriptor;
  observe(): Observation;
  dispatch(action: unknown): StepResult | Promise<StepResult>;
  finalize(): FinalResult | Promise<FinalResult>;
  exportTrace(): EpisodeTrace | Promise<EpisodeTrace>;
}
