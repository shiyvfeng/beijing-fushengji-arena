import type { DirectModelProviderAdapter, DirectModelDecisionInput, SamplingAudit } from "../agent-driver.js";
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
const ANTHROPIC_API_VERSION = "2023-06-01";

export interface AnthropicMessagesProviderOptions {
  readonly providerId?: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly maxOutputTokens?: number;
  readonly declaredModelRevision?: string;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly exchangeRecorder?: RawExchangeRecorder;
}

function collectAnthropicText(
  payload: Record<string, unknown>,
  providerId: string,
  responseModelRevision?: string,
): string {
  const revision = { responseModelRevision };
  if (payload.type !== "message" || !Array.isArray(payload.content)) {
    throw new DirectProviderRequestError(
      providerId,
      "invalid_response",
      `${providerId} Messages API 返回结构不合法`,
      undefined,
      revision,
    );
  }
  if (payload.stop_reason === "max_tokens") {
    throw new DirectProviderRequestError(
      providerId,
      "incomplete",
      `${providerId} Messages API 未完成 Arena 动作生成`,
      undefined,
      revision,
    );
  }
  if (payload.stop_reason === "refusal") {
    throw new DirectProviderRequestError(
      providerId,
      "refusal",
      `${providerId} Messages API 拒绝生成 Arena 动作`,
      undefined,
      revision,
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
      undefined,
      revision,
    );
  }
  return chunks.join("");
}

export class AnthropicMessagesProvider implements DirectModelProviderAdapter {
  readonly providerId: string;
  readonly adapterVersion = "anthropic-messages-v2";
  readonly modelId: string;
  readonly maxOutputTokens: number;
  readonly declaredModelRevision?: string;
  readonly samplingAudit: SamplingAudit;

  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #exchangeRecorder?: RawExchangeRecorder;

  constructor(options: AnthropicMessagesProviderOptions) {
    this.providerId = requireProviderValue(options.providerId ?? "anthropic", "providerId");
    this.#apiKey = validateProviderApiKey(options.apiKey, this.providerId);
    this.modelId = requireProviderValue(options.model, `${this.providerId} model`);
    this.#endpoint = resolveProviderEndpoint(options.baseUrl, "messages", this.providerId);
    this.maxOutputTokens = validateMaxOutputTokens(
      options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      this.providerId,
    );
    if (options.declaredModelRevision?.trim()) {
      this.declaredModelRevision = options.declaredModelRevision.trim();
    }
    this.samplingAudit = Object.freeze({
      policyVersion: "provider-default-audited-v1",
      temperature: "omitted",
      topP: "omitted",
      maxOutputTokens: this.maxOutputTokens,
      jsonMode: "none",
      thinking: Object.freeze({ mode: "default", sent: false }),
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
      max_tokens: this.maxOutputTokens,
      system: buildArenaSystemInstruction(input),
      messages: [{ role: "user", content: buildArenaUserContext(input) }],
      stream: false,
    };

    const requestHeaders = {
      "x-api-key": this.#apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
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
        `${this.providerId} Messages API 请求失败`,
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
    const responseModelRevision = extractResponseModelRevision(payload);
    const action = parseStrictJsonAction(
      collectAnthropicText(payload, this.providerId, responseModelRevision),
      input,
      this.providerId,
      responseModelRevision,
    );
    if (payload.usage !== undefined && !isProviderRecord(payload.usage)) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        `${this.providerId} Messages API usage 协议不合法`,
        undefined,
        { responseModelRevision },
      );
    }
    const usage = isProviderRecord(payload.usage)
      ? normalizeProviderTokenUsage(
          payload.usage.input_tokens,
          payload.usage.output_tokens,
        )
      : undefined;
    if (isProviderRecord(payload.usage) && !usage) {
      throw new DirectProviderRequestError(
        this.providerId,
        "invalid_response",
        `${this.providerId} Messages API usage 协议不合法`,
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
