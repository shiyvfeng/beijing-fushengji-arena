import type { AgentDescriptor, GameAction, ObservationItem } from "../core/contracts.js";
import type { AgentDecisionInput, AgentDriver } from "./agent-driver.js";

export type ScriptedStrategyId = "steady" | "value" | "aggressive" | "cash-first";

interface StrategyProfile {
  readonly buyRangeFraction: number;
  readonly sellMultiplier: number;
  readonly cashReserve: number;
  readonly repayFraction: number;
  readonly maxBatch: number;
  readonly routeStride: number;
}

const STRATEGIES: Readonly<Record<ScriptedStrategyId, StrategyProfile>> = Object.freeze({
  steady: {
    buyRangeFraction: 0.42,
    sellMultiplier: 1.08,
    cashReserve: 700,
    repayFraction: 0.55,
    maxBatch: 30,
    routeStride: 1,
  },
  value: {
    buyRangeFraction: 0.38,
    sellMultiplier: 1.14,
    cashReserve: 700,
    repayFraction: 0.60,
    maxBatch: 35,
    routeStride: 1,
  },
  aggressive: {
    buyRangeFraction: 0.62,
    sellMultiplier: 1.03,
    cashReserve: 250,
    repayFraction: 0.25,
    maxBatch: 55,
    routeStride: 7,
  },
  "cash-first": {
    buyRangeFraction: 0.22,
    sellMultiplier: 1.02,
    cashReserve: 1_200,
    repayFraction: 0.80,
    maxBatch: 20,
    routeStride: 9,
  },
});

function bestSale(items: readonly ObservationItem[], multiplier: number): ObservationItem | undefined {
  return items
    .filter(item => item.quantity > 0 && item.localPrice > 0 && item.localPrice >= item.averageCost * multiplier)
    .sort((a, b) => {
      const aGain = (a.localPrice - a.averageCost) * a.quantity;
      const bGain = (b.localPrice - b.averageCost) * b.quantity;
      return bGain - aGain || a.id - b.id;
    })[0];
}

function bestPurchase(items: readonly ObservationItem[], fraction: number): ObservationItem | undefined {
  return items
    .filter(item => item.localPrice > 0)
    .map(item => ({
      item,
      normalizedPrice: (item.localPrice - item.basePrice) / Math.max(1, item.priceRange),
    }))
    .filter(entry => entry.normalizedPrice <= fraction)
    .sort((a, b) => a.normalizedPrice - b.normalizedPrice || a.item.id - b.item.id)[0]?.item;
}

export class ScriptedDriver implements AgentDriver {
  readonly descriptor: AgentDescriptor;
  private readonly profile: StrategyProfile;
  private phaseDay = -1;
  private phase = 0;

  constructor(
    id: string,
    displayName: string,
    slot: number,
    readonly strategyId: ScriptedStrategyId,
  ) {
    this.profile = STRATEGIES[strategyId];
    this.descriptor = Object.freeze({
      id,
      displayName,
      slot,
      driver: "scripted" as const,
      strategyId,
    });
  }

  reset(): void {
    this.phaseDay = -1;
    this.phase = 0;
  }

  decide(input: AgentDecisionInput): GameAction {
    const observation = input.observation;
    const state = observation.state;
    if (state.status !== "running") {
      throw new Error("脚本 Agent 在对局终止后仍收到决策请求");
    }
    if (state.currentLocation === null) {
      return { type: "move", locationId: this.nextLocation(observation.day, null) };
    }

    if (this.phaseDay !== observation.day) {
      this.phaseDay = observation.day;
      this.phase = 0;
    }

    while (this.phase < 4) {
      const currentPhase = this.phase++;
      if (currentPhase === 0) {
        const sale = bestSale(observation.items, this.profile.sellMultiplier);
        if (sale) return { type: "sell", itemId: sale.id, quantity: sale.quantity };
      }

      if (currentPhase === 1 && state.debt > 0 && state.cash > this.profile.cashReserve) {
        const spendable = state.cash - this.profile.cashReserve;
        const amount = Math.min(state.debt, Math.max(1, Math.floor(spendable * this.profile.repayFraction)));
        if (amount > 0) return { type: "repay_debt", amount };
      }

      if (currentPhase === 2) {
        const purchase = bestPurchase(observation.items, this.profile.buyRangeFraction);
        if (purchase) {
          const freeCapacity = state.capacity - state.inventory.reduce((sum, item) => sum + item.quantity, 0);
          const spendable = Math.max(0, state.cash - this.profile.cashReserve);
          const quantity = Math.min(
            this.profile.maxBatch,
            freeCapacity,
            Math.floor(spendable / purchase.localPrice),
          );
          if (quantity > 0) return { type: "buy", itemId: purchase.id, quantity };
        }
      }

      if (currentPhase === 3) {
        return {
          type: "move",
          locationId: this.nextLocation(observation.day, state.currentLocation),
        };
      }
    }

    return {
      type: "move",
      locationId: this.nextLocation(observation.day, state.currentLocation),
    };
  }

  private nextLocation(day: number, current: number | null): number {
    let candidate = (this.descriptor.slot * 5 + (day + 1) * this.profile.routeStride) % 20;
    if (candidate === current) candidate = (candidate + this.profile.routeStride + 1) % 20;
    return candidate;
  }
}

export function createSampleScriptedDrivers(): ScriptedDriver[] {
  return [
    new ScriptedDriver("agent-steady", "稳健铁算盘", 0, "steady"),
    new ScriptedDriver("agent-value", "胡同捡漏王", 1, "value"),
    new ScriptedDriver("agent-aggressive", "京城冲浪客", 2, "aggressive"),
    new ScriptedDriver("agent-cash", "现金守门员", 3, "cash-first"),
  ];
}
