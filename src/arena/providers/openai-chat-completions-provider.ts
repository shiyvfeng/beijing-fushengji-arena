import type { DirectModelProviderAdapter, DirectModelDecisionInput, SamplingAudit } from "../agent-driver.js";
import type { ProviderThinkingMode } from "../../core/contracts.js";
import type { RawExchangeRecorder } from "../diagnostics.js";
import {
  buildArenaSystemInstruction,
  buildArenaUserContext,
  classifyHttpFailure,
  DirectProviderRequestError,
  isProviderRecord,
  extractResponseModelRevision,
  normalizeProviderTokenUsage,
  parseStrictJsonAction,
  requireProviderValue,
  resolveProviderEndpoint,
  validateMaxOutputTokens,
  validateProviderApiKey,
} from "./provider-utils.js";

const DEFAULT_MAX_OUTPUT_TOKENS = 512;

export interface OpenAIChatCompletionsProviderOptions {
  readonly providerId: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  /** Enable the broadly supported `{type: "json_object"}` JSON mode. */
  readonly useJsonMode?: boolean;
  readonly maxOutputTokens?: number;
  /** DeepSeek thinking control. `default` omits the provider-specific request field. */
  readonly thinkingMode?: ProviderThinkingMode;
  readonly declaredModelRevision?: string;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly exchangeRecorder?: RawExchangeRecorder;
}

function validateThinkingMode(value: ProviderThinkingMode | undefined): ProviderThinkingMode {
  const normalized = value ?? "default";
  if (normalized !== "default" && normalized !== "disabled" && normalized !== "enabled") {
    throw new Error("thinkingMode 仅支持 default、disabled 或 enabled");
  }
  return normalized;
}

function collectMessageText(
  payload: Record<string, unknown>,
  providerId: string,
  responseModelRevision?: string,
): string {
  const revision = { responseModelRevision };
  if (!Array.isArray(payload.choices) || payload.choices.length < 1) {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} Chat Completions 返回结构不合法`,
      undefined,
      revision,
    );
  }
  const choice = payload.choices[0];
  if (!isProviderRecord(choice)) {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} Chat Completions 返回结构不合法`,
      undefined,
      revision,
    );
  }
  if (choice.finish_reason === "length") {
    throw new DirectProviderRequestError(
      providerId,
      "incomplete",
      `${providerId} Chat Completions 未完成 Arena 动作生成`,
      undefined,
      revision,
    );
  }
  if (choice.finish_reason === "content_filter" || choice.finish_reason === "refusal") {
    throw new DirectProviderRequestError(
      providerId,
      "refusal",
      `${providerId} Chat Completions 拒绝生成 Arena 动作`,
      undefined,
      revision,
    );
  }
  if (!isProviderRecord(choice.message)) {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} Chat Completions 未返回文本动作`,
      undefined,
      revision,
    );
  }
  if (typeof choice.message.refusal === "string" && choice.message.refusal.trim()) {
    throw new DirectProviderRequestError(
      providerId,
      "refusal",
      `${providerId} Chat Completions 拒绝生成 Arena 动作`,
      undefined,
      revision,
    );
  }
  if (typeof choice.message.content !== "string") {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} Chat Completions 未返回文本动作`,
      undefined,
      revision,
    );
  }
  return choice.message.content;
}

export class OpenAIChatCompletionsProvider implements DirectModelProviderAdapter {
  readonly providerId: string;
  readonly adapterVersion = "openai-chat-completions-v3";
  readonly modelId: string;
  readonly maxOutputTokens: number;
  readonly thinkingMode: ProviderThinkingMode;
  readonly declaredModelRevision?: string;
  readonly samplingAudit: SamplingAudit;

  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #useJsonMode: boolean;
  readonly #exchangeRecorder?: RawExchangeRecorder;

  constructor(options: OpenAIChatCompletionsProviderOptions) {
    this.providerId = requireProviderValue(options.providerId, "providerId");
    this.#apiKey = validateProviderApiKey(options.apiKey, this.providerId);
    this.modelId = requireProviderValue(options.model, `${this.providerId} model`);
    this.#endpoint = resolveProviderEndpoint(
      options.baseUrl,
      "chat/completions",
      this.providerId,
    );
    this.maxOutputTokens = validateMaxOutputTokens(
      options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      this.providerId,
    );
    this.thinkingMode = validateThinkingMode(options.thinkingMode);
    if (options.declaredModelRevision?.trim()) {
      this.declaredModelRevision = options.declaredModelRevision.trim();
    }
    this.#useJsonMode = options.useJsonMode === true;
    this.samplingAudit = Object.freeze({
      policyVersion: "provider-default-audited-v1",
      temperature: "omitted",
      topP: "omitted",
      maxOutputTokens: this.maxOutputTokens,
      jsonMode: this.#useJsonMode ? "json-object" : "none",
      thinking: Object.freeze({
        mode: this.thinkingMode,
        sent: this.thinkingMode !== "default",
      }),
    });
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#exchangeRecorder = options.exchangeRecorder;
    if (typeof this.#fetch !== "function") {
      throw new Error("当前运行时不支持 fetch，请升级到 Node.js 22 或显式注入 fetchImpl");
    }
  }

  async requestDecision(input: DirectModelDecisionInput) {
    const body = {
      model: this.modelId,
      messages: [
        { role: "system", content: buildArenaSystemInstruction(input) },
        { role: "user", content: buildArenaUserContext(input) },
      ],
      max_tokens: this.maxOutputTokens,
      stream: false,
      ...(this.thinkingMode === "default"
        ? {}
        : { thinking: { type: this.thinkingMode } }),
      ...(this.#useJsonMode ? { response_format: { type: "json_object" } } : {}),
    };

    const requestHeaders = {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
    };
    const requestBody = JSON.stringify(body);
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
        `${this.providerId} Chat Completions 请求失败`,
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
        `${this.providerId} Chat Completions 返回 HTTP ${response.status}`,
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
        `${this.providerId} Chat Completions 返回的 JSON 无法解析`,
      );
    }
    if (!isProviderRecord(payload)) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        `${this.providerId} Chat Completions 返回结构不合法`,
      );
    }
    const responseModelRevision = extractResponseModelRevision(payload);
    const action = parseStrictJsonAction(
      collectMessageText(payload, this.providerId, responseModelRevision),
      input,
      this.providerId,
      responseModelRevision,
    );
    if (payload.usage !== undefined && !isProviderRecord(payload.usage)) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        `${this.providerId} Chat Completions usage 协议不合法`,
        undefined,
        { responseModelRevision },
      );
    }
    const usage = isProviderRecord(payload.usage)
      ? normalizeProviderTokenUsage(
          payload.usage.prompt_tokens,
          payload.usage.completion_tokens,
          payload.usage.total_tokens,
        )
      : undefined;
    if (isProviderRecord(payload.usage) && !usage) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        `${this.providerId} Chat Completions usage 协议不合法`,
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
