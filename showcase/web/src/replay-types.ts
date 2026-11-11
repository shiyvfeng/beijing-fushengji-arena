export type AgentId = string;

export type PublicEpisodeStatus =
  | "running"
  | "completed"
  | "dead"
  | "bankrupt"
  | "model_timeout"
  | "tool_limit"
  | "loop_terminated"
  | "runtime_error";

export type FaultDomain =
  | "platform"
  | "provider"
  | "model"
  | "protocol"
  | "runner"
  | "undetermined";

export type TechnicalFailureCategory =
  | "timeout"
  | "total_wall_clock"
  | "context_limit"
  | "action_budget"
  | "invalid_action_loop"
  | "transport_error"
  | "http_error"
  | "invalid_response"
  | "invalid_action"
  | "refusal"
  | "incomplete"
  | "driver_error";

export interface TechnicalFailure {
  category: TechnicalFailureCategory;
  phase: "reset" | "decide" | "action";
  domain: FaultDomain;
  countsTowardModelFailure: boolean;
  provider?: string;
  httpStatus?: number;
}

export interface AgentProfile {
  id: AgentId;
  label: string;
  provider: string;
  model: string;
  adapterVersion: string;
  visualIndex: number;
}

export interface PriceQuote {
  itemId: number;
  commodity: string;
  price: number;
  changePercent: number;
}

export interface InventoryLine {
  itemId: number;
  name: string;
  quantity: number;
  averageCost: number;
  referencePrice: number;
  markedValue: number;
}

export interface AgentSnapshot {
  agentId: AgentId;
  evidenceEventIds: string[];
  cash: number;
  bank: number;
  debt: number;
  health: number;
  netWorth: number;
  location: string;
  inventory: InventoryLine[];
  status: PublicEpisodeStatus;
  exitDay?: number;
  technicalFailure?: TechnicalFailure;
  provisionalRank: number | null;
  rankChange: number | null;
}

export interface AgentAction {
  id: string;
  agentId: AgentId;
  sequence: number;
  summary: string;
  result: string;
  success: boolean;
  code?: string;
  location: string;
  assisted?: boolean;
  assistanceReason?: AssistanceReason;
}

export type AssistanceReason =
  | "transient_retries_exhausted"
  | "repair_retries_exhausted"
  | "non_retryable_failure"
  | "circuit_open"
  | "provider_time_budget_exhausted";

export interface PublicEvent {
  id: string;
  catalogEventId?: string;
  title: string;
  summary: string;
}

export interface ReplayDay {
  day: number;
  prices: PriceQuote[];
  agents: AgentSnapshot[];
  actions: AgentAction[];
  publicEvents: PublicEvent[];
}

export interface CompetitionAuditBase {
  fairnessClass: "controlled-exhibition";
  decisionPolicyId: string;
  decisionPolicyHash: string;
  modelObservationVersion: string;
  contextPolicyVersion: "bounded-history-v1" | "bounded-daily-history-v1";
  recoveryPolicyVersion: "bounded-retry-v2" | "completion-assisted-v1";
  samplingPolicyVersion: "provider-explicit-effort-audited-v2";
  publicRandomization: "shared-seed";
  personalRandomization: "slot-isolated";
  slotRotation: {
    version: "cyclic-v1";
    rotationIndex: number;
    mappings: { entryIndex: number; agentId: string; slot: number }[];
  };
  maxActionsPerAgent: number;
  decisionTimeoutMs: number;
  attemptTimeoutMs: number;
  totalWallClockMsPerAgent: number;
  maxOutputTokensPerRequest: number;
  maxAttemptsPerDecision: 3;
  maxRepairRetriesPerDecision: 2;
  maxTransientRetriesPerDecision: 1 | 2;
  automaticRetries: 2;
}

export interface StrictCompetitionAudit extends CompetitionAuditBase {
  runTrack?: "strict-direct-v1";
  contextPolicyVersion: "bounded-history-v1";
  recoveryPolicyVersion: "bounded-retry-v2";
  maxTransientRetriesPerDecision: 1;
}

export interface CompletionAssistedCompetitionAudit extends CompetitionAuditBase {
  runTrack: "completion-assisted-v1";
  contextPolicyVersion: "bounded-daily-history-v1";
  recoveryPolicyVersion: "completion-assisted-v1";
  dailyPlanPolicyVersion: "daily-plan-v1";
  candidatePolicyVersion: "feasible-daily-plan-128-v1";
  assistancePolicyVersion: "assisted-pass-day-v1";
  maxTransientRetriesPerDecision: 2;
  maxDailyPlanCandidates: 128;
  maxDailyDecisionsPerAgent: number;
  maxPrepActionsPerDay: 2;
  providerTimeBudgetMsPerAgent: number;
  backoffScheduleMs: [15000, 45000];
  circuitBreaker: { failureThresholdDays: 3; skipScheduleDays: [2, 4, 8] };
}

export type CompetitionAudit = StrictCompetitionAudit | CompletionAssistedCompetitionAudit;

export interface AgentReliabilityAudit {
  agentId: AgentId;
  advancedDays: number;
  autonomousDays: number;
  assistedDays: number;
  autonomousDayRate: number;
  providerAttemptedDays: number;
  firstAttemptSuccessDays: number;
  firstAttemptSuccessRate: number;
  validPlanSelections: number;
  selectionResponseCount: number;
  validSelectionRate: number;
  providerRequestSuccessRate: number;
  providerWaitMs: number;
  retryCount: number;
  circuitSkippedDays: number;
  providerBudgetExhaustedDays: number;
  assistanceReasons: Partial<Record<AssistanceReason, number>>;
}

export interface MatchReliabilityAudit {
  policyVersion: "completion-reliability-v1";
  agents: AgentReliabilityAudit[];
}

export interface AgentPersonalRandomEventSummary {
  agentId: AgentId;
  favorableEvents: number;
  adverseEvents: number;
  favorableInventoryEvents: number;
  adverseCashEvents: number;
  adverseDebtEvents: number;
  adverseHealthEvents: number;
}

export interface PersonalRandomEventAudit {
  basis: "personal-event-count-v1";
  revealDay: 40;
  agents: AgentPersonalRandomEventSummary[];
}

export interface FinalResult {
  agentId: AgentId;
  rank: number | null;
  status: Exclude<PublicEpisodeStatus, "running">;
  exitDay: number;
  finalNetWorth: number;
  cash: number;
  bank: number;
  debt: number;
  inventoryLiquidationValue: number;
  technicalFailure?: TechnicalFailure;
}

export interface ReplayArtifact {
  schemaVersion: "arena-replay-view-v2";
  executionMode: "scripted" | "direct";
  matchId: string;
  title: string;
  scenarioId: string;
  seed: number;
  totalDays: 40;
  factLayerHash: string;
  replayHash: string;
  agentProfiles: AgentProfile[];
  days: ReplayDay[];
  competitionAudit?: CompetitionAudit;
  reliabilityAudit?: MatchReliabilityAudit;
  personalRandomEventAudit: PersonalRandomEventAudit;
  finalResults: FinalResult[];
}
