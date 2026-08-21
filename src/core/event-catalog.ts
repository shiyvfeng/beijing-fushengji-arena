import { HEALTH_EVENTS, MARKET_EVENTS, STEAL_EVENTS } from "../game-data.js";

export interface BaseEventDefinition {
  readonly id: string;
  readonly category: "market" | "health" | "cash";
  readonly scope: "public" | "personal";
  readonly sourceIndex: number;
  readonly message: string;
}

export const BASE_EVENT_CATALOG: readonly BaseEventDefinition[] = Object.freeze([
  ...MARKET_EVENTS.map((event, index) => Object.freeze({
    id: `market-${String(index + 1).padStart(2, "0")}`,
    category: "market" as const,
    scope: event.plus > 0 || event.minus > 0 ? "public" as const : "personal" as const,
    sourceIndex: index,
    message: event.msg,
  })),
  ...HEALTH_EVENTS.map((event, index) => Object.freeze({
    id: `health-${String(index + 1).padStart(2, "0")}`,
    category: "health" as const,
    scope: "personal" as const,
    sourceIndex: index,
    message: event.msg,
  })),
  ...STEAL_EVENTS.map((event, index) => Object.freeze({
    id: `cash-${String(index + 1).padStart(2, "0")}`,
    category: "cash" as const,
    scope: "personal" as const,
    sourceIndex: index,
    message: event.msg,
  })),
]);

export function marketEventCatalogId(index: number): string {
  return `market-${String(index + 1).padStart(2, "0")}`;
}

export function healthEventCatalogId(index: number): string {
  return `health-${String(index + 1).padStart(2, "0")}`;
}

export function cashEventCatalogId(index: number): string {
  return `cash-${String(index + 1).padStart(2, "0")}`;
}

