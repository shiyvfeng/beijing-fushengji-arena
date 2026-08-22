import {
  CAPACITY_INCREMENT,
  DEBT_CRISIS_HEALTH_LOSS,
  DEBT_CRISIS_THRESHOLD,
  DRUGS,
  DRUG_COUNT,
  FAME_LOSS_BANNED_BOOK,
  FAME_LOSS_FAKE_ALCOHOL,
  HEALTH_EVENTS,
  HOSPITAL_COST_PER_POINT,
  INIT_CAPACITY,
  INIT_CASH,
  INIT_DEBT,
  INIT_FAME,
  INIT_HEALTH,
  LOCATIONS,
  MARKET_EVENTS,
  MAX_CAPACITY,
  STEAL_EVENTS,
} from "../game-data.js";
import type {
  ActionErrorCode,
  ActionResultPayload,
  ArenaEvent,
  EpisodeConfig,
  EpisodeStatus,
  EpisodeTrace,
  EventEffect,
  FinalResult,
  GameAction,
  GameEnvironmentContract,
  GameStateSnapshot,
  InventoryPosition,
  ModelDecisionEvidence,
  Observation,
  SettlementLine,
  StepResult,
  TechnicalDnfStatus,
  TechnicalFailureDetail,
  AgentDescriptor,
} from "./contracts.js";
import {
  ARENA_SCHEMA_VERSION,
  RULESET_VERSION,
  SETTLEMENT_RULE_VERSION,
  TOOL_SCHEMA_VERSION,
} from "./contracts.js";
import {
  cashEventCatalogId,
  healthEventCatalogId,
  marketEventCatalogId,
} from "./event-catalog.js";
import {
  episodeConfigIntegrityHash,
  scenarioIntegrityHash,
} from "./integrity.js";
import { RNG_VERSION, SeededRng } from "./random/seeded-rng.js";
import { validateScenario } from "./scenario.js";
import { assertNoPotentialSecrets } from "./secret-scan.js";
import { diffState, type StateDiff } from "./state-diff.js";
import {
  cloneValue,
  deepFreeze,
  immutableClone,
  integrityHash,
  stableHash,
} from "./stable-value.js";

interface MutablePosition {
  itemId: number;
  quantity: number;
  averageCost: number;
}

interface MutableState {
  day: number;
  totalDays: number;
  daysLeft: number;
  cash: number;
  bank: number;
  debt: number;
  health: number;
  fame: number;
  capacity: number;
  currentLocation: number | null;
  currentMap: "subway" | "surface";
  inventory: MutablePosition[];
  market: number[];
  publicReferencePrice: number[];
  status: EpisodeStatus;
  actionCount: number;
  dayActionCount: number;
}

interface PublicDayMarket {
  readonly prices: readonly number[];
  readonly effects: readonly EventEffect[];
  readonly streams: readonly string[];
}

interface ExecutionResult extends ActionResultPayload {
  readonly streams: readonly string[];
}

const ALLOWED_ACTIONS: readonly GameAction["type"][] = Object.freeze([
  "move",
  "buy",
  "sell",
  "deposit",
  "withdraw",
  "repay_debt",
  "heal",
  "expand_capacity",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function normalizeAction(value: unknown): GameAction | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "move":
      return Number.isSafeInteger(value.locationId)
        ? { type: "move", locationId: Number(value.locationId) }
        : null;
    case "buy":
    case "sell":
      return Number.isSafeInteger(value.itemId) && isPositiveInteger(value.quantity)
        ? { type: value.type, itemId: Number(value.itemId), quantity: Number(value.quantity) }
        : null;
    case "deposit":
    case "withdraw":
    case "repay_debt":
      return isPositiveInteger(value.amount)
        ? { type: value.type, amount: Number(value.amount) }
        : null;
    case "heal":
      return isPositiveInteger(value.points)
        ? { type: "heal", points: Number(value.points) }
        : null;
    case "expand_capacity":
      return { type: "expand_capacity" };
    default:
      return null;
  }
}

function safeActionRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value) || typeof value.type !== "string") {
    return Object.freeze({ type: "unknown" });
  }
  const schemaFields: Readonly<Record<string, readonly string[]>> = {
    move: ["locationId"],
    buy: ["itemId", "quantity"],
    sell: ["itemId", "quantity"],
    deposit: ["amount"],
    withdraw: ["amount"],
    repay_debt: ["amount"],
    heal: ["points"],
    expand_capacity: [],
  };
  const allowedFields = schemaFields[value.type];
  if (!allowedFields) return Object.freeze({ type: "unknown" });

  const result: Record<string, unknown> = { type: value.type };
  for (const key of allowedFields) {
    const item = value[key];
    if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
  }
  return Object.freeze(result);
}

function inventoryTotal(state: MutableState): number {
  return state.inventory.reduce((sum, position) => sum + position.quantity, 0);
}

function rankEligibility(status: Exclude<EpisodeStatus, "running">): FinalResult["rankEligibility"] {
  if (status === "completed") return "eligible";
  if (status === "dead" || status === "bankrupt") return "game_failure";
  return "technical_dnf";
}

export class GameEnvironment implements GameEnvironmentContract {
  private config: EpisodeConfig | null = null;
  private state: MutableState | null = null;
  private rng: SeededRng | null = null;
  private readonly events: ArenaEvent[] = [];
  private initialStateHash = "";
  private finalResult: FinalResult | null = null;
  private failureMessage: string | undefined;
  private technicalFailure: TechnicalFailureDetail | undefined;

  reset(config: EpisodeConfig): Observation {
    if (this.config !== null) {
      throw new Error("an Arena episode may only be reset once; create a new environment");
    }
    validateScenario(config.scenario);
    if (!config.matchId.trim() || !config.episodeId.trim() || !config.agentId.trim()) {
      throw new Error("matchId, episodeId and agentId must not be empty");
    }
    if (!Number.isSafeInteger(config.agentSlot) || config.agentSlot < 0) {
      throw new Error("agentSlot must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(config.seed)) {
      throw new Error("seed must be a safe integer");
    }

    this.config = immutableClone(config) as EpisodeConfig;
    this.rng = new SeededRng(config.seed, `${config.scenario.id}:${RULESET_VERSION}`);
    this.state = {
      day: 0,
      totalDays: config.scenario.totalDays,
      daysLeft: config.scenario.totalDays,
      cash: INIT_CASH,
      bank: 0,
      debt: INIT_DEBT,
      health: INIT_HEALTH,
      fame: INIT_FAME,
      capacity: INIT_CAPACITY,
      currentLocation: null,
      currentMap: "subway",
      inventory: DRUGS.map(item => ({ itemId: item.id, quantity: 0, averageCost: 0 })),
      market: new Array<number>(DRUG_COUNT).fill(0),
      publicReferencePrice: new Array<number>(DRUG_COUNT).fill(0),
      status: "running",
      actionCount: 0,
      dayActionCount: 0,
    };

    const snapshot = this.snapshot();
    this.initialStateHash = integrityHash(snapshot);
    const observation = this.buildObservation();
    this.appendEvent(
      "episode_reset",
      undefined,
      snapshot,
      snapshot,
      {
        success: true,
        message: "Arena 独立对局环境已初始化。",
        effects: [],
      },
      [],
      observation.observationHash,
    );
    return observation;
  }

  observe(): Observation {
    this.ensureInitialized();
    return this.buildObservation();
  }

  step(input: GameAction | unknown, evidence?: ModelDecisionEvidence): StepResult {
    const state = this.ensureInitialized();
    const before = this.snapshot();

    if (this.finalResult !== null || state.status !== "running") {
      return this.unloggedRejection(
        "episode_terminated",
        "本局已终止，不能继续执行动作。",
        before,
      );
    }

    const action = normalizeAction(input);
    if (action === null) {
      const payload: ActionResultPayload = {
        success: false,
        code: "invalid_action",
        message: "动作不符合 Arena 工具契约。",
        effects: [],
      };
      const event = this.appendEvent(
        "action",
        safeActionRecord(input),
        before,
        before,
        payload,
        [],
        this.buildObservation().observationHash,
        evidence,
      );
      return this.makeStepResult(payload, before, before, {}, event);
    }

    const observationHash = this.buildObservation().observationHash;
    const execution = this.executeAction(action);
    if (execution.success) {
      state.actionCount++;
      state.dayActionCount++;
    }
    const after = this.snapshot();
    const diff = deepFreeze(diffState(before, after)) as StateDiff;
    const event = this.appendEvent(
      "action",
      action,
      before,
      after,
      execution,
      execution.streams,
      observationHash,
      evidence,
    );
    return this.makeStepResult(execution, before, after, diff, event);
  }

  terminateTechnical(
    status: TechnicalDnfStatus,
    message: string,
    detail: TechnicalFailureDetail,
    evidence?: ModelDecisionEvidence,
  ): void {
    const state = this.ensureInitialized();
    if (this.finalResult !== null || state.status !== "running") return;
    const before = this.snapshot();
    const observationHash = this.buildObservation().observationHash;
    state.status = status;
    this.failureMessage = message.slice(0, 500);
    this.technicalFailure = immutableClone(detail) as TechnicalFailureDetail;
    const after = this.snapshot();
    this.appendEvent(
      "technical_termination",
      undefined,
      before,
      after,
      {
        success: false,
        message: this.failureMessage,
        effects: [{
          scope: "rule",
          kind: "status",
          message: `本局技术状态已标记为 ${status}。`,
        }],
      },
      [],
      observationHash,
      evidence,
    );
  }

  finalize(): FinalResult {
    const state = this.ensureInitialized();
    if (this.finalResult !== null) return this.finalResult;

    if (state.status === "running") {
      this.terminateTechnical(
        "loop_terminated",
        "对局尚未自然结束时调用了 finalize()。",
        {
          category: "invalid_action_loop",
          phase: "action",
          domain: "model",
          countsTowardModelFailure: true,
        },
      );
    }

    const before = this.snapshot();
    const terminalPrices = this.publicMarketForDay(state.totalDays).prices;
    const settlement: SettlementLine[] = state.inventory.map(position => {
      const discount = this.config!.scenario.liquidityDiscounts[position.itemId];
      const value = Math.floor(position.quantity * terminalPrices[position.itemId] * discount);
      return {
        itemId: position.itemId,
        quantity: position.quantity,
        publicReferencePrice: terminalPrices[position.itemId],
        liquidityDiscount: discount,
        value,
      };
    });
    const inventoryLiquidationValue = settlement.reduce((sum, line) => sum + line.value, 0);
    state.cash += inventoryLiquidationValue;
    for (const position of state.inventory) {
      position.quantity = 0;
      position.averageCost = 0;
    }
    state.publicReferencePrice = [...terminalPrices];

    const after = this.snapshot();
    const terminalStatus = state.status as Exclude<EpisodeStatus, "running">;
    const eligibility = rankEligibility(terminalStatus);
    const finalNetWorth = state.cash + state.bank - state.debt;
    const event = this.appendEvent(
      "finalize",
      undefined,
      before,
      after,
      {
        success: true,
        message: "库存已按全场统一的第 40 天公共参考价完成一次性结算。",
        effects: [{
          scope: "rule",
          kind: "cash",
          amount: inventoryLiquidationValue,
          message: `库存清算入账 ${inventoryLiquidationValue} 元。`,
        }],
      },
      ["public.market.base", "public.market.event"],
      integrityHash({ status: terminalStatus, before }),
      undefined,
      state.totalDays,
    );

    this.finalResult = immutableClone({
      status: terminalStatus,
      endDay: state.day,
      finalNetWorth,
      rankEligible: eligibility !== "technical_dnf",
      rankEligibility: eligibility,
      cash: state.cash,
      bank: state.bank,
      debt: state.debt,
      inventoryLiquidationValue,
      publicReferencePrice: [...terminalPrices],
      settlement,
      finalState: after,
      finalStateHash: integrityHash(after),
      evidenceEventId: event.id,
      ...(this.failureMessage ? { failureMessage: this.failureMessage } : {}),
      ...(this.technicalFailure ? { technicalFailure: this.technicalFailure } : {}),
    }) as FinalResult;
    return this.finalResult;
  }

  exportTrace(agent: AgentDescriptor): EpisodeTrace {
    if (this.finalResult === null) this.finalize();
    const config = this.config!;
    const scenarioHash = scenarioIntegrityHash(config.scenario);
    const body = {
      schemaVersion: ARENA_SCHEMA_VERSION,
      matchId: config.matchId,
      episodeId: config.episodeId,
      agentId: config.agentId,
      rulesetVersion: RULESET_VERSION,
      toolSchemaVersion: TOOL_SCHEMA_VERSION,
      rngVersion: RNG_VERSION,
      settlementRuleVersion: SETTLEMENT_RULE_VERSION,
      scenarioId: config.scenario.id,
      scenarioHash,
      configHash: episodeConfigIntegrityHash(config),
      seed: config.seed,
      agentSlot: config.agentSlot,
      driver: agent.driver,
      agent: immutableClone(agent),
      initialStateHash: this.initialStateHash,
      events: immutableClone(this.events),
      finalResult: this.finalResult!,
    } as const;
    const trace = immutableClone({
      ...body,
      traceHash: integrityHash(body),
    }) as EpisodeTrace;
    assertNoPotentialSecrets(trace, "EpisodeTrace");
    return trace;
  }

  publicReferencePriceForDay(day: number): readonly number[] {
    this.ensureInitialized();
    if (!Number.isSafeInteger(day) || day < 1 || day > this.config!.scenario.totalDays) {
      throw new RangeError(`day must be between 1 and ${this.config!.scenario.totalDays}`);
    }
    return immutableClone(this.publicMarketForDay(day).prices) as readonly number[];
  }

  get eventLog(): readonly ArenaEvent[] {
    return immutableClone(this.events) as readonly ArenaEvent[];
  }

  private executeAction(action: GameAction): ExecutionResult {
    switch (action.type) {
      case "move":
        return this.move(action.locationId);
      case "buy":
        return this.buy(action.itemId, action.quantity);
      case "sell":
        return this.sell(action.itemId, action.quantity);
      case "deposit":
        return this.deposit(action.amount);
      case "withdraw":
        return this.withdraw(action.amount);
      case "repay_debt":
        return this.repayDebt(action.amount);
      case "heal":
        return this.heal(action.points);
      case "expand_capacity":
        return this.expandCapacity();
    }
  }

  private move(locationId: number): ExecutionResult {
    const state = this.state!;
    const location = LOCATIONS.find(item => item.id === locationId);
    if (!location) return this.error("invalid_location", `无效地点 ID：${locationId}。`);
    if (state.currentLocation === locationId) {
      return this.error("same_location", "不能移动到当前所在地点。");
    }

    state.day++;
    state.daysLeft = Math.max(0, state.totalDays - state.day);
    state.dayActionCount = 0;
    state.currentLocation = location.id;
    state.currentMap = location.map;
    state.debt += Math.floor(state.debt * this.config!.scenario.debtInterestRate);
    state.bank += Math.floor(state.bank * this.config!.scenario.bankInterestRate);

    const publicMarket = this.publicMarketForDay(state.day);
    state.publicReferencePrice = [...publicMarket.prices];
    state.market = this.localMarketForDay(state.day, location.id, publicMarket.prices);

    const effects: EventEffect[] = [...publicMarket.effects];
    const streams = new Set(publicMarket.streams);
    streams.add("public.market.location");
    if (state.day <= state.totalDays - 2) streams.add("public.market.availability");
    this.applyPersonalEvents(state.day, effects, streams);

    if (state.debt > DEBT_CRISIS_THRESHOLD && state.status === "running") {
      state.health = Math.max(0, state.health - DEBT_CRISIS_HEALTH_LOSS);
      effects.push({
        scope: "rule",
        kind: "health",
        amount: -DEBT_CRISIS_HEALTH_LOSS,
        message: `债务危机导致健康下降 ${DEBT_CRISIS_HEALTH_LOSS} 点。`,
      });
    }
    if (state.health <= 0) {
      state.health = 0;
      state.status = "dead";
      effects.push({ scope: "rule", kind: "status", message: "健康归零，游戏内出局。" });
    } else if (state.day >= state.totalDays) {
      state.status = "completed";
      effects.push({ scope: "rule", kind: "status", message: "已完成 40 天对局。" });
    }

    return {
      success: true,
      message: `移动到${location.name}，进入第 ${state.day} 天。`,
      effects,
      streams: [...streams].sort(),
    };
  }

  private buy(itemId: number, quantity: number): ExecutionResult {
    const state = this.state!;
    const invalid = this.validateTrade(itemId, quantity);
    if (invalid) return invalid;
    const price = state.market[itemId];
    if (price <= 0) return this.error("market_unavailable", `${DRUGS[itemId].name}在本地缺货。`);
    const availableCapacity = state.capacity - inventoryTotal(state);
    if (availableCapacity <= 0) return this.error("insufficient_capacity", "库存容量已满。");
    const affordable = Math.floor(state.cash / price);
    if (affordable <= 0) return this.error("insufficient_cash", "现金不足，无法买入。");

    const count = Math.min(quantity, availableCapacity, affordable);
    const position = state.inventory[itemId];
    const priorCost = position.quantity * position.averageCost;
    position.quantity += count;
    position.averageCost = Math.floor((priorCost + count * price) / position.quantity);
    state.cash -= count * price;
    return {
      success: true,
      message: `以单价 ${price} 元买入${DRUGS[itemId].name} × ${count}。`,
      effects: [{
        scope: "rule",
        kind: "inventory",
        itemId,
        amount: count,
        message: `库存增加 ${count} 件。`,
      }],
      streams: [],
    };
  }

  private sell(itemId: number, quantity: number): ExecutionResult {
    const state = this.state!;
    const invalid = this.validateTrade(itemId, quantity);
    if (invalid) return invalid;
    const position = state.inventory[itemId];
    if (position.quantity <= 0) {
      return this.error("insufficient_inventory", `当前没有可卖出的${DRUGS[itemId].name}。`);
    }
    const price = state.market[itemId];
    if (price <= 0) return this.error("market_unavailable", `本地市场暂不收购${DRUGS[itemId].name}。`);

    const count = Math.min(quantity, position.quantity);
    state.cash += count * price;
    position.quantity -= count;
    if (position.quantity === 0) position.averageCost = 0;
    const effects: EventEffect[] = [{
      scope: "rule",
      kind: "cash",
      itemId,
      amount: count * price,
      message: `卖出收入 ${count * price} 元。`,
    }];
    if (itemId === 4) {
      state.fame = Math.max(0, state.fame - FAME_LOSS_BANNED_BOOK);
      effects.push({ scope: "rule", kind: "fame", amount: -FAME_LOSS_BANNED_BOOK, message: "出售禁书导致声望下降。" });
    }
    if (itemId === 3) {
      state.fame = Math.max(0, state.fame - FAME_LOSS_FAKE_ALCOHOL);
      effects.push({ scope: "rule", kind: "fame", amount: -FAME_LOSS_FAKE_ALCOHOL, message: "出售假白酒导致声望下降。" });
    }
    return {
      success: true,
      message: `以单价 ${price} 元卖出${DRUGS[itemId].name} × ${count}。`,
      effects,
      streams: [],
    };
  }

  private deposit(amount: number): ExecutionResult {
    const state = this.state!;
    if (amount > state.cash) return this.error("insufficient_cash", "现金不足，无法存款。");
    state.cash -= amount;
    state.bank += amount;
    return this.success(`存入银行 ${amount} 元。`, "cash", -amount);
  }

  private withdraw(amount: number): ExecutionResult {
    const state = this.state!;
    if (amount > state.bank) return this.error("insufficient_bank_balance", "银行余额不足。");
    state.bank -= amount;
    state.cash += amount;
    return this.success(`从银行取出 ${amount} 元。`, "cash", amount);
  }

  private repayDebt(amount: number): ExecutionResult {
    const state = this.state!;
    if (state.debt <= 0) return this.error("no_debt", "当前没有未偿债务。");
    if (amount > state.cash) return this.error("insufficient_cash", "现金不足，无法还款。");
    const actual = Math.min(amount, state.debt);
    state.cash -= actual;
    state.debt -= actual;
    return this.success(`偿还债务 ${actual} 元。`, "debt", -actual);
  }

  private heal(points: number): ExecutionResult {
    const state = this.state!;
    if (state.health >= 100) return this.error("health_full", "健康值已满。");
    const actual = Math.min(points, 100 - state.health);
    const cost = actual * HOSPITAL_COST_PER_POINT;
    if (cost > state.cash) return this.error("insufficient_cash", "现金不足，无法治疗。");
    state.cash -= cost;
    state.health += actual;
    return this.success(`花费 ${cost} 元恢复 ${actual} 点健康。`, "health", actual);
  }

  private expandCapacity(): ExecutionResult {
    const state = this.state!;
    if (state.capacity >= MAX_CAPACITY) return this.error("capacity_max", "库存容量已达到上限。");
    if (state.cash < 30_000) return this.error("insufficient_cash", "扩容至少需要 30000 元现金。");
    const cost = Math.floor(state.cash / 2) + 2_000;
    state.cash -= cost;
    state.capacity = Math.min(MAX_CAPACITY, state.capacity + CAPACITY_INCREMENT);
    return this.success(`花费 ${cost} 元将库存容量扩至 ${state.capacity}。`, "cash", -cost);
  }

  private validateTrade(itemId: number, quantity: number): ExecutionResult | null {
    if (this.state!.currentLocation === null) {
      return this.error("location_required", "交易前请先移动到一个地点。");
    }
    if (!Number.isSafeInteger(itemId) || itemId < 0 || itemId >= DRUG_COUNT) {
      return this.error("invalid_item", `商品 ID 必须在 0 到 ${DRUG_COUNT - 1} 之间。`);
    }
    if (!isPositiveInteger(quantity)) {
      return this.error("invalid_quantity", "数量必须为正整数。");
    }
    return null;
  }

  private applyPersonalEvents(day: number, effects: EventEffect[], streams: Set<string>): void {
    const state = this.state!;
    const slot = this.config!.agentSlot;

    for (let index = 0; index < MARKET_EVENTS.length; index++) {
      const event = MARKET_EVENTS[index];
      if (event.add <= 0) continue;
      const stream = "personal.market.inventory";
      streams.add(stream);
      if (this.rng!.int(stream, 950, this.config!.scenario.id, slot, day, index) % event.freq !== 0) continue;

      if (index === MARKET_EVENTS.length - 1) {
        state.debt += 2_500;
        effects.push({
          catalogEventId: marketEventCatalogId(index),
          scope: "personal",
          kind: "debt",
          amount: 2_500,
          message: event.msg,
          sourceRandomStream: stream,
        });
      }
      const count = Math.min(event.add, state.capacity - inventoryTotal(state));
      if (count > 0) {
        state.inventory[event.drug].quantity += count;
        effects.push({
          catalogEventId: marketEventCatalogId(index),
          scope: "personal",
          kind: "inventory",
          itemId: event.drug,
          amount: count,
          message: event.msg,
          sourceRandomStream: stream,
        });
      }
    }

    for (let index = 0; index < HEALTH_EVENTS.length && state.health > 0; index++) {
      const event = HEALTH_EVENTS[index];
      const stream = "personal.health.event";
      streams.add(stream);
      if (this.rng!.int(stream, 1_000, this.config!.scenario.id, slot, day, index) % event.freq !== 0) continue;
      state.health = Math.max(0, state.health - event.hurt);
      effects.push({
        catalogEventId: healthEventCatalogId(index),
        scope: "personal",
        kind: "health",
        amount: -event.hurt,
        message: event.msg,
        sourceRandomStream: stream,
      });
    }

    for (let index = 0; index < STEAL_EVENTS.length; index++) {
      const event = STEAL_EVENTS[index];
      const stream = "personal.cash.event";
      streams.add(stream);
      if (this.rng!.int(stream, 1_000, this.config!.scenario.id, slot, day, index) % event.freq !== 0) continue;
      if (index === 5) {
        const before = state.bank;
        state.bank = Math.floor(state.bank * (100 - event.ratio) / 100);
        effects.push({
          catalogEventId: cashEventCatalogId(index),
          scope: "personal",
          kind: "cash",
          amount: state.bank - before,
          message: event.msg,
          sourceRandomStream: stream,
        });
      } else {
        const before = state.cash;
        state.cash = Math.max(0, Math.floor(state.cash * (100 - event.ratio) / 100));
        effects.push({
          catalogEventId: cashEventCatalogId(index),
          scope: "personal",
          kind: "cash",
          amount: state.cash - before,
          message: event.msg,
          sourceRandomStream: stream,
        });
      }
    }
  }

  private publicMarketForDay(day: number): PublicDayMarket {
    const prices = DRUGS.map(item => item.basePrice + this.rng!.int(
      "public.market.base",
      item.priceRange,
      this.config!.scenario.id,
      day,
      item.id,
    ));
    const effects: EventEffect[] = [];
    const streams = new Set<string>(["public.market.base", "public.market.event"]);

    for (let index = 0; index < MARKET_EVENTS.length; index++) {
      const event = MARKET_EVENTS[index];
      if (event.plus <= 0 && event.minus <= 0) continue;
      if (this.rng!.int(
        "public.market.event",
        950,
        this.config!.scenario.id,
        day,
        index,
      ) % event.freq !== 0) continue;

      if (event.plus > 0) prices[event.drug] *= event.plus;
      if (event.minus > 0) prices[event.drug] = Math.max(1, Math.floor(prices[event.drug] / event.minus));
      effects.push({
        catalogEventId: marketEventCatalogId(index),
        globalEventId: `global_${stableHash({
          matchId: this.config!.matchId,
          scenarioId: this.config!.scenario.id,
          seed: this.config!.seed,
          day,
          eventIndex: index,
        })}`,
        scope: "public",
        kind: "market",
        itemId: event.drug,
        message: event.msg,
        sourceRandomStream: "public.market.event",
      });
    }

    return deepFreeze({ prices, effects, streams: [...streams].sort() }) as PublicDayMarket;
  }

  private localMarketForDay(
    day: number,
    locationId: number,
    reference: readonly number[],
  ): number[] {
    const prices = reference.map((price, itemId) => {
      const adjustment = this.rng!.int(
        "public.market.location",
        21,
        this.config!.scenario.id,
        day,
        locationId,
        itemId,
      ) - 10;
      return Math.max(1, Math.floor(price * (100 + adjustment) / 100));
    });

    if (day <= this.config!.scenario.totalDays - 2) {
      const unavailable = DRUGS.map(item => ({
        itemId: item.id,
        score: this.rng!.uint32(
          "public.market.availability",
          this.config!.scenario.id,
          day,
          locationId,
          item.id,
        ),
      })).sort((a, b) => a.score - b.score || a.itemId - b.itemId).slice(0, 3);
      for (const item of unavailable) prices[item.itemId] = 0;
    }
    return prices;
  }

  private buildObservation(): Observation {
    const state = this.snapshot();
    const config = this.config!;
    const body = {
      schemaVersion: ARENA_SCHEMA_VERSION,
      rulesetVersion: RULESET_VERSION,
      toolSchemaVersion: TOOL_SCHEMA_VERSION,
      episodeId: config.episodeId,
      agentId: config.agentId,
      agentSlot: config.agentSlot,
      scenarioId: config.scenario.id,
      day: state.day,
      daysLeft: state.daysLeft,
      state,
      items: DRUGS.map(item => ({
        id: item.id,
        name: item.name,
        basePrice: item.basePrice,
        priceRange: item.priceRange,
        liquidityDiscount: config.scenario.liquidityDiscounts[item.id],
        localPrice: state.market[item.id],
        publicReferencePrice: state.publicReferencePrice[item.id],
        quantity: state.inventory[item.id].quantity,
        averageCost: state.inventory[item.id].averageCost,
      })),
      locations: LOCATIONS.map(location => ({ ...location })),
      allowedActions: state.status === "running" ? [...ALLOWED_ACTIONS] : [],
    } as const;
    return immutableClone({ ...body, observationHash: integrityHash(body) }) as Observation;
  }

  private snapshot(): GameStateSnapshot {
    const state = this.ensureInitialized();
    const inventory: InventoryPosition[] = state.inventory.map(position => ({ ...position }));
    return immutableClone({
      day: state.day,
      totalDays: state.totalDays,
      daysLeft: state.daysLeft,
      cash: state.cash,
      bank: state.bank,
      debt: state.debt,
      health: state.health,
      fame: state.fame,
      capacity: state.capacity,
      currentLocation: state.currentLocation,
      currentMap: state.currentMap,
      inventory,
      market: [...state.market],
      publicReferencePrice: [...state.publicReferencePrice],
      status: state.status,
      actionCount: state.actionCount,
      dayActionCount: state.dayActionCount,
    }) as GameStateSnapshot;
  }

  private appendEvent(
    type: ArenaEvent["type"],
    action: ArenaEvent["action"] | undefined,
    before: GameStateSnapshot,
    after: GameStateSnapshot,
    payload: ActionResultPayload,
    streams: readonly string[],
    observationHash?: string,
    evidence?: ModelDecisionEvidence,
    dayOverride?: number,
  ): ArenaEvent {
    const config = this.config!;
    const sequence = this.events.length;
    const id = `event_${stableHash({
      matchId: config.matchId,
      episodeId: config.episodeId,
      agentId: config.agentId,
      day: dayOverride ?? after.day,
      sequence,
      type,
    })}`;
    const event = immutableClone({
      id,
      evidenceId: id,
      matchId: config.matchId,
      episodeId: config.episodeId,
      agentId: config.agentId,
      day: dayOverride ?? after.day,
      sequence,
      type,
      ...(observationHash ? { observationHash } : {}),
      ...(evidence ? {
        modelCallId: evidence.modelCallId,
        fullContextHash: evidence.fullContextHash,
      } : {}),
      ...(action ? { action: cloneValue(action) } : {}),
      stateBefore: before,
      stateAfter: after,
      stateDiff: deepFreeze(diffState(before, after)),
      result: cloneValue(payload),
      sourceRandomStreams: [...new Set(streams)].sort(),
    }) as ArenaEvent;
    this.events.push(event);
    return event;
  }

  private makeStepResult(
    payload: ActionResultPayload,
    before: GameStateSnapshot,
    after: GameStateSnapshot,
    diff: StateDiff,
    event?: ArenaEvent,
  ): StepResult {
    return immutableClone({
      success: payload.success,
      ...(payload.code ? { code: payload.code } : {}),
      message: payload.message,
      observation: this.buildObservation(),
      before,
      after,
      diff,
      ...(event ? { event } : {}),
    }) as StepResult;
  }

  private unloggedRejection(
    code: ActionErrorCode,
    message: string,
    snapshot: GameStateSnapshot,
  ): StepResult {
    return this.makeStepResult(
      { success: false, code, message, effects: [] },
      snapshot,
      snapshot,
      {},
    );
  }

  private success(
    message: string,
    kind: EventEffect["kind"],
    amount: number,
  ): ExecutionResult {
    return {
      success: true,
      message,
      effects: [{ scope: "rule", kind, amount, message }],
      streams: [],
    };
  }

  private error(code: ActionErrorCode, message: string): ExecutionResult {
    return { success: false, code, message, effects: [], streams: [] };
  }

  private ensureInitialized(): MutableState {
    if (!this.state || !this.config || !this.rng) {
      throw new Error("Arena episode is not initialized; call reset() first");
    }
    return this.state;
  }
}
