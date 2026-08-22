import type { GameAction } from "../../core/contracts.js";
import { findPotentialSecrets } from "../../core/secret-scan.js";
import type { DirectModelDecisionInput, ProviderTokenUsage } from "../agent-driver.js";
import { DirectProviderRequestError } from "../agent-driver.js";
import { DirectGameActionContractError, parseDirectGameAction } from "../direct-driver.js";
import {
  DailyPlanSelectionContractError,
  parseDailyPlanSelectionAgainstIds,
} from "../completion-assisted.js";
import {
  buildBoundedHistoryUserContext,
  DIRECT_SYSTEM_INSTRUCTION,
  serializeBoundedHistoryUserContext,
} from "../direct-context.js";

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

export async function classifyHttpFailure(
  response: Response,
): Promise<{
  readonly code: "http_error" | "context_limit";
  readonly retryDisposition: "transient" | "non_retryable";
}> {
  let text = "";
  try {
    text = (await response.clone().text()).slice(0, 32_768).toLowerCase();
  } catch {
    return {
      code: "http_error",
      retryDisposition: response.status === 408
        || response.status === 429
        || response.status >= 500
        ? "transient"
        : "non_retryable",
    };
  }
  if (/context[_ -]?length|context window|maximum context|too many tokens|prompt is too long/u.test(text)) {
    return { code: "context_limit", retryDisposition: "non_retryable" };
  }
  const quotaExhausted = /insufficient[_ -]?quota|quota[^\n]{0,80}(exhaust|exceed)|billing[^\n]{0,80}(limit|inactive)|credit[^\n]{0,80}(exhaust|insufficient)|insufficient[^\n]{0,40}(balance|credit)|余额不足|额度不足/u.test(text);
  return {
    code: "http_error",
    retryDisposition: quotaExhausted
      ? "non_retryable"
      : response.status === 408 || response.status === 429 || response.status >= 500
        ? "transient"
        : "non_retryable",
  };
}

export function extractResponseModelRevision(
  payload: Record<string, unknown>,
): string | undefined {
  for (const field of ["model_revision", "revision", "model"] as const) {
    const value = payload[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function buildArenaSystemInstruction(input: DirectModelDecisionInput): string {
  return input.systemInstruction ?? DIRECT_SYSTEM_INSTRUCTION;
}

export function buildArenaUserContext(input: DirectModelDecisionInput): string {
  return input.userContext ?? serializeBoundedHistoryUserContext(buildBoundedHistoryUserContext(
    input.actionIndex,
    input.attemptIndex ?? 0,
    input.observation,
    input.history ?? [],
    input.retryFeedback,
  ));
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

export interface ProviderResponseFacts {
  readonly responseModelRevision?: string;
  readonly tokenUsage?: ProviderTokenUsage;
}

export function parseStrictJsonAction(
  text: string,
  input: DirectModelDecisionInput,
  providerId: string,
  responseFacts: ProviderResponseFacts = {},
): GameAction {
  const decision = parseStrictJsonDecision(text, input, providerId, responseFacts);
  if (!decision || typeof decision !== "object" || !("type" in decision)) {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_action",
      `${providerId} 返回了非 GameAction 决策`,
    );
  }
  return decision as GameAction;
}

export function parseStrictJsonDecision(
  text: string,
  input: DirectModelDecisionInput,
  providerId: string,
  responseFacts: ProviderResponseFacts = {},
): unknown {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text.trim()) as unknown;
  } catch {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} 返回的 Arena 动作无法解析`,
      undefined,
      { ...responseFacts, actionRepairCode: "invalid_json" },
    );
  }

  if (input.decisionContract?.kind === "daily-plan") {
    try {
      return parseDailyPlanSelectionAgainstIds(
        candidate,
        input.decisionContract.planIds,
        input.decisionContract.destinationIds,
      );
    } catch (error: unknown) {
      const contractError = error instanceof DailyPlanSelectionContractError ? error : undefined;
      throw new DirectProviderRequestError(
        providerId,
        "invalid_action",
        `${providerId} 返回的 Daily Plan 选择不符合 Arena 契约`,
        undefined,
        {
          ...responseFacts,
          actionRepairCode: contractError?.repairCode ?? "plan_fields_invalid",
          rejectedAction: contractError?.rejectedSelection ?? candidate,
        },
      );
    }
  }

  let action: GameAction;
  try {
    action = parseDirectGameAction(candidate);
  } catch (error: unknown) {
    const contractError = error instanceof DirectGameActionContractError ? error : undefined;
    throw new DirectProviderRequestError(
      providerId,
      "invalid_action",
      `${providerId} 返回的动作不符合 Arena 契约`,
      undefined,
      {
        ...responseFacts,
        actionRepairCode: contractError?.repairCode ?? "action_fields_invalid",
        rejectedAction: contractError?.rejectedAction ?? candidate,
      },
    );
  }
  if (!input.observation.allowedActions.includes(action.type)) {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_action",
      `${providerId} 返回了当前不可用的 Arena 动作`,
      undefined,
      {
        ...responseFacts,
        actionRepairCode: "action_not_allowed",
        rejectedAction: action,
      },
    );
  }
  return action;
}
