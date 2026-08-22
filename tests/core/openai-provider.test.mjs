import assert from "node:assert/strict";
import test from "node:test";

import { OpenAIResponsesProvider } from "../../dist/arena/providers/openai-responses-provider.js";
import { createDirectModelObservation, DirectModelDriver } from "../../dist/arena/direct-driver.js";
import { runEpisode } from "../../dist/arena/episode-runner.js";
import { GameEnvironment } from "../../dist/core/game-environment.js";
import { DEFAULT_SCENARIO } from "../../dist/core/scenario.js";
import { findPotentialSecrets } from "../../dist/core/secret-scan.js";

const TEST_API_KEY = "sk-provider-test-secret-123456789";

function createDecisionInput(signal = new AbortController().signal) {
  const environment = new GameEnvironment();
  environment.reset({
    matchId: "openai-provider-test",
    episodeId: "openai-provider-test:slot-0",
    agentId: "direct-agent-0",
    agentSlot: 0,
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
  });
  const previous = environment.step({ type: "move", locationId: 1 });
  return {
    matchId: "openai-provider-test",
    observation: createDirectModelObservation(environment.observe()),
    actionIndex: 1,
    history: [{
      actionIndex: 0,
      action: previous.event.action,
      result: {
        success: previous.success,
        code: previous.code ?? null,
        message: previous.message,
        effects: previous.event.result.effects,
      },
      stateDiff: previous.diff,
    }],
    signal,
  };
}

function actionEnvelope(overrides = {}) {
  return {
    type: "buy",
    locationId: null,
    itemId: 0,
    quantity: 2,
    amount: null,
    points: null,
    ...overrides,
  };
}

function completedResponse(envelope = actionEnvelope()) {
  return new Response(JSON.stringify({
    status: "completed",
    usage: { input_tokens: 31, output_tokens: 7, total_tokens: 38 },
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(envelope) }],
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("OpenAI provider sends a strict Responses request and returns a minimal GameAction", async () => {
  let capturedUrl;
  let capturedInit;
  const controller = new AbortController();
  const provider = new OpenAIResponsesProvider({
    apiKey: TEST_API_KEY,
    model: "test-model",
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return completedResponse();
    },
  });

  const result = await provider.requestDecision(createDecisionInput(controller.signal));
  assert.deepEqual(result.action, { type: "buy", itemId: 0, quantity: 2 });
  assert.deepEqual(result.usage, { inputTokens: 31, outputTokens: 7, totalTokens: 38 });
  assert.equal(Object.isFrozen(result.action), true);
  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.redirect, "error");
  assert.strictEqual(capturedInit.signal, controller.signal);
  const headers = new Headers(capturedInit.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TEST_API_KEY}`);
  assert.equal(headers.get("content-type"), "application/json");

  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 128);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "arena_game_action");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.type, "object");
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.deepEqual(
    [...body.text.format.schema.required].sort(),
    ["amount", "itemId", "locationId", "points", "quantity", "type"],
  );

  const developerText = body.input[0].content[0].text;
  assert.match(developerText, /Maximize final net worth/);
  assert.match(developerText, /only move advances the day/);
  assert.match(developerText, /liquidityDiscount/);
  const userContext = JSON.parse(body.input[1].content[0].text);
  assert.equal("agent" in userContext, false);
  assert.equal("agentId" in userContext.observation, false);
  assert.equal("agentSlot" in userContext.observation, false);
  assert.equal("episodeId" in userContext.observation, false);
  assert.equal("observationHash" in userContext.observation, false);
  assert.deepEqual(
    Object.keys(userContext.history[0]).sort(),
    ["action", "actionIndex", "result", "stateDiff"],
  );
  assert.equal(JSON.stringify(body).includes(TEST_API_KEY), false);
});

test("OpenAI provider propagates AbortSignal and forbids credential-following redirects", async () => {
  const controller = new AbortController();
  let sawSignal = false;
  let sawRedirectMode = false;
  const provider = new OpenAIResponsesProvider({
    apiKey: TEST_API_KEY,
    model: "test-model",
    fetchImpl: async (_url, init) => {
      sawSignal = init.signal === controller.signal;
      sawRedirectMode = init.redirect === "error";
      return completedResponse(actionEnvelope({
        type: "expand_capacity",
        itemId: null,
        quantity: null,
      }));
    },
  });

  const result = await provider.requestDecision(createDecisionInput(controller.signal));
  assert.deepEqual(result.action, { type: "expand_capacity" });
  assert.equal(sawSignal, true);
  assert.equal(sawRedirectMode, true);
});

test("OpenAI provider normalizes every action envelope into the canonical union", async t => {
  const cases = [
    [
      { type: "move", locationId: 3, itemId: null, quantity: null, amount: null, points: null },
      { type: "move", locationId: 3 },
    ],
    [
      actionEnvelope({ type: "sell", quantity: 1 }),
      { type: "sell", itemId: 0, quantity: 1 },
    ],
    ...["deposit", "withdraw", "repay_debt"].map(type => ([
      { type, locationId: null, itemId: null, quantity: null, amount: 25, points: null },
      { type, amount: 25 },
    ])),
    [
      { type: "heal", locationId: null, itemId: null, quantity: null, amount: null, points: 4 },
      { type: "heal", points: 4 },
    ],
  ];

  for (const [envelope, expected] of cases) {
    await t.test(expected.type, async () => {
      const provider = new OpenAIResponsesProvider({
        apiKey: TEST_API_KEY,
        model: "test-model",
        fetchImpl: async () => completedResponse(envelope),
      });
      assert.deepEqual((await provider.requestDecision(createDecisionInput())).action, expected);
    });
  }
});

test("OpenAI provider rejects refusals and never reports refusal text", async () => {
  const refusalSecret = "sk-refusal-secret-123456789";
  const provider = new OpenAIResponsesProvider({
    apiKey: TEST_API_KEY,
    model: "test-model",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "completed",
      output: [{
        type: "message",
        content: [{ type: "refusal", refusal: `cannot comply ${refusalSecret}` }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  await assert.rejects(provider.requestDecision(createDecisionInput()), error => {
    assert.equal(error.code, "refusal");
    assert.equal(error.message.includes(refusalSecret), false);
    assert.equal(error.message.includes(TEST_API_KEY), false);
    return true;
  });
});

test("OpenAI provider redacts HTTP, transport, incomplete and malformed response details", async t => {
  const upstreamSecret = "sk-upstream-secret-123456789";
  const cases = [
    {
      name: "HTTP error body",
      expectedCode: "http_error",
      fetchImpl: async () => new Response(
        JSON.stringify({ error: { message: upstreamSecret } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    },
    {
      name: "transport exception",
      expectedCode: "transport_error",
      fetchImpl: async () => { throw new Error(`${TEST_API_KEY} ${upstreamSecret}`); },
    },
    {
      name: "incomplete details",
      expectedCode: "incomplete",
      fetchImpl: async () => new Response(JSON.stringify({
        status: "incomplete",
        incomplete_details: { reason: upstreamSecret },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    },
    {
      name: "malformed output text",
      expectedCode: "invalid_response",
      fetchImpl: async () => new Response(JSON.stringify({
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: `{${upstreamSecret}` }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const provider = new OpenAIResponsesProvider({
        apiKey: TEST_API_KEY,
        model: "test-model",
        fetchImpl: item.fetchImpl,
      });
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

test("OpenAI provider rejects extra, irrelevant and unsafe action fields", async t => {
  const invalidEnvelopes = [
    { ...actionEnvelope(), surprise: true },
    actionEnvelope({ amount: 3 }),
    actionEnvelope({ quantity: 1.5 }),
    actionEnvelope({ quantity: Number.MAX_SAFE_INTEGER + 1 }),
    actionEnvelope({ type: "unknown" }),
  ];

  for (const [index, envelope] of invalidEnvelopes.entries()) {
    await t.test(`invalid envelope ${index + 1}`, async () => {
      const provider = new OpenAIResponsesProvider({
        apiKey: TEST_API_KEY,
        model: "test-model",
        fetchImpl: async () => completedResponse(envelope),
      });
      await assert.rejects(
        provider.requestDecision(createDecisionInput()),
        error => error.code === "invalid_action",
      );
    });
  }
});

test("OpenAI provider keeps credentials in non-enumerable private state", async () => {
  const provider = new OpenAIResponsesProvider({
    apiKey: TEST_API_KEY,
    model: "test-model",
    fetchImpl: async () => completedResponse(),
  });
  const result = await provider.requestDecision(createDecisionInput());

  assert.equal(JSON.stringify(provider).includes(TEST_API_KEY), false);
  assert.equal(findPotentialSecrets(provider).length, 0);
  assert.equal(findPotentialSecrets(result).length, 0);
  assert.equal(JSON.stringify(result).includes(TEST_API_KEY), false);
});

test("OpenAI provider validates the per-decision token ceiling before any request", () => {
  for (const maxOutputTokens of [0, 15, 4_097, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new OpenAIResponsesProvider({
        apiKey: TEST_API_KEY,
        model: "test-model",
        maxOutputTokens,
        fetchImpl: async () => completedResponse(),
      }),
      /maxOutputTokens/,
    );
  }
});

test("OpenAI provider requires explicit consent for a custom credential destination", () => {
  assert.throws(
    () => new OpenAIResponsesProvider({
      apiKey: TEST_API_KEY,
      model: "test-model",
      baseUrl: "https://example.invalid/proxy",
      fetchImpl: async () => completedResponse(),
    }),
    /allowCustomBaseUrl/,
  );
  assert.doesNotThrow(() => new OpenAIResponsesProvider({
    apiKey: TEST_API_KEY,
    model: "test-model",
    baseUrl: "https://example.invalid/proxy",
    allowCustomBaseUrl: true,
    fetchImpl: async () => completedResponse(),
  }));
});

test("an abort-aware OpenAI request remains an Arena model_timeout", async () => {
  const upstreamSecret = "sk-abort-secret-123456789";
  const provider = new OpenAIResponsesProvider({
    apiKey: TEST_API_KEY,
    model: "test-model",
    fetchImpl: async (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(new Error(upstreamSecret));
      }, { once: true });
    }),
  });
  const output = await runEpisode({
    matchId: "openai-abort-timeout-test",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    decisionTimeoutMs: 15,
    driver: new DirectModelDriver({
      id: "openai-timeout-agent",
      displayName: "OpenAI 超时测试",
      personaId: "timeout-test",
      slot: 0,
      provider,
    }),
  });

  assert.equal(output.trace.finalResult.status, "model_timeout");
  assert.equal(output.report.timeoutPhase, "decide");
  assert.equal(JSON.stringify(output).includes(upstreamSecret), false);
  assert.equal(JSON.stringify(output).includes(TEST_API_KEY), false);
});
