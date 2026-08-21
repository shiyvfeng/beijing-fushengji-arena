import type { DirectModelProviderAdapter, DirectModelDecisionInput } from "../agent-driver.js";
import {
  buildArenaSystemInstruction,
  buildArenaUserContext,
  DirectProviderRequestError,
  isProviderRecord,
  normalizeProviderTokenUsage,
  parseStrictJsonAction,
  requireProviderValue,
  resolveProviderEndpoint,
  validateMaxOutputTokens,
  validateProviderApiKey,
} from "./provider-utils.js";

const DEFAULT_MAX_OUTPUT_TOKENS = 512;
const ANTHROPIC_API_VERSION = "2023-06-01";

export interface AnthropicMessagesProviderOptions {
  readonly providerId?: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly maxOutputTokens?: number;
  readonly fetchImpl?: typeof globalThis.fetch;
}

function collectAnthropicText(payload: Record<string, unknown>, providerId: string): string {
  if (payload.type !== "message" || !Array.isArray(payload.content)) {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} Messages API 返回结构不合法`,
    );
  }
  if (payload.stop_reason === "max_tokens") {
    throw new DirectProviderRequestError(
      providerId,
      "incomplete",
      `${providerId} Messages API 未完成 Arena 动作生成`,
    );
  }
  if (payload.stop_reason === "refusal") {
    throw new DirectProviderRequestError(
      providerId,
      "refusal",
      `${providerId} Messages API 拒绝生成 Arena 动作`,
    );
  }
  const chunks: string[] = [];
  for (const content of payload.content) {
    if (!isProviderRecord(content)) continue;
    if (content.type === "text" && typeof content.text === "string") {
      chunks.push(content.text);
    }
  }
  if (chunks.length < 1) {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} Messages API 未返回文本动作`,
    );
  }
  return chunks.join("");
}

export class AnthropicMessagesProvider implements DirectModelProviderAdapter {
  readonly providerId: string;
  readonly adapterVersion = "anthropic-messages-v2";
  readonly modelId: string;
  readonly maxOutputTokens: number;

  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: AnthropicMessagesProviderOptions) {
    this.providerId = requireProviderValue(options.providerId ?? "anthropic", "providerId");
    this.#apiKey = validateProviderApiKey(options.apiKey, this.providerId);
    this.modelId = requireProviderValue(options.model, `${this.providerId} model`);
    this.#endpoint = resolveProviderEndpoint(options.baseUrl, "messages", this.providerId);
    this.maxOutputTokens = validateMaxOutputTokens(
      options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      this.providerId,
    );
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") {
      throw new Error("当前运行时不支持 fetch，请升级到 Node.js 22 或显式注入 fetchImpl");
    }
  }

  async requestDecision(input: DirectModelDecisionInput) {
    const body = {
      model: this.modelId,
      max_tokens: this.maxOutputTokens,
      system: buildArenaSystemInstruction(input),
      messages: [{ role: "user", content: buildArenaUserContext(input) }],
      stream: false,
    };

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          "x-api-key": this.#apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: input.signal,
        redirect: "error",
      });
    } catch {
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : new Error("Provider 请求已取消");
      }
      throw new DirectProviderRequestError(
        this.providerId,
        "transport_error",
        `${this.providerId} Messages API 请求失败`,
      );
    }

    if (!response.ok) {
      throw new DirectProviderRequestError(
        this.providerId,
        "http_error",
        `${this.providerId} Messages API 返回 HTTP ${response.status}`,
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
        `${this.providerId} Messages API 返回的 JSON 无法解析`,
      );
    }
    if (!isProviderRecord(payload)) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        `${this.providerId} Messages API 返回结构不合法`,
      );
    }
    const action = parseStrictJsonAction(
      collectAnthropicText(payload, this.providerId),
      input,
      this.providerId,
    );
    const usage = isProviderRecord(payload.usage)
      ? normalizeProviderTokenUsage(
          payload.usage.input_tokens,
          payload.usage.output_tokens,
        )
      : undefined;
    return Object.freeze({ action, ...(usage ? { usage } : {}) });
  }
}
