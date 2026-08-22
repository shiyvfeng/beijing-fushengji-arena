import type { ModelObservation } from "../core/contracts.js";
import { integrityHash } from "../core/stable-value.js";
import type { AgentDecisionHistoryEntry } from "./agent-driver.js";

export const DIRECT_DECISION_POLICY_ID = "neutral-v1" as const;
export const DIRECT_MODEL_OBSERVATION_VERSION = "identity-free-v1" as const;
export const DIRECT_CONTEXT_POLICY_VERSION = "full-history-v1" as const;
export const DIRECT_SAMPLING_POLICY_VERSION = "provider-default-audited-v1" as const;

export const DIRECT_DECISION_POLICY_TEXT = [
  "Maximize final net worth while staying alive and completing the full 40-day episode.",
  "Use only the supplied facts and rules. Balance liquidity, health, debt, inventory risk and terminal liquidation.",
  "Do not adopt a persona, role, slot-specific style or provider-specific strategy.",
].join("\n");

export const DIRECT_SYSTEM_INSTRUCTION = [
  "You are playing one isolated episode of Beijing Floating Life Arena.",
  DIRECT_DECISION_POLICY_TEXT,
  "Choose exactly one action allowed by the current observation without inventing state.",
  "You must reach the final day within the action budget; only move advances the day and applies interest and events.",
  "After the final day, inventory is liquidated once at publicReferencePrice times each item's liquidityDiscount; final net worth is cash plus bank minus debt after liquidation.",
  "If currentLocation is null, move first. Never move to the current location, and treat localPrice 0 as unavailable.",
  "Use only locationId/itemId values present in the current observation and positive integer quantities, amounts or points.",
  "Return JSON only, without markdown, commentary or extra properties. Use exactly one of these shapes:",
  '{"type":"move","locationId":0}',
  '{"type":"buy","itemId":0,"quantity":1}',
  '{"type":"sell","itemId":0,"quantity":1}',
  '{"type":"deposit","amount":1}',
  '{"type":"withdraw","amount":1}',
  '{"type":"repay_debt","amount":1}',
  '{"type":"heal","points":1}',
  '{"type":"expand_capacity"}',
].join("\n");

export const DIRECT_DECISION_POLICY_HASH = integrityHash({
  policyId: DIRECT_DECISION_POLICY_ID,
  policyText: DIRECT_DECISION_POLICY_TEXT,
  modelObservationVersion: DIRECT_MODEL_OBSERVATION_VERSION,
  contextPolicyVersion: DIRECT_CONTEXT_POLICY_VERSION,
  actionContract: "arena-game-action-v1",
});

export interface FullHistoryUserContext {
  readonly contextPolicyVersion: typeof DIRECT_CONTEXT_POLICY_VERSION;
  readonly actionIndex: number;
  readonly observation: ModelObservation;
  readonly history: readonly AgentDecisionHistoryEntry[];
}

export function buildFullHistoryUserContext(
  actionIndex: number,
  observation: ModelObservation,
  history: readonly AgentDecisionHistoryEntry[],
): FullHistoryUserContext {
  return Object.freeze({
    contextPolicyVersion: DIRECT_CONTEXT_POLICY_VERSION,
    actionIndex,
    observation,
    history,
  });
}

export function serializeFullHistoryUserContext(context: FullHistoryUserContext): string {
  return JSON.stringify(context);
}

export function fullContextHash(systemInstruction: string, userContext: string): string {
  return integrityHash({
    systemInstruction,
    userContext,
  });
}
