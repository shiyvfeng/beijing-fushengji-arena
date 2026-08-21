import {
  BANK_INTEREST_RATE,
  DEBT_INTEREST_RATE,
  DRUG_COUNT,
  TOTAL_DAYS,
} from "../game-data.js";
import type { ScenarioConfig } from "./contracts.js";
import { deepFreeze } from "./stable-value.js";

const DEFAULT_DISCOUNTS = [1, 0.82, 1, 0.75, 0.78, 0.95, 0.92, 0.95] as const;

export const DEFAULT_SCENARIO: ScenarioConfig = deepFreeze({
  id: "beijing-standard-v1",
  totalDays: TOTAL_DAYS,
  liquidityDiscounts: [...DEFAULT_DISCOUNTS],
  debtInterestRate: DEBT_INTEREST_RATE,
  bankInterestRate: BANK_INTEREST_RATE,
});

export function validateScenario(scenario: ScenarioConfig): void {
  if (!scenario.id.trim()) throw new Error("scenario.id must not be empty");
  if (!Number.isSafeInteger(scenario.totalDays) || scenario.totalDays <= 0) {
    throw new Error("scenario.totalDays must be a positive safe integer");
  }
  if (scenario.liquidityDiscounts.length !== DRUG_COUNT) {
    throw new Error(`scenario.liquidityDiscounts must contain ${DRUG_COUNT} entries`);
  }
  for (const discount of scenario.liquidityDiscounts) {
    if (!Number.isFinite(discount) || discount <= 0 || discount > 1) {
      throw new Error("liquidity discounts must be in the interval (0, 1]");
    }
  }
  for (const rate of [scenario.debtInterestRate, scenario.bankInterestRate]) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new Error("interest rates must be in the interval [0, 1]");
    }
  }
}

