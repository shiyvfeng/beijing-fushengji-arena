import type { GameAction } from "../../core/contracts.js";
import { findPotentialSecrets } from "../../core/secret-scan.js";
import type { DirectModelDecisionInput, ProviderTokenUsage } from "../agent-driver.js";
import { DirectProviderRequestError } from "../agent-driver.js";
import {
  DIRECT_DECISION_POLICY_TEXT,
  parseDirectGameAction,
} from "../direct-driver.js";

export { DirectProviderRequestError } from "../agent-driver.js";

export function requireProviderValue(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} 不能为空`);
  if (/[\r\n\0]/u.test(normalized)) throw new Error(`${name} 格式不合法`);
  return normalized;
}

export function validateProviderApiKey(value: string, providerId: string): string {
  return requireProviderValue(value, `${providerId} apiKey`);
}

export function validateProviderBaseUrl(value: string, providerId: string): string {
  let url: URL;
  try {
    url = new URL(requireProviderValue(value, `${providerId} baseUrl`));
  } catch {
    throw new Error(`${providerId} baseUrl 不是合法 URL`);
  }
  if (url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new Error(`${providerId} baseUrl 必须是无凭据、查询参数和片段的 HTTPS URL`);
  }
  const normalized = url.toString().replace(/\/+$/u, "");
  if (findPotentialSecrets({ value: normalized }).length > 0) {
    throw new Error(`${providerId} baseUrl 疑似包含凭据，已拒绝`);
  }
  return normalized;
}

export function resolveProviderEndpoint(
  baseUrl: string,
  resourcePath: string,
  providerId: string,
): string {
  const normalizedBase = validateProviderBaseUrl(baseUrl, providerId);
  const resource = requireProviderValue(resourcePath, "resourcePath").replace(/^\/+|\/+$/gu, "");
  const url = new URL(normalizedBase);
  const basePath = url.pathname.replace(/\/+$/u, "");
  const suffix = `/${resource}`;
  if (!basePath.endsWith(suffix)) url.pathname = `${basePath}${suffix}`;
  return url.toString();
}

export function validateMaxOutputTokens(value: number, providerId: string): number {
  if (!Number.isSafeInteger(value) || value < 16 || value > 4_096) {
    throw new Error(`${providerId} maxOutputTokens 必须为 16..4096 的安全整数`);
  }
  return value;
}

export function isProviderRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function compactRecentResults(input: DirectModelDecisionInput): readonly unknown[] {
  return input.recentResults;
}

export function buildArenaSystemInstruction(input: DirectModelDecisionInput): string {
  return [
    "You are playing one isolated episode of Beijing Floating Life Arena.",
    DIRECT_DECISION_POLICY_TEXT,
    "Choose exactly one action allowed by the observation without inventing state.",
    "You must reach the final day within the action budget; only move advances the day and applies interest and events.",
    "After the final day, inventory is liquidated once at publicReferencePrice times each item's liquidityDiscount; final net worth is cash plus bank minus debt after liquidation.",
    "If currentLocation is null, move first. Never move to the current location, and treat localPrice 0 as unavailable.",
    "Use only locationId/itemId values present in the observation and positive integer quantities, amounts or points.",
    `Allowed action types for this decision: ${input.observation.allowedActions.join(", ")}.`,
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
}

export function buildArenaUserContext(input: DirectModelDecisionInput): string {
  return JSON.stringify({
    actionIndex: input.actionIndex,
    observation: input.observation,
    recentResults: compactRecentResults(input),
  });
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function normalizeProviderTokenUsage(
  inputTokensValue: unknown,
  outputTokensValue: unknown,
  totalTokensValue?: unknown,
): ProviderTokenUsage | undefined {
  const inputTokens = nonNegativeInteger(inputTokensValue);
  const outputTokens = nonNegativeInteger(outputTokensValue);
  if (inputTokens === null || outputTokens === null) return undefined;
  const reportedTotal = nonNegativeInteger(totalTokensValue);
  const totalTokens = reportedTotal ?? inputTokens + outputTokens;
  if (totalTokens < inputTokens + outputTokens) return undefined;
  return Object.freeze({ inputTokens, outputTokens, totalTokens });
}

export function parseStrictJsonAction(
  text: string,
  input: DirectModelDecisionInput,
  providerId: string,
): GameAction {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text.trim()) as unknown;
  } catch {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} 返回的 Arena 动作无法解析`,
    );
  }

  let action: GameAction;
  try {
    action = parseDirectGameAction(candidate);
  } catch {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} 返回的动作不符合 Arena 契约`,
    );
  }
  if (!input.observation.allowedActions.includes(action.type)) {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} 返回了当前不可用的 Arena 动作`,
    );
  }
  return action;
}
