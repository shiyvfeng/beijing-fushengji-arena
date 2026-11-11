import type { GameAction, ModelObservation } from "../core/contracts.js";
import { integrityHash } from "../core/stable-value.js";
import type {
  AgentDecisionHistoryEntry,
  DecisionRetryFeedback,
} from "./agent-driver.js";

export const DIRECT_DECISION_POLICY_ID = "neutral-v1" as const;
export const DIRECT_MODEL_OBSERVATION_VERSION = "identity-free-v1" as const;
export const DIRECT_CONTEXT_POLICY_VERSION = "bounded-history-v1" as const;
export const DIRECT_RECOVERY_POLICY_VERSION = "bounded-retry-v2" as const;
export const DIRECT_SAMPLING_POLICY_VERSION = "provider-explicit-effort-audited-v2" as const;
export const DIRECT_RECENT_DAY_LIMIT = 5;
export const DIRECT_RECENT_ACTION_LIMIT = 8;
export const DIRECT_MAX_ATTEMPTS_PER_DECISION = 3;
export const DIRECT_MAX_REPAIR_RETRIES_PER_DECISION = 2;
export const DIRECT_MAX_TRANSIENT_RETRIES_PER_DECISION = 1;

export function directAttemptTimeoutMs(decisionTimeoutMs: number): number {
  if (!Number.isSafeInteger(decisionTimeoutMs) || decisionTimeoutMs <= 0) {
    throw new Error("decisionTimeoutMs 必须为正安全整数");
  }
  return Math.max(1, Math.floor(decisionTimeoutMs / 2));
}

const ACTION_TYPES: readonly GameAction["type"][] = Object.freeze([
  "move",
  "buy",
  "sell",
  "deposit",
  "withdraw",
  "repay_debt",
  "heal",
  "expand_capacity",
]);

export const DIRECT_DECISION_POLICY_TEXT = [
  "Maximize final net worth while staying alive and completing the full 40-day episode.",
  "Use only the supplied facts and rules. Balance liquidity, health, debt, inventory risk and terminal liquidation.",
  "Do not adopt a persona, role, slot-specific style or provider-specific strategy.",
].join("\n");

export const DIRECT_SYSTEM_INSTRUCTION = [
  "You are playing one isolated episode of Beijing Floating Life Arena.",
  DIRECT_DECISION_POLICY_TEXT,
  "Choose exactly one action allowed by the current observation without inventing state.",
  "If retryFeedback is present, inspect actionErrorCode and rejectedAction, do not repeat known-invalid values, and return one corrected feasible action immediately.",
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
  recoveryPolicyVersion: DIRECT_RECOVERY_POLICY_VERSION,
  actionContract: "arena-game-action-v1",
});

type Counter = Readonly<Record<string, number>>;

export interface BoundedHistorySummary {
  readonly totalAttempts: number;
  readonly successfulActions: number;
  readonly invalidActions: number;
  readonly actionTypeCounts: Counter;
  readonly resultCodeCounts: Counter;
}

export interface BoundedDaySummary {
  readonly day: number;
  readonly successfulActions: number;
  readonly invalidActions: number;
  readonly actionTypeCounts: Counter;
  readonly resultCodeCounts: Counter;
  readonly marketAfter: readonly {
    readonly itemId: number;
    readonly localPrice?: number;
    readonly publicReferencePrice?: number;
  }[];
  readonly notableEffects: readonly {
    readonly catalogEventId?: string;
    readonly globalEventId?: string;
    readonly scope: "public" | "personal" | "rule";
    readonly kind: "market" | "inventory" | "health" | "cash" | "debt" | "fame" | "status";
    readonly itemId?: number;
    readonly count: number;
    readonly totalAmount?: number;
  }[];
}

export interface BoundedHistoryUserContext {
  readonly contextPolicyVersion: typeof DIRECT_CONTEXT_POLICY_VERSION;
  readonly recoveryPolicyVersion: typeof DIRECT_RECOVERY_POLICY_VERSION;
  readonly actionIndex: number;
  readonly attemptIndex: number;
  readonly observation: ModelObservation;
  readonly olderHistorySummary: BoundedHistorySummary;
  readonly recentDaySummaries: readonly BoundedDaySummary[];
  readonly recentActions: readonly AgentDecisionHistoryEntry[];
  readonly retryFeedback: DecisionRetryFeedback | null;
}

function countActionTypes(entries: readonly AgentDecisionHistoryEntry[]): Counter {
  const counts: Record<string, number> = {};
  for (const type of ACTION_TYPES) counts[type] = 0;
  for (const entry of entries) {
    const type = entry.action.type;
    if (typeof type === "string" && Object.hasOwn(counts, type)) counts[type]++;
  }
  return Object.freeze(counts);
}

function countResultCodes(entries: readonly AgentDecisionHistoryEntry[]): Counter {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const code = entry.result.code ?? (entry.result.success ? "success" : "unknown_error");
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return Object.freeze(Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))));
}

function historySummary(entries: readonly AgentDecisionHistoryEntry[]): BoundedHistorySummary {
  const successfulActions = entries.filter(entry => entry.result.success).length;
  return Object.freeze({
    totalAttempts: entries.length,
    successfulActions,
    invalidActions: entries.length - successfulActions,
    actionTypeCounts: countActionTypes(entries),
    resultCodeCounts: countResultCodes(entries),
  });
}

function marketAfterForDay(entries: readonly AgentDecisionHistoryEntry[]): BoundedDaySummary["marketAfter"] {
  const values = new Map<number, { localPrice?: number; publicReferencePrice?: number }>();
  for (const entry of entries) {
    for (const [path, diff] of Object.entries(entry.stateDiff)) {
      const match = /^(market|publicReferencePrice)\[(\d+)\]$/u.exec(path);
      if (!match || typeof diff.after !== "number" || !Number.isFinite(diff.after)) continue;
      const itemId = Number(match[2]);
      const current = values.get(itemId) ?? {};
      if (match[1] === "market") current.localPrice = diff.after;
      else current.publicReferencePrice = diff.after;
      values.set(itemId, current);
    }
  }
  return Object.freeze([...values.entries()]
    .sort(([a], [b]) => a - b)
    .map(([itemId, prices]) => Object.freeze({ itemId, ...prices })));
}

function notableEffectsForDay(entries: readonly AgentDecisionHistoryEntry[]): BoundedDaySummary["notableEffects"] {
  const grouped = new Map<string, {
    catalogEventId?: string;
    globalEventId?: string;
    scope: "public" | "personal" | "rule";
    kind: "market" | "inventory" | "health" | "cash" | "debt" | "fame" | "status";
    itemId?: number;
    count: number;
    totalAmount?: number;
  }>();
  for (const effect of entries.flatMap(entry => entry.result.effects)) {
    if (effect.catalogEventId === undefined && effect.globalEventId === undefined) continue;
    const key = JSON.stringify([
      effect.catalogEventId ?? null,
      effect.globalEventId ?? null,
      effect.scope,
      effect.kind,
      effect.itemId ?? null,
    ]);
    const current = grouped.get(key) ?? {
      ...(effect.catalogEventId ? { catalogEventId: effect.catalogEventId } : {}),
      ...(effect.globalEventId ? { globalEventId: effect.globalEventId } : {}),
      scope: effect.scope,
      kind: effect.kind,
      ...(effect.itemId !== undefined ? { itemId: effect.itemId } : {}),
      count: 0,
    };
    current.count++;
    if (effect.amount !== undefined) current.totalAmount = (current.totalAmount ?? 0) + effect.amount;
    grouped.set(key, current);
  }
  return Object.freeze([...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, effect]) => Object.freeze(effect)));
}

function recentDaySummaries(
  currentDay: number,
  history: readonly AgentDecisionHistoryEntry[],
): readonly BoundedDaySummary[] {
  const firstDay = Math.max(0, currentDay - DIRECT_RECENT_DAY_LIMIT + 1);
  const summaries: BoundedDaySummary[] = [];
  for (let day = firstDay; day <= currentDay; day++) {
    const entries = history.filter(entry => entry.dayAfter === day);
    if (entries.length === 0) continue;
    const successfulActions = entries.filter(entry => entry.result.success).length;
    summaries.push(Object.freeze({
      day,
      successfulActions,
      invalidActions: entries.length - successfulActions,
      actionTypeCounts: countActionTypes(entries),
      resultCodeCounts: countResultCodes(entries),
      marketAfter: marketAfterForDay(entries),
      notableEffects: notableEffectsForDay(entries),
    }));
  }
  return Object.freeze(summaries);
}

export function buildBoundedHistoryUserContext(
  actionIndex: number,
  attemptIndex: number,
  observation: ModelObservation,
  history: readonly AgentDecisionHistoryEntry[],
  retryFeedback?: DecisionRetryFeedback,
): BoundedHistoryUserContext {
  const recentActions = Object.freeze(history.slice(-DIRECT_RECENT_ACTION_LIMIT));
  const olderHistory = history.slice(0, Math.max(0, history.length - recentActions.length));
  return Object.freeze({
    contextPolicyVersion: DIRECT_CONTEXT_POLICY_VERSION,
    recoveryPolicyVersion: DIRECT_RECOVERY_POLICY_VERSION,
    actionIndex,
    attemptIndex,
    observation,
    olderHistorySummary: historySummary(olderHistory),
    recentDaySummaries: recentDaySummaries(observation.day, history),
    recentActions,
    retryFeedback: retryFeedback ? Object.freeze(retryFeedback) : null,
  });
}

export function serializeBoundedHistoryUserContext(context: BoundedHistoryUserContext): string {
  return JSON.stringify(context);
}

export function fullContextHash(systemInstruction: string, userContext: string): string {
  return integrityHash({ systemInstruction, userContext });
}
