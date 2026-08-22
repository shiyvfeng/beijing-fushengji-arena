import type { GameAction, ProviderReasoningEffort } from "../../core/contracts.js";
import type {
  DirectActionRepairCode,
  DirectModelDecisionInput,
  DirectModelProviderAdapter,
  SamplingAudit,
} from "../agent-driver.js";
import { sanitizeRejectedAction } from "../agent-driver.js";
import { DirectGameActionContractError } from "../direct-driver.js";
import {
  DailyPlanSelectionContractError,
  parseDailyPlanSelectionAgainstIds,
} from "../completion-assisted.js";
import type { RawExchangeRecorder } from "../diagnostics.js";
import {
  buildArenaSystemInstruction,
  buildArenaUserContext,
  classifyHttpFailure,
  DirectProviderRequestError,
  extractResponseModelRevision,
  normalizeProviderTokenUsage,
  type ProviderResponseFacts,
} from "./provider-utils.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ORIGIN = "https://api.openai.com";
const DEFAULT_MAX_OUTPUT_TOKENS = 128;

const ACTION_TYPES = [
  "move",
  "buy",
  "sell",
  "deposit",
  "withdraw",
  "repay_debt",
  "heal",
  "expand_capacity",
] as const satisfies readonly GameAction["type"][];

const RESPONSE_FIELDS = [
  "type",
  "locationId",
  "itemId",
  "quantity",
  "amount",
  "points",
] as const;

/**
 * Responses Structured Outputs requires every property to be listed in
 * `required`. Parameters unused by a particular action are represented as
 * null, then removed before the value crosses the provider boundary.
 */
const OPENAI_GAME_ACTION_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: RESPONSE_FIELDS,
  properties: {
    type: {
      type: "string",
      enum: ACTION_TYPES,
      description: "The single game action to execute.",
    },
    locationId: {
      type: ["integer", "null"],
      description: "Required only for move; otherwise null.",
    },
    itemId: {
      type: ["integer", "null"],
      description: "Required only for buy or sell; otherwise null.",
    },
    quantity: {
      type: ["integer", "null"],
      description: "A positive integer for buy or sell; otherwise null.",
    },
    amount: {
      type: ["integer", "null"],
      description: "A positive integer for deposit, withdraw or repay_debt; otherwise null.",
    },
    points: {
      type: ["integer", "null"],
      description: "A positive integer for heal; otherwise null.",
    },
  },
} as const);

export interface OpenAIResponsesProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  /** API base URL; `/responses` is appended. HTTPS only. */
  readonly baseUrl?: string;
  /** Required when intentionally sending credentials to a non-OpenAI origin. */
  readonly allowCustomBaseUrl?: boolean;
  /** Per-decision output ceiling. The action schema normally needs far less. */
  readonly maxOutputTokens?: number;
  readonly reasoningEffort?: ProviderReasoningEffort;
  readonly declaredModelRevision?: string;
  /** Injectable for hermetic tests. Production defaults to Node's global fetch. */
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly exchangeRecorder?: RawExchangeRecorder;
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} 不能为空`);
  return normalized;
}

function resolveEndpoint(baseUrl: string | undefined, allowCustomBaseUrl: boolean): string {
  let url: URL;
  try {
    const normalized = `${(baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/`;
    url = new URL("responses", normalized);
  } catch {
    throw new Error("OpenAI baseUrl 不是合法 URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("OpenAI baseUrl 必须是无凭据、查询参数和片段的 HTTPS URL");
  }
  if (url.origin !== DEFAULT_ORIGIN && !allowCustomBaseUrl) {
    throw new Error("非官方 OpenAI origin 必须显式设置 allowCustomBaseUrl");
  }
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...RESPONSE_FIELDS].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function unusedFieldsAreNull(
  value: Record<string, unknown>,
  usedFields: readonly (typeof RESPONSE_FIELDS)[number][],
): boolean {
  const used = new Set<string>(["type", ...usedFields]);
  return RESPONSE_FIELDS.every(field => used.has(field) || value[field] === null);
}

function rejectEnvelope(
  value: unknown,
  repairCode: DirectActionRepairCode,
): never {
  throw new DirectGameActionContractError(repairCode, sanitizeRejectedAction(value));
}

function parseActionEnvelope(value: unknown): GameAction {
  if (!isRecord(value)) rejectEnvelope(value, "action_must_be_object");
  if (!hasExactFields(value)) rejectEnvelope(value, "action_fields_invalid");
  if (typeof value.type !== "string") rejectEnvelope(value, "action_type_unknown");
  switch (value.type) {
    case "move": {
      if (!isNonNegativeSafeInteger(value.locationId)) {
        rejectEnvelope(value, "location_id_must_be_non_negative_integer");
      }
      if (!unusedFieldsAreNull(value, ["locationId"])) {
        rejectEnvelope(value, "action_fields_invalid");
      }
      return Object.freeze({ type: "move", locationId: value.locationId });
    }
    case "buy":
    case "sell": {
      if (!isNonNegativeSafeInteger(value.itemId)) {
        rejectEnvelope(value, "item_id_must_be_non_negative_integer");
      }
      if (!isPositiveSafeInteger(value.quantity)) {
        rejectEnvelope(value, "quantity_must_be_positive_integer");
      }
      if (!unusedFieldsAreNull(value, ["itemId", "quantity"])) {
        rejectEnvelope(value, "action_fields_invalid");
      }
      return Object.freeze({ type: value.type, itemId: value.itemId, quantity: value.quantity });
    }
    case "deposit":
    case "withdraw":
    case "repay_debt": {
      if (!isPositiveSafeInteger(value.amount)) {
        rejectEnvelope(value, "amount_must_be_positive_integer");
      }
      if (!unusedFieldsAreNull(value, ["amount"])) {
        rejectEnvelope(value, "action_fields_invalid");
      }
      return Object.freeze({ type: value.type, amount: value.amount });
    }
    case "heal": {
      if (!isPositiveSafeInteger(value.points)) {
        rejectEnvelope(value, "points_must_be_positive_integer");
      }
      if (!unusedFieldsAreNull(value, ["points"])) {
        rejectEnvelope(value, "action_fields_invalid");
      }
      return Object.freeze({ type: "heal", points: value.points });
    }
    case "expand_capacity": {
      if (!unusedFieldsAreNull(value, [])) rejectEnvelope(value, "action_fields_invalid");
      return Object.freeze({ type: "expand_capacity" });
    }
    default:
      rejectEnvelope(value, "action_type_unknown");
  }
}

function collectOutputText(
  payload: Record<string, unknown>,
  responseFacts: ProviderResponseFacts,
): string | null {
  if (!Array.isArray(payload.output)) return null;
  const chunks: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if (content.type === "refusal") {
        throw new DirectProviderRequestError(
          "openai",
          "refusal",
          "OpenAI Responses API 拒绝生成 Arena 动作",
          undefined,
          responseFacts,
        );
      }
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.length > 0 ? chunks.join("") : null;
}

function buildRequestBody(
  input: DirectModelDecisionInput,
  model: string,
  maxOutputTokens: number,
  reasoningEffort: ProviderReasoningEffort,
): Readonly<Record<string, unknown>> {
  const dailyPlanContract = input.decisionContract?.kind === "daily-plan"
    ? input.decisionContract
    : undefined;
  const responseSchema = dailyPlanContract
    ? {
      type: "object",
      additionalProperties: false,
      required: ["planId", "destinationId"],
      properties: {
        planId: { type: "string", enum: dailyPlanContract.planIds },
        destinationId: { type: "integer", enum: dailyPlanContract.destinationIds },
      },
    }
    : OPENAI_GAME_ACTION_JSON_SCHEMA;
  return {
    model,
    store: false,
    max_output_tokens: maxOutputTokens,
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: buildArenaSystemInstruction(input) }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: buildArenaUserContext(input),
        }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: dailyPlanContract ? "arena_daily_plan" : "arena_game_action",
        strict: true,
        schema: responseSchema,
      },
    },
    ...(reasoningEffort === "default"
      ? {}
      : { reasoning: { effort: reasoningEffort } }),
  };
}

export class OpenAIResponsesProvider implements DirectModelProviderAdapter {
  readonly providerId = "openai";
  readonly adapterVersion = "openai-responses-v4";
  readonly modelId: string;
  readonly maxOutputTokens: number;
  readonly reasoningEffort: ProviderReasoningEffort;
  readonly declaredModelRevision?: string;
  readonly samplingAudit: SamplingAudit;

  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #exchangeRecorder?: RawExchangeRecorder;

  constructor(options: OpenAIResponsesProviderOptions) {
    const apiKey = requireNonEmpty(options.apiKey, "OpenAI apiKey");
    if (/[\r\n]/.test(apiKey)) throw new Error("OpenAI apiKey 格式不合法");
    this.#apiKey = apiKey;
    this.modelId = requireNonEmpty(options.model, "OpenAI model");
    this.#endpoint = resolveEndpoint(options.baseUrl, options.allowCustomBaseUrl === true);
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    if (!Number.isSafeInteger(this.maxOutputTokens)
      || this.maxOutputTokens < 16
      || this.maxOutputTokens > 4_096) {
      throw new Error("OpenAI maxOutputTokens 必须为 16..4096 的安全整数");
    }
    this.reasoningEffort = options.reasoningEffort ?? "default";
    if (!["default", "none", "low", "medium", "high", "xhigh", "max"].includes(this.reasoningEffort)) {
      throw new Error("OpenAI reasoningEffort 配置无效");
    }
    if (options.declaredModelRevision?.trim()) {
      this.declaredModelRevision = options.declaredModelRevision.trim();
    }
    this.samplingAudit = Object.freeze({
      policyVersion: "provider-explicit-effort-audited-v2",
      temperature: "omitted",
      topP: "omitted",
      maxOutputTokens: this.maxOutputTokens,
      jsonMode: "json-schema",
      thinking: Object.freeze({ mode: "default", sent: false }),
      reasoningEffort: Object.freeze({
        level: this.reasoningEffort,
        sent: this.reasoningEffort !== "default",
      }),
    });
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#exchangeRecorder = options.exchangeRecorder;
    if (typeof this.#fetch !== "function") {
      throw new Error("当前运行时不支持 fetch，请升级到 Node.js 22 或显式注入 fetchImpl");
    }
  }

  async requestDecision(input: DirectModelDecisionInput) {
    const requestHeaders = {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
    };
    const requestBody = JSON.stringify(buildRequestBody(
      input,
      this.modelId,
      this.maxOutputTokens,
      this.reasoningEffort,
    ));
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: requestHeaders,
        body: requestBody,
        signal: input.signal,
        redirect: "error",
      });
    } catch {
      this.#exchangeRecorder?.capture({
        modelCallId: input.modelCallId,
        provider: this.providerId,
        endpoint: this.#endpoint,
        request: { method: "POST", headers: requestHeaders, body: requestBody },
        transportError: true,
      });
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : new Error("Provider 请求已取消");
      }
      throw new DirectProviderRequestError(
        this.providerId,
        "transport_error",
        "OpenAI Responses API 请求失败",
      );
    }
    this.#exchangeRecorder?.capture({
      modelCallId: input.modelCallId,
      provider: this.providerId,
      endpoint: this.#endpoint,
      request: { method: "POST", headers: requestHeaders, body: requestBody },
      response: response.clone(),
    });

    if (!response.ok) {
      const classification = await classifyHttpFailure(response);
      throw new DirectProviderRequestError(
        this.providerId,
        classification.code,
        `OpenAI Responses API 返回 HTTP ${response.status}`,
        response.status,
        { retryDisposition: classification.retryDisposition },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        "OpenAI Responses API 返回的 JSON 无法解析",
      );
    }
    if (!isRecord(payload)) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        "OpenAI Responses API 返回结构不合法",
      );
    }
    const responseModelRevision = extractResponseModelRevision(payload);
    if (payload.usage !== undefined && !isRecord(payload.usage)) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        "OpenAI Responses API usage 协议不合法",
        undefined,
        { responseModelRevision },
      );
    }
    const usage = isRecord(payload.usage)
      ? normalizeProviderTokenUsage(
          payload.usage.input_tokens,
          payload.usage.output_tokens,
          payload.usage.total_tokens,
        )
      : undefined;
    if (isRecord(payload.usage) && !usage) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        "OpenAI Responses API usage 协议不合法",
        undefined,
        { responseModelRevision },
      );
    }
    const responseFacts = Object.freeze({
      ...(responseModelRevision ? { responseModelRevision } : {}),
      ...(usage ? { tokenUsage: usage } : {}),
    });
    if (payload.status === "incomplete") {
      throw new DirectProviderRequestError(
        this.providerId,
        "incomplete",
        "OpenAI Responses API 未完成 Arena 动作生成",
        undefined,
        responseFacts,
      );
    }
    if (payload.status !== "completed") {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        "OpenAI Responses API 返回状态不合法",
        undefined,
        responseFacts,
      );
    }

    const outputText = collectOutputText(payload, responseFacts);
    if (outputText === null) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        "OpenAI Responses API 未返回结构化动作",
        undefined,
        responseFacts,
      );
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(outputText) as unknown;
    } catch {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        "OpenAI Responses API 返回的动作无法解析",
        undefined,
        { ...responseFacts, actionRepairCode: "invalid_json" },
      );
    }
    let action: unknown;
    if (input.decisionContract?.kind === "daily-plan") {
      try {
        action = parseDailyPlanSelectionAgainstIds(
          envelope,
          input.decisionContract.planIds,
          input.decisionContract.destinationIds,
        );
      } catch (error: unknown) {
        const contractError = error instanceof DailyPlanSelectionContractError ? error : undefined;
        throw new DirectProviderRequestError(
          this.providerId,
          "invalid_action",
          "OpenAI Responses API 返回的 Daily Plan 选择不符合 Arena 契约",
          undefined,
          {
            ...responseFacts,
            actionRepairCode: contractError?.repairCode ?? "plan_fields_invalid",
            rejectedAction: contractError?.rejectedSelection ?? envelope,
          },
        );
      }
      return Object.freeze({
        action,
        ...(usage ? { usage } : {}),
        ...(responseModelRevision ? { responseModelRevision } : {}),
      });
    }
    try {
      action = parseActionEnvelope(envelope);
    } catch (error: unknown) {
      const contractError = error instanceof DirectGameActionContractError ? error : undefined;
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_action",
        "OpenAI Responses API 返回的动作不符合 Arena 契约",
        undefined,
        {
          ...responseFacts,
          actionRepairCode: contractError?.repairCode ?? "action_fields_invalid",
          rejectedAction: contractError?.rejectedAction ?? envelope,
        },
      );
    }
    if (!input.observation.allowedActions.includes((action as GameAction).type)) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_action",
        "OpenAI Responses API 返回了当前不可用的 Arena 动作",
        undefined,
        {
          ...responseFacts,
          actionRepairCode: "action_not_allowed",
          rejectedAction: action,
        },
      );
    }
    return Object.freeze({
      action,
      ...(usage ? { usage } : {}),
      ...(responseModelRevision ? { responseModelRevision } : {}),
    });
  }
}
