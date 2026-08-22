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
}

export interface PublicEvent {
  id: string;
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

export interface CompetitionAudit {
  fairnessClass: "controlled-exhibition";
  decisionPolicyId: string;
  decisionPolicyHash: string;
  modelObservationVersion: string;
  contextPolicyVersion: "full-history-v1";
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
  totalWallClockMsPerAgent: number;
  maxOutputTokensPerRequest: number;
  automaticRetries: 0;
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
  personalRandomEventAudit: PersonalRandomEventAudit;
  finalResults: FinalResult[];
}
