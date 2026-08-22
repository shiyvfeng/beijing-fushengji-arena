import type { StateDiff } from "./state-diff.js";

export const ARENA_SCHEMA_VERSION = "arena-schema-v4" as const;
export const RULESET_VERSION = "fushengji-rules-v1" as const;
export const TOOL_SCHEMA_VERSION = "arena-tools-v1" as const;
export const SETTLEMENT_RULE_VERSION = "public-reference-v1" as const;

export type DriverKind = "direct" | "mcp" | "scripted";
export type ArenaExecutionMode = "direct" | "scripted";
export type MapKind = "subway" | "surface";
export type ProviderThinkingMode = "default" | "disabled" | "enabled";
export type ProviderReasoningEffort =
  | "default"
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type TechnicalDnfStatus =
  | "model_timeout"
  | "tool_limit"
  | "loop_terminated"
  | "runtime_error";

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

export type FaultDomain =
  | "platform"
  | "provider"
  | "model"
  | "protocol"
  | "runner"
  | "undetermined";

export interface TechnicalFailureDetail {
  readonly category: TechnicalFailureCategory;
  readonly phase: "reset" | "decide" | "action";
  readonly domain: FaultDomain;
  readonly countsTowardModelFailure: boolean;
  readonly provider?: string;
  readonly httpStatus?: number;
}

export type EpisodeStatus =
  | "running"
  | "completed"
  | "dead"
  | "bankrupt"
  | TechnicalDnfStatus;

export interface ScenarioConfig {
  readonly id: string;
  readonly totalDays: number;
  readonly liquidityDiscounts: readonly number[];
  readonly debtInterestRate: number;
  readonly bankInterestRate: number;
}

export interface EpisodeConfig {
  readonly matchId: string;
  readonly episodeId: string;
  readonly agentId: string;
  readonly agentSlot: number;
  readonly seed: number;
  readonly scenario: ScenarioConfig;
}

export interface InventoryPosition {
  readonly itemId: number;
  readonly quantity: number;
  readonly averageCost: number;
}

export interface GameStateSnapshot {
  readonly day: number;
  readonly totalDays: number;
  readonly daysLeft: number;
  readonly cash: number;
  readonly bank: number;
  readonly debt: number;
  readonly health: number;
  readonly fame: number;
  readonly capacity: number;
  readonly currentLocation: number | null;
  readonly currentMap: MapKind;
  readonly inventory: readonly InventoryPosition[];
  readonly market: readonly number[];
  readonly publicReferencePrice: readonly number[];
  readonly status: EpisodeStatus;
  readonly actionCount: number;
  readonly dayActionCount: number;
}

export interface ObservationItem {
  readonly id: number;
  readonly name: string;
  readonly basePrice: number;
  readonly priceRange: number;
  readonly liquidityDiscount: number;
  readonly localPrice: number;
  readonly publicReferencePrice: number;
  readonly quantity: number;
  readonly averageCost: number;
}

export interface ObservationLocation {
  readonly id: number;
  readonly name: string;
  readonly map: MapKind;
}

export interface Observation {
  readonly schemaVersion: typeof ARENA_SCHEMA_VERSION;
  readonly rulesetVersion: typeof RULESET_VERSION;
  readonly toolSchemaVersion: typeof TOOL_SCHEMA_VERSION;
  readonly episodeId: string;
  readonly agentId: string;
  readonly agentSlot: number;
  readonly scenarioId: string;
  readonly day: number;
  readonly daysLeft: number;
  readonly state: GameStateSnapshot;
  readonly items: readonly ObservationItem[];
  readonly locations: readonly ObservationLocation[];
  readonly allowedActions: readonly GameAction["type"][];
  readonly observationHash: string;
}

/** Identity-free observation sent to every Direct Model contestant. */
export interface ModelObservation {
  readonly schemaVersion: typeof ARENA_SCHEMA_VERSION;
  readonly rulesetVersion: typeof RULESET_VERSION;
  readonly toolSchemaVersion: typeof TOOL_SCHEMA_VERSION;
  readonly scenarioId: string;
  readonly day: number;
  readonly daysLeft: number;
  readonly state: GameStateSnapshot;
  readonly items: readonly ObservationItem[];
  readonly locations: readonly ObservationLocation[];
  readonly allowedActions: readonly GameAction["type"][];
}

export type GameAction =
  | { readonly type: "move"; readonly locationId: number }
  | { readonly type: "buy"; readonly itemId: number; readonly quantity: number }
  | { readonly type: "sell"; readonly itemId: number; readonly quantity: number }
  | { readonly type: "deposit"; readonly amount: number }
  | { readonly type: "withdraw"; readonly amount: number }
  | { readonly type: "repay_debt"; readonly amount: number }
  | { readonly type: "heal"; readonly points: number }
  | { readonly type: "expand_capacity" };

export type ActionErrorCode =
  | "invalid_action"
  | "episode_terminated"
  | "invalid_location"
  | "same_location"
  | "invalid_item"
  | "invalid_quantity"
  | "invalid_amount"
  | "location_required"
  | "market_unavailable"
  | "insufficient_cash"
  | "insufficient_inventory"
  | "insufficient_capacity"
  | "insufficient_bank_balance"
  | "no_debt"
  | "health_full"
  | "capacity_max";

export interface EventEffect {
  readonly catalogEventId?: string;
  readonly globalEventId?: string;
  readonly scope: "public" | "personal" | "rule";
  readonly kind: "market" | "inventory" | "health" | "cash" | "debt" | "fame" | "status";
  readonly message: string;
  readonly itemId?: number;
  readonly amount?: number;
  readonly sourceRandomStream?: string;
}

export interface ActionResultPayload {
  readonly success: boolean;
  readonly code?: ActionErrorCode;
  readonly message: string;
  readonly effects: readonly EventEffect[];
}

export interface ArenaEvent {
  readonly id: string;
  readonly evidenceId: string;
  readonly matchId: string;
  readonly episodeId: string;
  readonly agentId: string;
  readonly day: number;
  readonly sequence: number;
  readonly type: "episode_reset" | "action" | "technical_termination" | "finalize";
  readonly observationHash?: string;
  readonly fullContextHash?: string;
  readonly modelCallId?: string;
  readonly action?: GameAction | Readonly<Record<string, unknown>>;
  readonly stateBefore: GameStateSnapshot;
  readonly stateAfter: GameStateSnapshot;
  readonly stateDiff: StateDiff;
  readonly result: ActionResultPayload;
  readonly sourceRandomStreams: readonly string[];
}

export interface ModelDecisionEvidence {
  readonly modelCallId: string;
  readonly fullContextHash: string;
}

export interface StepResult {
  readonly success: boolean;
  readonly code?: ActionErrorCode;
  readonly message: string;
  readonly observation: Observation;
  readonly before: GameStateSnapshot;
  readonly after: GameStateSnapshot;
  readonly diff: StateDiff;
  readonly event?: ArenaEvent;
}

export interface SettlementLine {
  readonly itemId: number;
  readonly quantity: number;
  readonly publicReferencePrice: number;
  readonly liquidityDiscount: number;
  readonly value: number;
}

export interface FinalResult {
  readonly status: Exclude<EpisodeStatus, "running">;
  readonly endDay: number;
  readonly finalNetWorth: number;
  readonly rankEligible: boolean;
  readonly rankEligibility: "eligible" | "game_failure" | "technical_dnf";
  readonly cash: number;
  readonly bank: number;
  readonly debt: number;
  readonly inventoryLiquidationValue: number;
  readonly publicReferencePrice: readonly number[];
  readonly settlement: readonly SettlementLine[];
  readonly finalState: GameStateSnapshot;
  readonly finalStateHash: string;
  readonly evidenceEventId: string;
  readonly failureMessage?: string;
  readonly technicalFailure?: TechnicalFailureDetail;
}

export interface AgentDescriptor {
  readonly id: string;
  /** Scripted-only presentation label. Direct descriptors must omit it. */
  readonly displayName?: string;
  readonly slot: number;
  readonly driver: DriverKind;
  /** Scripted-only presentation persona. Direct descriptors must omit it. */
  readonly personaId?: string;
  readonly decisionPolicyId?: string;
  readonly decisionPolicyHash?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly providerAdapterVersion?: string;
  readonly providerThinkingMode?: ProviderThinkingMode;
  readonly providerReasoningEffort?: ProviderReasoningEffort;
  readonly declaredModelRevision?: string;
}

export interface EpisodeTrace {
  readonly schemaVersion: typeof ARENA_SCHEMA_VERSION;
  readonly matchId: string;
  readonly episodeId: string;
  readonly agentId: string;
  readonly rulesetVersion: typeof RULESET_VERSION;
  readonly toolSchemaVersion: typeof TOOL_SCHEMA_VERSION;
  readonly rngVersion: string;
  readonly settlementRuleVersion: typeof SETTLEMENT_RULE_VERSION;
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly configHash: string;
  readonly seed: number;
  readonly agentSlot: number;
  readonly driver: DriverKind;
  readonly agent: AgentDescriptor;
  readonly initialStateHash: string;
  readonly events: readonly ArenaEvent[];
  readonly finalResult: FinalResult;
  readonly traceHash: string;
}

export interface ReplayAgent {
  readonly id: string;
  readonly displayName?: string;
  readonly slot: number;
  readonly driver: DriverKind;
  readonly personaId?: string;
  readonly decisionPolicyId?: string;
  readonly decisionPolicyHash?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly providerAdapterVersion?: string;
  readonly providerThinkingMode?: ProviderThinkingMode;
  readonly providerReasoningEffort?: ProviderReasoningEffort;
  readonly declaredModelRevision?: string;
  readonly status: Exclude<EpisodeStatus, "running">;
  readonly finalNetWorth: number;
  readonly rank: number | null;
  readonly rankEligible: boolean;
  readonly traceHash: string;
  readonly finalResult: FinalResult;
}

export interface ReplayAgentSnapshot {
  readonly agentId: string;
  readonly agentSlot: number;
  readonly state: GameStateSnapshot;
}

export interface ReplayDay {
  readonly day: number;
  readonly publicReferencePrice: readonly number[];
  readonly agentSnapshots: readonly ReplayAgentSnapshot[];
  readonly events: readonly ArenaEvent[];
}

export interface FinalRankingEntry {
  readonly rank: number;
  readonly agentId: string;
  readonly agentSlot: number;
  readonly finalNetWorth: number;
  readonly tier: "completed" | "game_failure";
}

export interface CompetitionAudit {
  readonly fairnessClass: "controlled-exhibition";
  readonly decisionPolicyId: string;
  readonly decisionPolicyHash: string;
  readonly modelObservationVersion: string;
  readonly contextPolicyVersion: "bounded-history-v1";
  readonly recoveryPolicyVersion: "bounded-retry-v1";
  readonly samplingPolicyVersion: "provider-explicit-effort-audited-v2";
  readonly publicRandomization: "shared-seed";
  readonly personalRandomization: "slot-isolated";
  readonly slotRotation: {
    readonly version: "cyclic-v1";
    readonly rotationIndex: number;
    readonly mappings: readonly {
      readonly entryIndex: number;
      readonly agentId: string;
      readonly slot: number;
    }[];
  };
  readonly maxActionsPerAgent: number;
  readonly decisionTimeoutMs: number;
  readonly attemptTimeoutMs: number;
  readonly totalWallClockMsPerAgent: number;
  readonly maxOutputTokensPerRequest: number;
  readonly maxAttemptsPerDecision: 3;
  readonly maxRepairRetriesPerDecision: 2;
  readonly maxTransientRetriesPerDecision: 1;
  readonly automaticRetries: 2;
}

export interface AgentPersonalRandomEventSummary {
  readonly agentId: string;
  readonly favorableEvents: number;
  readonly adverseEvents: number;
  readonly favorableInventoryEvents: number;
  readonly adverseCashEvents: number;
  readonly adverseDebtEvents: number;
  readonly adverseHealthEvents: number;
}

export interface PersonalRandomEventAudit {
  readonly basis: "personal-event-count-v1";
  readonly revealDay: number;
  readonly agents: readonly AgentPersonalRandomEventSummary[];
}

export interface MatchMetadata {
  readonly title: string;
  readonly executionMode: ArenaExecutionMode;
  readonly agentCount: number;
  readonly totalDays: number;
}

export interface MatchReplay {
  readonly schemaVersion: typeof ARENA_SCHEMA_VERSION;
  readonly matchId: string;
  readonly rulesetVersion: typeof RULESET_VERSION;
  readonly toolSchemaVersion: typeof TOOL_SCHEMA_VERSION;
  readonly rngVersion: string;
  readonly settlementRuleVersion: typeof SETTLEMENT_RULE_VERSION;
  readonly scenarioId: string;
  readonly seed: number;
  readonly metadata: MatchMetadata;
  readonly sourceTraceHashes: readonly string[];
  readonly agents: readonly ReplayAgent[];
  readonly days: readonly ReplayDay[];
  readonly finalRanking: readonly FinalRankingEntry[];
  readonly setupEvents: readonly ArenaEvent[];
  readonly competitionAudit?: CompetitionAudit;
  readonly personalRandomEventAudit: PersonalRandomEventAudit;
  readonly configHash: string;
  readonly eventHash: string;
  readonly factHash: string;
  readonly replayHash: string;
}

export interface GameEnvironmentContract {
  reset(config: EpisodeConfig): Observation;
  observe(): Observation;
  step(action: GameAction | unknown, evidence?: ModelDecisionEvidence): StepResult;
  finalize(): FinalResult;
}
