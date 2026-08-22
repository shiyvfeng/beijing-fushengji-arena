import type { DirectModelProviderAdapter } from "../agent-driver.js";
import type {
  ProviderReasoningEffort,
  ProviderThinkingMode,
} from "../../core/contracts.js";
import type { RawExchangeRecorder } from "../diagnostics.js";
import { AnthropicMessagesProvider } from "./anthropic-messages-provider.js";
import { OpenAIChatCompletionsProvider } from "./openai-chat-completions-provider.js";
import { OpenAIResponsesProvider } from "./openai-responses-provider.js";
import {
  requireProviderValue,
  validateProviderBaseUrl,
} from "./provider-utils.js";

export type ArenaProviderId =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "openai-compatible";

export interface ArenaAgentProviderConfig {
  readonly provider: ArenaProviderId;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly thinkingMode: ProviderThinkingMode;
  readonly reasoningEffort: ProviderReasoningEffort;
  readonly modelRevision?: string;
}

export interface ProviderFactoryOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly exchangeRecorder?: RawExchangeRecorder;
}

export function normalizeArenaProviderId(value: string): ArenaProviderId {
  const normalized = requireProviderValue(value, "provider").toLowerCase();
  switch (normalized) {
    case "openai":
    case "gpt":
      return "openai";
    case "anthropic":
    case "claude":
      return "anthropic";
    case "deepseek":
      return "deepseek";
    case "qwen":
    case "dashscope":
      return "qwen";
    case "kimi":
    case "moonshot":
      return "kimi";
    case "openai-compatible":
    case "openai-chat":
      return "openai-compatible";
    default:
      throw new Error("provider 仅支持 gpt/openai、claude/anthropic、deepseek、qwen、kimi 或 openai-compatible");
  }
}

export function normalizeProviderThinkingMode(
  value: string | undefined,
  provider: ArenaProviderId,
): ProviderThinkingMode {
  const normalized = value?.trim().toLowerCase() || (provider === "deepseek" ? "disabled" : "default");
  if (normalized !== "default" && normalized !== "disabled" && normalized !== "enabled") {
    throw new Error("thinking 仅支持 default、disabled 或 enabled");
  }
  if (provider !== "deepseek" && normalized !== "default") {
    throw new Error("thinking=disabled/enabled 当前仅支持 DeepSeek Provider");
  }
  return normalized;
}

const REASONING_EFFORTS_BY_PROVIDER = Object.freeze({
  openai: new Set(["none", "low", "medium", "high", "xhigh", "max"]),
  anthropic: new Set(["low", "medium", "high", "xhigh", "max"]),
  deepseek: new Set(["low", "high", "max"]),
  qwen: new Set(["low", "medium", "xhigh"]),
  kimi: new Set(["low", "high", "max"]),
  "openai-compatible": new Set(["none", "low", "medium", "high", "xhigh", "max"]),
} satisfies Readonly<Record<ArenaProviderId, ReadonlySet<string>>>);

export function normalizeProviderReasoningEffort(
  value: string | undefined,
  provider: ArenaProviderId,
): ProviderReasoningEffort {
  const normalized = value?.trim().toLowerCase() || "default";
  if (normalized === "default") return normalized;
  if (!REASONING_EFFORTS_BY_PROVIDER[provider].has(normalized)) {
    const supported = [...REASONING_EFFORTS_BY_PROVIDER[provider]].join("、");
    throw new Error(`${provider} reasoning effort 仅支持 default、${supported}`);
  }
  return normalized as ProviderReasoningEffort;
}

export function normalizeAgentProviderConfig(
  config: Omit<
    ArenaAgentProviderConfig,
    "provider" | "baseUrl" | "thinkingMode" | "reasoningEffort"
  > & {
    readonly provider: string;
    readonly baseUrl: string;
    readonly thinkingMode?: string;
    readonly reasoningEffort?: string;
  },
): ArenaAgentProviderConfig {
  const provider = normalizeArenaProviderId(config.provider);
  const thinkingMode = normalizeProviderThinkingMode(config.thinkingMode, provider);
  const reasoningEffort = normalizeProviderReasoningEffort(config.reasoningEffort, provider);
  if (provider === "deepseek" && reasoningEffort !== "default" && thinkingMode !== "enabled") {
    throw new Error("DeepSeek 配置显式 reasoning effort 时必须设置 thinking=enabled");
  }
  const normalized = {
    provider,
    baseUrl: validateProviderBaseUrl(config.baseUrl, provider),
    model: requireProviderValue(config.model, `${provider} model`),
    maxOutputTokens: config.maxOutputTokens,
    thinkingMode,
    reasoningEffort,
    ...(config.modelRevision?.trim() ? { modelRevision: config.modelRevision.trim() } : {}),
  } as ArenaAgentProviderConfig;
  Object.defineProperty(normalized, "apiKey", {
    value: config.apiKey,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(normalized);
}

export function createDirectProviderAdapter(
  config: ArenaAgentProviderConfig,
  options: ProviderFactoryOptions = {},
): DirectModelProviderAdapter {
  switch (config.provider) {
    case "openai":
      return new OpenAIResponsesProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        allowCustomBaseUrl: true,
        model: config.model,
        maxOutputTokens: config.maxOutputTokens,
        reasoningEffort: config.reasoningEffort,
        ...(config.modelRevision ? { declaredModelRevision: config.modelRevision } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.exchangeRecorder ? { exchangeRecorder: options.exchangeRecorder } : {}),
      });
    case "anthropic":
      return new AnthropicMessagesProvider({
        providerId: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        maxOutputTokens: config.maxOutputTokens,
        reasoningEffort: config.reasoningEffort,
        ...(config.modelRevision ? { declaredModelRevision: config.modelRevision } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.exchangeRecorder ? { exchangeRecorder: options.exchangeRecorder } : {}),
      });
    case "deepseek":
    case "qwen":
    case "kimi":
    case "openai-compatible":
      return new OpenAIChatCompletionsProvider({
        providerId: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        useJsonMode: config.provider === "deepseek" || config.provider === "qwen",
        maxOutputTokens: config.maxOutputTokens,
        thinkingMode: config.thinkingMode,
        reasoningEffort: config.reasoningEffort,
        ...(config.modelRevision ? { declaredModelRevision: config.modelRevision } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.exchangeRecorder ? { exchangeRecorder: options.exchangeRecorder } : {}),
      });
  }
}
