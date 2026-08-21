import type { DirectModelProviderAdapter } from "../agent-driver.js";
import type { ProviderThinkingMode } from "../../core/contracts.js";
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
}

export interface ProviderFactoryOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
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

export function normalizeAgentProviderConfig(
  config: Omit<ArenaAgentProviderConfig, "provider" | "baseUrl" | "thinkingMode"> & {
    readonly provider: string;
    readonly baseUrl: string;
    readonly thinkingMode?: string;
  },
): ArenaAgentProviderConfig {
  const provider = normalizeArenaProviderId(config.provider);
  const normalized = {
    provider,
    baseUrl: validateProviderBaseUrl(config.baseUrl, provider),
    model: requireProviderValue(config.model, `${provider} model`),
    maxOutputTokens: config.maxOutputTokens,
    thinkingMode: normalizeProviderThinkingMode(config.thinkingMode, provider),
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
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    case "anthropic":
      return new AnthropicMessagesProvider({
        providerId: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        maxOutputTokens: config.maxOutputTokens,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
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
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
  }
}
