import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRawExchangeRecorder } from "../../dist/arena/diagnostics.js";
import { DirectModelDriver } from "../../dist/arena/direct-driver.js";
import { runMatch } from "../../dist/arena/match-runner.js";
import { OpenAIChatCompletionsProvider } from "../../dist/arena/providers/openai-chat-completions-provider.js";
import { DEFAULT_SCENARIO } from "../../dist/core/scenario.js";

test("raw exchange diagnostics stay absent when disabled", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-diagnostics-off-"));
  try {
    const recorder = createRawExchangeRecorder({
      enabled: false,
      diagnosticsRoot: root,
      matchId: "diagnostics-off",
      phase: "match",
      secrets: ["sk-disabled-secret-123456"],
    });
    assert.equal(recorder, undefined);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enabled diagnostics reject path-like match IDs before creating files", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-diagnostics-path-"));
  try {
    assert.throws(() => createRawExchangeRecorder({
      enabled: true,
      diagnosticsRoot: root,
      matchId: "match/../../escape",
      phase: "match",
      secrets: [],
    }), /matchId 格式无效/);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("diagnostic write failures remain observable at flush", async () => {
  const root = mkdtempSync(join(tmpdir(), "arena-diagnostics-write-failure-"));
  try {
    const blockedRoot = join(root, "not-a-directory");
    writeFileSync(blockedRoot, "blocked", "utf8");
    const recorder = createRawExchangeRecorder({
      enabled: true,
      diagnosticsRoot: blockedRoot,
      matchId: "diagnostics-write-failure",
      phase: "match",
      secrets: [],
    });
    recorder.capture({
      modelCallId: "model-call-write-failure",
      provider: "fake",
      endpoint: "https://example.invalid/v1",
      request: { method: "POST", headers: {}, body: "{}" },
      transportError: true,
    });
    await assert.rejects(recorder.flush(), /诊断写入失败/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enabled raw exchange diagnostics preserve bodies but redact headers and nested credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "arena-diagnostics-on-"));
  const secret = "sk-diagnostic-secret-123456789";
  try {
    const recorder = createRawExchangeRecorder({
      enabled: true,
      diagnosticsRoot: root,
      matchId: "diagnostics-on",
      phase: "probe",
      secrets: [secret],
    });
    recorder.capture({
      modelCallId: "model-call_test",
      provider: "fake",
      endpoint: "https://example.invalid/v1/chat/completions",
      request: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          Cookie: `session=${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "fake-model",
          messages: [{ role: "user", content: "complete request body" }],
          nested: {
            apiKey: secret,
            clientSecret: "unknown-client-secret",
            token: "unknown-generic-token",
            accessToken: "unknown-access-token",
            credentials: { value: "unknown-credential" },
            harmless: `Bearer ${secret}`,
          },
        }),
      },
      response: new Response(JSON.stringify({
        choices: [{ message: { content: "{\"type\":\"move\",\"locationId\":1}" } }],
        nested: { access_token: secret },
      }), {
        status: 200,
        headers: { "Set-Cookie": `session=${secret}`, "Content-Type": "application/json" },
      }),
    });
    await recorder.flush();
    const directory = join(root, "diagnostics-on", "probe");
    const files = readdirSync(directory);
    assert.equal(files.length, 1);
    const text = readFileSync(join(directory, files[0]), "utf8");
    assert.match(text, /complete request body/);
    assert.match(text, /locationId/);
    assert.equal(text.includes(secret), false);
    assert.equal(/Bearer\s+(?!\[REDACTED\])/u.test(text), false);
    const parsed = JSON.parse(text);
    assert.equal(parsed.request.headers.Authorization, "[REDACTED]");
    assert.equal(parsed.request.headers.Cookie, "[REDACTED]");
    assert.equal(parsed.request.body.nested.apiKey, "[REDACTED]");
    assert.equal(parsed.request.body.nested.clientSecret, "[REDACTED]");
    assert.equal(parsed.request.body.nested.token, "[REDACTED]");
    assert.equal(parsed.request.body.nested.accessToken, "[REDACTED]");
    assert.equal(parsed.request.body.nested.credentials, "[REDACTED]");
    assert.equal(parsed.response.headers["set-cookie"], "[REDACTED]");
    assert.equal(parsed.response.body.nested.access_token, "[REDACTED]");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runDiagnosticMatch(diagnosticsRoot, enabled, secret) {
  const recorder = createRawExchangeRecorder({
    enabled,
    diagnosticsRoot,
    matchId: "diagnostics-hash-stability",
    phase: "match",
    secrets: [secret],
  });
  const drivers = Array.from({ length: 5 }, (_, index) => new DirectModelDriver({
    id: `competitor-${index + 1}`,
    slot: index,
    provider: new OpenAIChatCompletionsProvider({
      providerId: `fake-provider-${index + 1}`,
      apiKey: `${secret}-${index + 1}`,
      baseUrl: `https://provider-${index + 1}.invalid/v1`,
      model: `fake-model-${index + 1}`,
      maxOutputTokens: 64,
      reasoningEffort: "max",
      ...(recorder ? { exchangeRecorder: recorder } : {}),
      fetchImpl: async () => new Response(JSON.stringify({
        error: { message: "temporary upstream failure" },
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    }),
  }));
  const output = await runMatch({
    matchId: "diagnostics-hash-stability",
    seed: 20_260_820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    maxActionsPerAgent: 40,
    decisionTimeoutMs: 1_000,
    totalWallClockMs: 40_000,
    slotRotationIndex: 0,
  });
  await recorder?.flush();
  return output;
}

test("raw exchange toggle cannot change Trace, Replay, fact hash or ranking", async () => {
  const offRoot = mkdtempSync(join(tmpdir(), "arena-diagnostics-hash-off-"));
  const onRoot = mkdtempSync(join(tmpdir(), "arena-diagnostics-hash-on-"));
  const secret = "sk-diagnostic-toggle-secret-123456789";
  try {
    const disabled = await runDiagnosticMatch(offRoot, false, secret);
    const enabled = await runDiagnosticMatch(onRoot, true, secret);
    assert.deepEqual(enabled.traces, disabled.traces);
    assert.deepEqual(enabled.replay, disabled.replay);
    assert.equal(enabled.replay.factHash, disabled.replay.factHash);
    assert.equal(enabled.replay.replayHash, disabled.replay.replayHash);
    assert.deepEqual(enabled.replay.finalRanking, disabled.replay.finalRanking);
    assert.deepEqual(readdirSync(offRoot), []);

    const directory = join(onRoot, "diagnostics-hash-stability", "match");
    const files = readdirSync(directory);
    assert.equal(files.length, 10);
    for (const file of files) {
      assert.equal(readFileSync(join(directory, file), "utf8").includes(secret), false);
    }
  } finally {
    rmSync(offRoot, { recursive: true, force: true });
    rmSync(onRoot, { recursive: true, force: true });
  }
});
