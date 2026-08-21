import assert from "node:assert/strict";
import test from "node:test";

import { GameEnvironment } from "../../dist/core/game-environment.js";
import { DEFAULT_SCENARIO } from "../../dist/core/scenario.js";
import { findPotentialSecrets } from "../../dist/core/secret-scan.js";
import { createDirectModelObservation } from "../../dist/arena/direct-driver.js";
import {
  createDirectProviderAdapter,
  normalizeAgentProviderConfig,
  normalizeArenaProviderId,
  normalizeProviderThinkingMode,
} from "../../dist/arena/providers/provider-factory.js";
import { normalizeProviderTokenUsage } from "../../dist/arena/providers/provider-utils.js";

const TEST_API_KEY = "sk-multi-provider-secret-123456789";

function createDecisionInput(signal = new AbortController().signal) {
  const environment = new GameEnvironment();
  environment.reset({
    matchId: "multi-provider-test",
    episodeId: "multi-provider-test:slot-0",
    agentId: "multi-provider-agent",
    agentSlot: 0,
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
  });
  const previous = environment.step({ type: "move", locationId: 1 });
  return {
    observation: createDirectModelObservation(environment.observe()),
    actionIndex: 1,
    recentResults: [{ success: previous.success, message: previous.message }],
    signal,
  };
}

function chatResponse(action = { type: "buy", itemId: 0, quantity: 2 }, finishReason = "stop") {
  return new Response(JSON.stringify({
    usage: { prompt_tokens: 21, completion_tokens: 4, total_tokens: 25 },
    choices: [{
      finish_reason: finishReason,
      message: { role: "assistant", content: JSON.stringify(action) },
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function anthropicResponse(action = { type: "sell", itemId: 0, quantity: 1 }, stopReason = "end_turn") {
  return new Response(JSON.stringify({
    type: "message",
    usage: { input_tokens: 18, output_tokens: 6 },
    stop_reason: stopReason,
    content: [{ type: "text", text: JSON.stringify(action) }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("provider aliases map to the intended native protocol", () => {
  assert.equal(normalizeArenaProviderId("gpt"), "openai");
  assert.equal(normalizeArenaProviderId("claude"), "anthropic");
  assert.equal(normalizeArenaProviderId("deepseek"), "deepseek");
  assert.equal(normalizeArenaProviderId("dashscope"), "qwen");
  assert.equal(normalizeArenaProviderId("moonshot"), "kimi");
  assert.equal(normalizeArenaProviderId("openai-chat"), "openai-compatible");
  assert.throws(() => normalizeArenaProviderId("unknown-provider"), /仅支持/);
});

test("normalized Agent configs keep API keys non-enumerable", () => {
  const config = normalizeAgentProviderConfig({
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: TEST_API_KEY,
    model: "deepseek-test",
    maxOutputTokens: 128,
  });
  assert.equal(config.apiKey, TEST_API_KEY);
  assert.equal(config.thinkingMode, "disabled");
  assert.equal(Object.keys(config).includes("apiKey"), false);
  assert.equal(JSON.stringify(config).includes(TEST_API_KEY), false);
  assert.equal(findPotentialSecrets(config).length, 0);
});

test("DeepSeek thinking mode defaults to disabled and rejects provider-incompatible values", () => {
  assert.equal(normalizeProviderThinkingMode(undefined, "deepseek"), "disabled");
  assert.equal(normalizeProviderThinkingMode("default", "deepseek"), "default");
  assert.equal(normalizeProviderThinkingMode("enabled", "deepseek"), "enabled");
  assert.equal(normalizeProviderThinkingMode(undefined, "qwen"), "default");
  assert.throws(
    () => normalizeProviderThinkingMode("disabled", "qwen"),
    /仅支持 DeepSeek Provider/,
  );
  assert.throws(
    () => normalizeProviderThinkingMode("turbo", "deepseek"),
    /default、disabled 或 enabled/,
  );
});

test("token usage normalization derives totals and rejects partial or inconsistent counters", () => {
  assert.deepEqual(normalizeProviderTokenUsage(10, 4), {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
  });
  assert.equal(normalizeProviderTokenUsage(10, undefined), undefined);
  assert.equal(normalizeProviderTokenUsage(10, 4, 12), undefined);
  assert.equal(normalizeProviderTokenUsage(-1, 4), undefined);
});

test("OpenAI-compatible providers use independent base URLs, keys and models", async t => {
  const cases = [
    {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-test",
      expectedUrl: "https://api.deepseek.com/chat/completions",
      expectsJsonMode: true,
      expectedThinkingMode: "disabled",
    },
    {
      provider: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-test",
      expectedUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      expectsJsonMode: true,
      expectedThinkingMode: "default",
    },
    {
      provider: "kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-test",
      expectedUrl: "https://api.moonshot.cn/v1/chat/completions",
      expectsJsonMode: false,
      expectedThinkingMode: "default",
    },
  ];

  for (const item of cases) {
    await t.test(item.provider, async () => {
      let capturedUrl;
      let capturedInit;
      const provider = createDirectProviderAdapter(normalizeAgentProviderConfig({
        ...item,
        apiKey: TEST_API_KEY,
        maxOutputTokens: 256,
      }), {
        fetchImpl: async (url, init) => {
          capturedUrl = String(url);
          capturedInit = init;
          return chatResponse();
        },
      });

      const result = await provider.requestDecision(createDecisionInput());
      assert.deepEqual(result.action, {
        type: "buy",
        itemId: 0,
        quantity: 2,
      });
      assert.deepEqual(result.usage, { inputTokens: 21, outputTokens: 4, totalTokens: 25 });
      assert.equal(provider.providerId, item.provider);
      assert.equal(provider.modelId, item.model);
      assert.equal(provider.adapterVersion, "openai-chat-completions-v3");
      assert.equal(provider.thinkingMode, item.expectedThinkingMode);
      assert.equal(capturedUrl, item.expectedUrl);
      assert.equal(capturedInit.redirect, "error");
      assert.equal(new Headers(capturedInit.headers).get("authorization"), `Bearer ${TEST_API_KEY}`);
      const body = JSON.parse(capturedInit.body);
      assert.equal(body.model, item.model);
      assert.equal(body.max_tokens, 256);
      assert.equal(body.stream, false);
      assert.deepEqual(
        body.thinking,
        item.expectedThinkingMode === "default"
          ? undefined
          : { type: item.expectedThinkingMode },
      );
      assert.equal(Boolean(body.response_format), item.expectsJsonMode);
      assert.match(body.messages[0].content, /Return JSON only/);
      assert.equal(JSON.stringify(body).includes(TEST_API_KEY), false);
    });
  }
});

test("DeepSeek explicit default omits thinking while enabled is sent verbatim", async t => {
  for (const thinkingMode of ["default", "enabled"]) {
    await t.test(thinkingMode, async () => {
      let capturedBody;
      const provider = createDirectProviderAdapter(normalizeAgentProviderConfig({
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: TEST_API_KEY,
        model: "deepseek-test",
        maxOutputTokens: 256,
        thinkingMode,
      }), {
        fetchImpl: async (_url, init) => {
          capturedBody = JSON.parse(init.body);
          return chatResponse();
        },
      });
      await provider.requestDecision(createDecisionInput());
      assert.deepEqual(
        capturedBody.thinking,
        thinkingMode === "default" ? undefined : { type: "enabled" },
      );
    });
  }
});

test("Claude uses the native Anthropic Messages protocol", async () => {
  let capturedUrl;
  let capturedInit;
  const provider = createDirectProviderAdapter(normalizeAgentProviderConfig({
    provider: "claude",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: TEST_API_KEY,
    model: "claude-test",
    maxOutputTokens: 384,
  }), {
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return anthropicResponse();
    },
  });

  const result = await provider.requestDecision(createDecisionInput());
  assert.deepEqual(result.action, {
    type: "sell",
    itemId: 0,
    quantity: 1,
  });
  assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 6, totalTokens: 24 });
  assert.equal(provider.providerId, "anthropic");
  assert.equal(provider.adapterVersion, "anthropic-messages-v2");
  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  const headers = new Headers(capturedInit.headers);
  assert.equal(headers.get("x-api-key"), TEST_API_KEY);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "claude-test");
  assert.equal(body.max_tokens, 384);
  assert.equal(body.messages[0].role, "user");
  assert.match(body.system, /Return JSON only/);
  assert.equal(JSON.stringify(body).includes(TEST_API_KEY), false);
});

test("multi-provider adapters redact upstream errors and reject dirty actions", async t => {
  const upstreamSecret = "sk-upstream-multi-secret-123456789";
  const cases = [
    {
      name: "chat HTTP body",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      response: new Response(JSON.stringify({ error: upstreamSecret }), { status: 401 }),
      expectedCode: "http_error",
    },
    {
      name: "chat malformed action",
      provider: "kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      response: chatResponse({ type: "move", locationId: 1, apiKey: upstreamSecret }),
      expectedCode: "invalid_response",
    },
    {
      name: "anthropic incomplete",
      provider: "claude",
      baseUrl: "https://api.anthropic.com/v1",
      response: anthropicResponse({ type: "move", locationId: 1 }, "max_tokens"),
      expectedCode: "incomplete",
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const provider = createDirectProviderAdapter(normalizeAgentProviderConfig({
        provider: item.provider,
        baseUrl: item.baseUrl,
        apiKey: TEST_API_KEY,
        model: "test-model",
        maxOutputTokens: 128,
      }), { fetchImpl: async () => item.response });
      await assert.rejects(provider.requestDecision(createDecisionInput()), error => {
        assert.equal(error.code, item.expectedCode);
        assert.equal(error.message.includes(TEST_API_KEY), false);
        assert.equal(error.message.includes(upstreamSecret), false);
        assert.equal("cause" in error, false);
        return true;
      });
    });
  }
});

test("provider credentials stay private and redirects are forbidden", async () => {
  const controller = new AbortController();
  let sawSignal = false;
  let sawRedirect = false;
  const provider = createDirectProviderAdapter(normalizeAgentProviderConfig({
    provider: "kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKey: TEST_API_KEY,
    model: "kimi-test",
    maxOutputTokens: 128,
  }), {
    fetchImpl: async (_url, init) => {
      sawSignal = init.signal === controller.signal;
      sawRedirect = init.redirect === "error";
      return chatResponse({ type: "expand_capacity" });
    },
  });

  assert.deepEqual((await provider.requestDecision(createDecisionInput(controller.signal))).action, {
    type: "expand_capacity",
  });
  assert.equal(sawSignal, true);
  assert.equal(sawRedirect, true);
  assert.equal(JSON.stringify(provider).includes(TEST_API_KEY), false);
  assert.equal(findPotentialSecrets(provider).length, 0);
});

test("OpenAI Responses accepts an explicit v1 base URL without duplicating the path", async () => {
  let capturedUrl;
  const provider = createDirectProviderAdapter(normalizeAgentProviderConfig({
    provider: "gpt",
    baseUrl: "https://api.openai.com/v1",
    apiKey: TEST_API_KEY,
    model: "gpt-test",
    maxOutputTokens: 128,
  }), {
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({
        status: "completed",
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({
              type: "expand_capacity",
              locationId: null,
              itemId: null,
              quantity: null,
              amount: null,
              points: null,
            }),
          }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.deepEqual((await provider.requestDecision(createDecisionInput())).action, {
    type: "expand_capacity",
  });
  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  assert.equal(provider.providerId, "openai");
  assert.equal(provider.adapterVersion, "openai-responses-v2");
});
