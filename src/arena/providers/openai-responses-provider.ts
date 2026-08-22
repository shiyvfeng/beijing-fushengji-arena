import type { GameAction, ProviderReasoningEffort } from "../../core/contracts.js";
import type {
  DirectModelDecisionInput,
  DirectModelProviderAdapter,
  SamplingAudit,
} from "../agent-driver.js";
import type { RawExchangeRecorder } from "../diagnostics.js";
import {
  buildArenaSystemInstruction,
  buildArenaUserContext,
  classifyHttpFailure,
  DirectProviderRequestError,
  extractResponseModelRevision,
  normalizeProviderTokenUsage,
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

function parseActionEnvelope(value: unknown): GameAction | null {
  if (!isRecord(value) || !hasExactFields(value) || typeof value.type !== "string") {
    return null;
  }
  switch (value.type) {
    case "move":
      return isNonNegativeSafeInteger(value.locationId)
        && unusedFieldsAreNull(value, ["locationId"])
        ? Object.freeze({ type: "move", locationId: value.locationId })
        : null;
    case "buy":
    case "sell":
      return isNonNegativeSafeInteger(value.itemId)
        && isPositiveSafeInteger(value.quantity)
        && unusedFieldsAreNull(value, ["itemId", "quantity"])
        ? Object.freeze({
          type: value.type,
          itemId: value.itemId,
          quantity: value.quantity,
        })
        : null;
    case "deposit":
    case "withdraw":
    case "repay_debt":
      return isPositiveSafeInteger(value.amount)
        && unusedFieldsAreNull(value, ["amount"])
        ? Object.freeze({ type: value.type, amount: value.amount })
        : null;
    case "heal":
      return isPositiveSafeInteger(value.points)
        && unusedFieldsAreNull(value, ["points"])
        ? Object.freeze({ type: "heal", points: value.points })
        : null;
    case "expand_capacity":
      return unusedFieldsAreNull(value, [])
        ? Object.freeze({ type: "expand_capacity" })
        : null;
    default:
      return null;
  }
}

function collectOutputText(
  payload: Record<string, unknown>,
  responseModelRevision?: string,
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
          { responseModelRevision },
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
        name: "arena_game_action",
        strict: true,
        schema: OPENAI_GAME_ACTION_JSON_SCHEMA,
      },
    },
    ...(reasoningEffort === "default"
      ? {}
      : { reasoning: { effort: reasoningEffort } }),
  };
}

export class OpenAIResponsesProvider implements DirectModelProviderAdapter {
  readonly providerId = "openai";
  readonly adapterVersion = "openai-responses-v3";
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
      const code = await classifyHttpFailure(response);
      throw new DirectProviderRequestError(
        this.providerId,
        code,
        `OpenAI Responses API 返回 HTTP ${response.status}`,
        response.status,
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
    if (payload.status === "incomplete") {
      throw new DirectProviderRequestError(
        this.providerId,
        "incomplete",
        "OpenAI Responses API 未完成 Arena 动作生成",
        undefined,
        { responseModelRevision },
      );
    }
    if (payload.status !== "completed") {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        "OpenAI Responses API 返回状态不合法",
        undefined,
        { responseModelRevision },
      );
    }

    const outputText = collectOutputText(payload, responseModelRevision);
    if (outputText === null) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        "OpenAI Responses API 未返回结构化动作",
        undefined,
        { responseModelRevision },
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
        { responseModelRevision },
      );
    }
    const action = parseActionEnvelope(envelope);
    if (!action || !input.observation.allowedActions.includes(action.type)) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_action",
        "OpenAI Responses API 返回的动作不符合 Arena 契约",
        undefined,
        { responseModelRevision },
      );
    }
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
    return Object.freeze({
      action,
      ...(usage ? { usage } : {}),
      ...(responseModelRevision ? { responseModelRevision } : {}),
    });
  }
}
