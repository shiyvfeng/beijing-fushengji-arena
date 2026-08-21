export const AGENT_IDS = ["A", "B", "C", "D"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type PublicEpisodeStatus =
  | "running"
  | "completed"
  | "dead"
  | "bankrupt"
  | "model_timeout"
  | "tool_limit"
  | "loop_terminated"
  | "runtime_error";

export type TechnicalFailureCategory =
  | "timeout"
  | "action_budget"
  | "invalid_action_loop"
  | "transport_error"
  | "http_error"
  | "invalid_response"
  | "refusal"
  | "incomplete"
  | "driver_error";

export interface TechnicalFailure {
  category: TechnicalFailureCategory;
  phase: "reset" | "decide" | "action";
  provider?: string;
  httpStatus?: number;
}

export interface AgentProfile {
  id: AgentId;
  coreId: string;
  name: string;
  personaId?: string;
  provider: string;
  model: string;
  adapterVersion: string;
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
  publicRandomization: "shared-seed";
  personalRandomization: "slot-isolated";
  maxActionsPerAgent: number;
  decisionTimeoutMs: number;
  maxOutputTokensPerRequest: number;
  automaticRetries: 0;
}

export interface AgentLuckSummary {
  agentId: AgentId;
  favorableEvents: number;
  adverseEvents: number;
  favorableInventoryEvents: number;
  adverseCashEvents: number;
  adverseDebtEvents: number;
  adverseHealthEvents: number;
}

export interface LuckAudit {
  basis: "personal-event-count-v1";
  revealDay: 40;
  agents: AgentLuckSummary[];
  luckiestAgentIds: AgentId[];
  unluckiestAgentIds: AgentId[];
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
  schemaVersion: "arena-replay-view-v1";
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
  luckAudit: LuckAudit;
  finalResults: FinalResult[];
}
