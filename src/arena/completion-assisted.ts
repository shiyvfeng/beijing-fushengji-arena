import {
  HOSPITAL_COST_PER_POINT,
  MAX_CAPACITY,
} from "../game-data.js";
import type {
  GameAction,
  ModelObservation,
  Observation,
  TechnicalFailureCategory,
} from "../core/contracts.js";
import type { ProviderRetryDisposition } from "./agent-driver.js";
import { GameEnvironment } from "../core/game-environment.js";
import {
  immutableClone,
  integrityHash,
  stableStringify,
} from "../core/stable-value.js";
import type {
  AgentDecisionHistoryEntry,
  DecisionRetryFeedback,
  DirectActionRepairCode,
} from "./agent-driver.js";

export const COMPLETION_RUN_TRACK = "completion-assisted-v1" as const;
export const COMPLETION_DAILY_PLAN_POLICY_VERSION = "daily-plan-v1" as const;
export const COMPLETION_CANDIDATE_POLICY_VERSION = "feasible-daily-plan-128-v1" as const;
export const COMPLETION_CONTEXT_POLICY_VERSION = "bounded-daily-history-v1" as const;
export const COMPLETION_RECOVERY_POLICY_VERSION = "completion-assisted-v1" as const;
export const COMPLETION_ASSISTANCE_POLICY_VERSION = "assisted-pass-day-v1" as const;
export const COMPLETION_MAX_PLAN_CANDIDATES = 128 as const;
export const COMPLETION_MAX_PREP_ACTIONS = 2 as const;
export const COMPLETION_MAX_ATTEMPTS_PER_DAY = 3 as const;
export const COMPLETION_ATTEMPT_TIMEOUT_MS = 120_000 as const;
export const COMPLETION_PROVIDER_TIME_BUDGET_MS = 45 * 60 * 1_000;
export const COMPLETION_BACKOFF_SCHEDULE_MS = Object.freeze([15_000, 45_000] as const);
export const COMPLETION_CIRCUIT_SKIP_SCHEDULE_DAYS = Object.freeze([2, 4, 8] as const);
export const COMPLETION_CIRCUIT_FAILURE_THRESHOLD = 3 as const;

export interface DailyPlanCandidate {
  readonly id: string;
  readonly actions: readonly GameAction[];
  readonly resultingStateHash: string;
}

export interface DailyPlanOptions {
  readonly policyVersion: typeof COMPLETION_DAILY_PLAN_POLICY_VERSION;
  readonly candidatePolicyVersion: typeof COMPLETION_CANDIDATE_POLICY_VERSION;
  readonly plans: readonly DailyPlanCandidate[];
  readonly destinationIds: readonly number[];
  readonly optionsHash: string;
}

export interface DailyPlanSelection {
  readonly planId: string;
  readonly destinationId: number;
}

export interface CompletionContextInput {
  readonly actionIndex: number;
  readonly attemptIndex: number;
  readonly observation: ModelObservation;
  readonly dailyPlanOptions: DailyPlanOptions;
  readonly history: readonly AgentDecisionHistoryEntry[];
  readonly retryFeedback?: DecisionRetryFeedback;
}

interface CandidateDraft {
  readonly actions: readonly GameAction[];
  readonly resultingStateHash: string;
  readonly bucket: string;
  readonly sortKey: string;
}

const ACTION_TYPE_ORDER: readonly Exclude<GameAction["type"], "move">[] = Object.freeze([
  "buy",
  "sell",
  "deposit",
  "withdraw",
  "repay_debt",
  "heal",
  "expand_capacity",
]);

const ACTION_TYPE_RANK = new Map(ACTION_TYPE_ORDER.map((type, index) => [type, index]));

function uniquePositiveIntegers(values: readonly number[]): number[] {
  return [...new Set(values.filter(value => Number.isSafeInteger(value) && value > 0))]
    .sort((a, b) => a - b);
}

function unitHalfMax(maximum: number): number[] {
  if (!Number.isSafeInteger(maximum) || maximum <= 0) return [];
  return uniquePositiveIntegers([1, Math.floor(maximum / 2), maximum]);
}

function quarterHalfMax(maximum: number): number[] {
  if (!Number.isSafeInteger(maximum) || maximum <= 0) return [];
  return uniquePositiveIntegers([
    Math.floor(maximum / 4),
    Math.floor(maximum / 2),
    maximum,
  ]);
}

function actionSortKey(action: GameAction): string {
  return `${String(ACTION_TYPE_RANK.get(action.type as Exclude<GameAction["type"], "move">) ?? 99).padStart(2, "0")}:${stableStringify(action)}`;
}

function atomicActionsFor(observation: Observation): GameAction[] {
  const state = observation.state;
  const inventoryTotal = state.inventory.reduce((sum, item) => sum + item.quantity, 0);
  const capacityRemaining = Math.max(0, state.capacity - inventoryTotal);
  const actions: GameAction[] = [];

  for (const item of observation.items) {
    if (state.currentLocation !== null && item.localPrice > 0) {
      const buyMaximum = Math.min(capacityRemaining, Math.floor(state.cash / item.localPrice));
      for (const quantity of unitHalfMax(buyMaximum)) {
        actions.push(Object.freeze({ type: "buy", itemId: item.id, quantity }));
      }
      for (const quantity of unitHalfMax(item.quantity)) {
        actions.push(Object.freeze({ type: "sell", itemId: item.id, quantity }));
      }
    }
  }

  for (const amount of quarterHalfMax(state.cash)) {
    actions.push(Object.freeze({ type: "deposit", amount }));
  }
  for (const amount of quarterHalfMax(state.bank)) {
    actions.push(Object.freeze({ type: "withdraw", amount }));
  }
  for (const amount of quarterHalfMax(Math.min(state.cash, state.debt))) {
    actions.push(Object.freeze({ type: "repay_debt", amount }));
  }
  const healMaximum = Math.min(
    Math.max(0, 100 - state.health),
    Math.floor(state.cash / HOSPITAL_COST_PER_POINT),
  );
  for (const points of unitHalfMax(healMaximum)) {
    actions.push(Object.freeze({ type: "heal", points }));
  }
  if (state.capacity < MAX_CAPACITY && state.cash >= 30_000) {
    actions.push(Object.freeze({ type: "expand_capacity" }));
  }

  return actions.sort((a, b) => actionSortKey(a).localeCompare(actionSortKey(b)));
}

function stateHashForPreview(environment: GameEnvironment, actions: readonly GameAction[]): string | null {
  const preview = environment.previewActions(actions);
  return preview.success ? integrityHash(preview.after) : null;
}

function freezeDraft(actions: readonly GameAction[], resultingStateHash: string): CandidateDraft {
  const first = actions[0]?.type ?? "none";
  const second = actions[1]?.type ?? "none";
  return Object.freeze({
    actions: Object.freeze(actions.map(action => Object.freeze({ ...action }) as GameAction)),
    resultingStateHash,
    bucket: `${first}->${second}`,
    sortKey: actions.map(actionSortKey).join("|"),
  });
}

function choosePairDrafts(
  drafts: readonly CandidateDraft[],
  maximum: number,
): CandidateDraft[] {
  if (maximum <= 0) return [];
  const buckets = new Map<string, CandidateDraft[]>();
  for (const draft of drafts) {
    const values = buckets.get(draft.bucket) ?? [];
    values.push(draft);
    buckets.set(draft.bucket, values);
  }
  const ordered = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, values]) => ({
      bucket,
      values: values.sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
      index: 0,
    }));
  const selected: CandidateDraft[] = [];
  while (selected.length < maximum) {
    let progressed = false;
    for (const bucket of ordered) {
      const value = bucket.values[bucket.index];
      if (!value) continue;
      selected.push(value);
      bucket.index++;
      progressed = true;
      if (selected.length >= maximum) break;
    }
    if (!progressed) break;
  }
  return selected;
}

export function generateDailyPlanOptions(environment: GameEnvironment): DailyPlanOptions {
  const observation = environment.observe();
  if (observation.state.status !== "running") {
    throw new Error("终止状态不能生成 Daily Plan 候选");
  }
  const seenStates = new Set<string>();
  const noOpHash = integrityHash(observation.state);
  seenStates.add(noOpHash);
  const singles: CandidateDraft[] = [];
  const pairs: CandidateDraft[] = [];

  const firstActions = atomicActionsFor(observation);
  const feasibleFirstActions: { action: GameAction; observation: Observation }[] = [];
  for (const first of firstActions) {
    const firstPreview = environment.previewActions([first]);
    if (!firstPreview.success) continue;
    const firstHash = integrityHash(firstPreview.after);
    singles.push(freezeDraft([first], firstHash));
    seenStates.add(firstHash);
    feasibleFirstActions.push({ action: first, observation: firstPreview.observation });
  }
  for (const { action: first, observation: firstObservation } of feasibleFirstActions) {
    for (const second of atomicActionsFor(firstObservation)) {
      const actions = [first, second] as const;
      const pairHash = stateHashForPreview(environment, actions);
      if (!pairHash || seenStates.has(pairHash)) continue;
      seenStates.add(pairHash);
      pairs.push(freezeDraft(actions, pairHash));
    }
  }

  singles.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const baseDrafts: CandidateDraft[] = [freezeDraft([], noOpHash), ...singles];
  if (baseDrafts.length > COMPLETION_MAX_PLAN_CANDIDATES) {
    throw new Error("全部可行单操作超过 Daily Plan 候选上限");
  }
  const selected = [
    ...baseDrafts,
    ...choosePairDrafts(pairs, COMPLETION_MAX_PLAN_CANDIDATES - baseDrafts.length),
  ];
  const plans = selected.map((draft, index) => Object.freeze({
    id: `P${String(index + 1).padStart(3, "0")}`,
    actions: draft.actions,
    resultingStateHash: draft.resultingStateHash,
  }));
  const destinationIds = observation.locations
    .map(location => location.id)
    .filter(locationId => locationId !== observation.state.currentLocation)
    .sort((a, b) => a - b);
  const body = {
    policyVersion: COMPLETION_DAILY_PLAN_POLICY_VERSION,
    candidatePolicyVersion: COMPLETION_CANDIDATE_POLICY_VERSION,
    plans: Object.freeze(plans),
    destinationIds: Object.freeze(destinationIds),
  } as const;
  return immutableClone({
    ...body,
    optionsHash: integrityHash(body),
  }) as DailyPlanOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class DailyPlanSelectionContractError extends Error {
  constructor(
    readonly repairCode: DirectActionRepairCode,
    readonly rejectedSelection?: Readonly<Record<string, unknown>>,
  ) {
    super(`Daily Plan 选择契约错误：${repairCode}`);
    this.name = "DailyPlanSelectionContractError";
  }
}

function safeRejectedSelection(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.freeze({
    type: "daily_plan",
    ...(typeof value.planId === "string" ? { planId: value.planId.slice(0, 32) } : {}),
    ...(Number.isSafeInteger(value.destinationId)
      ? { destinationId: Number(value.destinationId) }
      : {}),
  });
}

export function parseDailyPlanSelection(
  value: unknown,
  options: DailyPlanOptions,
): DailyPlanSelection {
  return parseDailyPlanSelectionAgainstIds(
    value,
    options.plans.map(plan => plan.id),
    options.destinationIds,
  );
}

export function parseDailyPlanSelectionAgainstIds(
  value: unknown,
  planIds: readonly string[],
  destinationIds: readonly number[],
): DailyPlanSelection {
  if (!isRecord(value)) {
    throw new DailyPlanSelectionContractError("plan_must_be_object");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "destinationId" || keys[1] !== "planId") {
    throw new DailyPlanSelectionContractError("plan_fields_invalid", safeRejectedSelection(value));
  }
  if (typeof value.planId !== "string"
    || !planIds.includes(value.planId)) {
    throw new DailyPlanSelectionContractError("plan_id_unknown", safeRejectedSelection(value));
  }
  if (!Number.isSafeInteger(value.destinationId)
    || !destinationIds.includes(Number(value.destinationId))) {
    throw new DailyPlanSelectionContractError("destination_id_unknown", safeRejectedSelection(value));
  }
  return Object.freeze({ planId: value.planId, destinationId: Number(value.destinationId) });
}

export const COMPLETION_SYSTEM_INSTRUCTION = [
  "You are playing one isolated episode of Beijing Floating Life Arena.",
  "Maximize final net worth while staying alive and completing the full 40-day episode.",
  "Choose exactly one supplied daily plan ID and one supplied destination ID.",
  "Every supplied plan is executable. Do not invent actions, parameters, plan IDs or destinations.",
  "The selected plan performs up to two same-day operations, then the destination advances the game by one day.",
  "A valid selection is more important than exhaustively searching for the optimal combination.",
  "Do not enumerate or compare every supplied plan and destination combination; make a brief, satisfactory choice promptly.",
  "Reserve enough output for the final answer and return it as soon as you have a valid selection.",
  "Return JSON only with exactly two fields: planId and destinationId.",
  'Example: {"planId":"P001","destinationId":7}',
].join("\n");

function historySummary(history: readonly AgentDecisionHistoryEntry[]) {
  const recent = history.slice(-15).map(entry => ({
    dayBefore: entry.dayBefore,
    dayAfter: entry.dayAfter,
    action: entry.action,
    success: entry.result.success,
    code: entry.result.code,
    stateDiff: entry.stateDiff,
  }));
  return Object.freeze({
    olderActionCount: Math.max(0, history.length - recent.length),
    recent: Object.freeze(recent),
  });
}

export function serializeCompletionUserContext(input: CompletionContextInput): string {
  return stableStringify({
    contextPolicyVersion: COMPLETION_CONTEXT_POLICY_VERSION,
    dailyPlanPolicyVersion: COMPLETION_DAILY_PLAN_POLICY_VERSION,
    candidatePolicyVersion: COMPLETION_CANDIDATE_POLICY_VERSION,
    actionIndex: input.actionIndex,
    attemptIndex: input.attemptIndex,
    observation: input.observation,
    dailyPlanOptions: {
      optionsHash: input.dailyPlanOptions.optionsHash,
      plans: input.dailyPlanOptions.plans.map(plan => ({ id: plan.id, actions: plan.actions })),
      destinationIds: input.dailyPlanOptions.destinationIds,
    },
    history: historySummary(input.history),
    retryFeedback: input.retryFeedback ?? null,
  });
}

export const COMPLETION_DECISION_POLICY_HASH = integrityHash({
  runTrack: COMPLETION_RUN_TRACK,
  systemInstruction: COMPLETION_SYSTEM_INSTRUCTION,
  dailyPlanPolicyVersion: COMPLETION_DAILY_PLAN_POLICY_VERSION,
  candidatePolicyVersion: COMPLETION_CANDIDATE_POLICY_VERSION,
  contextPolicyVersion: COMPLETION_CONTEXT_POLICY_VERSION,
  recoveryPolicyVersion: COMPLETION_RECOVERY_POLICY_VERSION,
});

export type CompletionFailureKind = "transient" | "repair" | "non_retryable";

export function completionFailureKind(
  category: TechnicalFailureCategory,
  httpStatus?: number,
  disposition?: ProviderRetryDisposition,
): CompletionFailureKind {
  if (disposition) return disposition;
  if (category === "timeout" || category === "transport_error") return "transient";
  if (category === "http_error") {
    return httpStatus === 408 || httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)
      ? "transient"
      : "non_retryable";
  }
  if (category === "invalid_response"
    || category === "invalid_action"
    || category === "refusal"
    || category === "incomplete") {
    return "repair";
  }
  return "non_retryable";
}

export function circuitSkipDays(level: number): number {
  if (!Number.isSafeInteger(level) || level < 0) throw new Error("circuit level 无效");
  return COMPLETION_CIRCUIT_SKIP_SCHEDULE_DAYS[
    Math.min(level, COMPLETION_CIRCUIT_SKIP_SCHEDULE_DAYS.length - 1)
  ];
}

export function completionRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100_000) / 1_000;
}
