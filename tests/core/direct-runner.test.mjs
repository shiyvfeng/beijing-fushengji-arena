import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECT_CONTEXT_POLICY_VERSION,
  DIRECT_DECISION_POLICY_HASH,
  DIRECT_DECISION_POLICY_ID,
  DIRECT_SYSTEM_INSTRUCTION,
  DirectModelDriver,
  parseDirectGameAction,
} from "../../dist/arena/direct-driver.js";
import { DirectProviderRequestError } from "../../dist/arena/agent-driver.js";
import { runMatch } from "../../dist/arena/match-runner.js";
import { runEpisode } from "../../dist/arena/episode-runner.js";
import { assembleMatchReplay } from "../../dist/arena/replay.js";
import { buildDirectRunReport } from "../../dist/arena/run-report.js";
import { ScriptedDriver, createSampleScriptedDrivers } from "../../dist/arena/scripted-driver.js";
import { DEFAULT_SCENARIO } from "../../dist/core/scenario.js";
import { findPotentialSecrets } from "../../dist/core/secret-scan.js";
import { integrityHash } from "../../dist/core/stable-value.js";

const SPECS = Array.from({ length: 5 }, (_, index) => `competitor-${index + 1}`);
const PROBE_HASH = `sha256:${"1".repeat(64)}`;
const STABILITY_HASH = `sha256:${"2".repeat(64)}`;

function reportOptions(matchId, decisionTimeoutMs = 1_000, totalWallClockMs = 160_000) {
  return {
    matchId,
    seed: 20260820,
    maxActionsPerAgent: 160,
    decisionTimeoutMs,
    totalWallClockMs,
    maxOutputTokens: 128,
    probeSummaryHash: PROBE_HASH,
    probeCreatedAt: "2026-08-22T00:00:00.000Z",
    stabilitySummaryHash: STABILITY_HASH,
    stabilityCreatedAt: "2026-08-22T00:10:00.000Z",
  };
}

function fakeProvider(entryIndex, {
  failure,
  captures = [],
  actionFactory,
  responseRevision = `revision-${entryIndex}`,
  omitUsage = false,
} = {}) {
  const policy = new ScriptedDriver(`fake-${entryIndex}`, `Fake ${entryIndex}`, entryIndex, "steady");
  policy.reset();
  return {
    providerId: `fake-provider-${entryIndex}`,
    adapterVersion: "fake-adapter-v3",
    modelId: `fake-model-${entryIndex}`,
    maxOutputTokens: 128,
    thinkingMode: "enabled",
    reasoningEffort: "max",
    declaredModelRevision: `declared-${entryIndex}`,
    samplingAudit: {
      policyVersion: "provider-explicit-effort-audited-v2",
      temperature: "omitted",
      topP: "omitted",
      maxOutputTokens: 128,
      jsonMode: "json-object",
      thinking: { mode: "enabled", sent: true },
      reasoningEffort: { level: "max", sent: true },
    },
    async requestDecision(input) {
      captures.push(structuredClone({
        observation: input.observation,
        actionIndex: input.actionIndex,
        attemptIndex: input.attemptIndex,
        retryFeedback: input.retryFeedback,
        history: input.history,
        systemInstruction: input.systemInstruction,
        userContext: input.userContext,
        fullContextHash: input.fullContextHash,
        modelCallId: input.modelCallId,
      }));
      if (failure) throw failure(entryIndex);
      const observation = {
        ...input.observation,
        episodeId: "fake-episode",
        agentId: "fake-agent",
        agentSlot: entryIndex,
        observationHash: "sha256:fake",
      };
      return {
        action: actionFactory ? actionFactory(input) : policy.decide({ ...input, observation }),
        ...(omitUsage ? {} : { usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 } }),
        responseModelRevision: responseRevision,
      };
    },
  };
}

function directDrivers(options = {}) {
  const captures = Array.from({ length: 5 }, () => []);
  const rotationIndex = options.rotationIndex ?? 0;
  const drivers = SPECS.map((id, entryIndex) => new DirectModelDriver({
    id,
    slot: (entryIndex + rotationIndex) % 5,
    provider: options.providers?.[entryIndex] ?? fakeProvider(entryIndex, {
      captures: captures[entryIndex],
      failure: options.failedEntry === entryIndex
        ? index => new DirectProviderRequestError(
          `fake-provider-${index}`,
          "http_error",
          "sanitized fake failure",
          503,
        )
        : undefined,
      omitUsage: options.omitUsageEntry === entryIndex,
    }),
  }));
  return { drivers, captures };
}

test("Direct action parser accepts exact schemas and rejects dirty provider output", () => {
  const valid = [
    { type: "move", locationId: 0 },
    { type: "buy", itemId: 0, quantity: 1 },
    { type: "sell", itemId: 7, quantity: 2 },
    { type: "deposit", amount: 1 },
    { type: "withdraw", amount: 2 },
    { type: "repay_debt", amount: 3 },
    { type: "heal", points: 4 },
    { type: "expand_capacity" },
  ];
  for (const candidate of valid) assert.deepEqual(parseDirectGameAction(candidate), candidate);
  const secret = "sk-provider-secret-123456789";
  for (const candidate of [
    null, [], { type: "move", locationId: "1" }, { type: "buy", itemId: 0, quantity: 0 },
    { type: "deposit", amount: Number.NaN }, { type: "expand_capacity", apiKey: secret }, { type: "unknown" },
  ]) {
    assert.throws(() => parseDirectGameAction(candidate), error => (
      error instanceof Error && !error.message.includes(secret)
    ));
  }
});

test("five Direct models use bounded-history-v1 and produce one-to-one request evidence", async () => {
  const { drivers, captures } = directDrivers({ omitUsageEntry: 4 });
  const progress = [];
  let reporterFailureInjected = false;
  const output = await runMatch({
    matchId: "direct-fake-complete",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    maxActionsPerAgent: 160,
    decisionTimeoutMs: 1_000,
    totalWallClockMs: 160_000,
    slotRotationIndex: 0,
    onProgress(event) {
      progress.push(event);
      if (!reporterFailureInjected && event.event === "decision_started") {
        reporterFailureInjected = true;
        throw new Error("observer failure must not alter match facts");
      }
    },
  });

  assert.equal(output.report.executionMode, "direct");
  assert.equal(output.traces.length, 5);
  assert.ok(output.traces.every(trace => trace.finalResult.status === "completed"));
  assert.equal(output.replay.schemaVersion, "arena-schema-v4");
  assert.equal(output.replay.metadata.title, "北京浮生记 · 受控五模型展示赛");
  assert.equal(output.replay.competitionAudit.decisionPolicyId, DIRECT_DECISION_POLICY_ID);
  assert.equal(output.replay.competitionAudit.decisionPolicyHash, DIRECT_DECISION_POLICY_HASH);
  assert.equal(output.replay.competitionAudit.contextPolicyVersion, DIRECT_CONTEXT_POLICY_VERSION);
  assert.equal(output.replay.competitionAudit.recoveryPolicyVersion, "bounded-retry-v2");
  assert.equal(output.replay.competitionAudit.attemptTimeoutMs, 500);
  assert.equal(output.replay.competitionAudit.maxAttemptsPerDecision, 3);
  assert.equal(output.replay.competitionAudit.automaticRetries, 2);
  assert.equal(output.replay.competitionAudit.samplingPolicyVersion, "provider-explicit-effort-audited-v2");
  assert.equal(output.replay.competitionAudit.slotRotation.version, "cyclic-v1");
  assert.equal(output.replay.competitionAudit.totalWallClockMsPerAgent, 160_000);
  assert.equal(output.replay.personalRandomEventAudit.agents.length, 5);
  assert.equal("luckiestAgentIds" in output.replay.personalRandomEventAudit, false);
  assert.ok(output.replay.agents.every(agent => agent.displayName === undefined && agent.personaId === undefined));
  assert.ok(output.replay.agents.every(agent => agent.providerReasoningEffort === "max"));
  assert.ok(output.traces.every(trace => trace.agent.providerReasoningEffort === "max"));
  assert.equal(new Set(output.replay.agents.map(agent => `${agent.provider}:${agent.model}`)).size, 5);

  for (const entries of captures) {
    assert.equal(entries[0].systemInstruction, DIRECT_SYSTEM_INSTRUCTION);
    const sixth = entries[5];
    assert.equal(sixth.history.length, 5);
    const sixthContext = JSON.parse(sixth.userContext);
    assert.equal(sixthContext.recentActions.length, 5);
    assert.equal(sixthContext.olderHistorySummary.successfulActions, 0);
    assert.equal(sixthContext.contextPolicyVersion, "bounded-history-v1");
    assert.equal(sixthContext.recoveryPolicyVersion, "bounded-retry-v2");
    const finalContext = JSON.parse(entries.at(-1).userContext);
    assert.ok(finalContext.recentActions.length <= 8);
    assert.ok(finalContext.recentDaySummaries.length <= 5);
    assert.equal(finalContext.olderHistorySummary.totalAttempts, entries.length - 1 - 8);
    assert.equal(
      sixth.fullContextHash,
      integrityHash({ systemInstruction: sixth.systemInstruction, userContext: sixth.userContext }),
    );
    const serializedContext = sixth.userContext;
    for (const forbidden of [
      "fake-provider", "fake-model", "agentSlot", "episodeId", "observationHash",
      "modelCallId", "competitor-", "ranking", "interview",
    ]) assert.equal(serializedContext.includes(forbidden), false, `context leaked ${forbidden}`);
  }

  const report = buildDirectRunReport(reportOptions("direct-fake-complete"), output);
  assert.equal(report.artifactType, "arena-direct-run-report-v5");
  assert.equal(report.probe.summaryHash, PROBE_HASH);
  assert.equal(report.stability.summaryHash, STABILITY_HASH);
  assert.equal(report.totals.requestCount, report.totals.successfulRequests);
  assert.equal(report.totals.failedRequests, 0);
  assert.ok(report.agents.every(agent => agent.providerReasoningEffort === "max"));
  const missingUsageAgent = report.agents.find(agent => agent.agentId === "competitor-5");
  assert.equal(report.totals.tokens.requestsWithoutUsage, missingUsageAgent.requestCount);
  assert.equal(
    report.totals.tokens.total,
    (report.totals.requestCount - missingUsageAgent.requestCount) * 25,
  );
  assert.ok(missingUsageAgent.modelCalls.every(call => call.usageMissing && call.tokenUsage === null));
  assert.ok(report.agents.every(agent => agent.modelCalls.every(call => (
    call.actionEventIds.length === 1 && !call.terminationEventId && call.failure === null
  ))));
  assert.ok(report.agents.every(agent => agent.modelCalls[0].modelRevision.mismatch));
  assert.equal(findPotentialSecrets(report).length, 0);

  assert.equal(reporterFailureInjected, true);
  assert.ok(progress.every(event => Object.isFrozen(event)));
  assert.equal(progress.filter(event => event.event === "episode_started").length, 5);
  assert.equal(progress.filter(event => event.event === "episode_completed").length, 5);
  assert.equal(
    progress.filter(event => event.event === "decision_started").length,
    report.totals.requestCount,
  );
  assert.equal(
    progress.filter(event => event.event === "action_completed").length,
    report.totals.successfulRequests,
  );
  assert.equal(findPotentialSecrets(progress).length, 0);
  const serializedProgress = JSON.stringify(progress);
  for (const forbidden of [
    "systemInstruction", "userContext", "fullContextHash", "observationHash",
    "modelCallId", "stateDiff", "effects", "message", "apiKey", "authorization", "response",
  ]) assert.equal(serializedProgress.includes(forbidden), false, `progress leaked ${forbidden}`);
  for (const event of progress.filter(event => event.event === "action_completed")) {
    assert.equal(typeof event.actionType, "string");
    assert.equal(typeof event.lastCallLatencyMs, "number");
    assert.equal(typeof event.cumulativeTotalTokens, "number");
  }
});

function retryTestDriver(requestDecision) {
  return new DirectModelDriver({
    id: "competitor-1",
    slot: 0,
    provider: {
      providerId: "retry-provider",
      adapterVersion: "retry-adapter-v1",
      modelId: "retry-model",
      maxOutputTokens: 128,
      reasoningEffort: "low",
      requestDecision,
    },
  });
}

async function runRetryEpisode(matchId, driver, decisionTimeoutMs = 1_000) {
  return runEpisode({
    matchId,
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    driver,
    maxActions: 1,
    decisionTimeoutMs,
    totalWallClockMs: decisionTimeoutMs,
  });
}

test("bounded-retry-v2 repairs an invalid action and records the recovered decision", async () => {
  let requestCount = 0;
  const capturedContexts = [];
  const output = await runRetryEpisode("retry-invalid-action", retryTestDriver(async input => {
    requestCount++;
    capturedContexts.push(JSON.parse(input.userContext));
    return {
      action: requestCount === 1
        ? { type: "move", locationId: 999 }
        : { type: "move", locationId: 0 },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    };
  }));
  assert.equal(output.report.validActionCount, 1);
  assert.equal(output.report.invalidActionCount, 1);
  assert.equal(output.report.retryAttemptCount, 1);
  assert.equal(output.report.recoveredDecisionCount, 1);
  assert.equal(output.report.requestMetrics.requestCount, 2);
  assert.equal(output.report.requestMetrics.calls[0].actionEventIds.length, 1);
  assert.equal(output.report.requestMetrics.calls[1].actionEventIds.length, 1);
  assert.equal(capturedContexts[1].retryFeedback.category, "invalid_action");
  assert.equal(capturedContexts[1].retryFeedback.actionErrorCode, "invalid_location");
  assert.deepEqual(capturedContexts[1].retryFeedback.rejectedAction, { type: "move", locationId: 999 });
});

test("bounded-retry-v2 retains failed usage and sends specific sanitized repair feedback", async () => {
  let requestCount = 0;
  const capturedContexts = [];
  const secret = "credential-fixture-value-123456789";
  const output = await runRetryEpisode("retry-contract-feedback", retryTestDriver(async input => {
    requestCount++;
    capturedContexts.push(JSON.parse(input.userContext));
    if (requestCount === 1) {
      throw new DirectProviderRequestError(
        "retry-provider",
        "invalid_action",
        "safe contract failure",
        undefined,
        {
          responseModelRevision: "retry-revision-7",
          tokenUsage: { inputTokens: 21, outputTokens: 4, totalTokens: 25 },
          actionRepairCode: "quantity_must_be_positive_integer",
          rejectedAction: { type: "buy", itemId: 6, quantity: 0, apiKey: secret },
        },
      );
    }
    return {
      action: { type: "move", locationId: 0 },
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    };
  }));

  assert.equal(output.report.validActionCount, 1);
  assert.equal(output.report.recoveredDecisionCount, 1);
  assert.equal(output.report.requestMetrics.totalTokens, 30);
  assert.equal(output.report.requestMetrics.usageReportedRequestCount, 2);
  const failedCall = output.report.requestMetrics.calls[0];
  assert.equal(failedCall.status, "failed");
  assert.deepEqual(failedCall.tokenUsage, { inputTokens: 21, outputTokens: 4, totalTokens: 25 });
  assert.equal(failedCall.usageMissing, false);
  assert.equal(typeof failedCall.latencyMs, "number");
  assert.ok(failedCall.latencyMs >= 0);
  assert.equal(failedCall.modelRevision.response, "retry-revision-7");
  assert.equal(failedCall.retryReason, "invalid_action");
  assert.deepEqual(capturedContexts[1].retryFeedback, {
    category: "invalid_action",
    actionErrorCode: "quantity_must_be_positive_integer",
    rejectedAction: { type: "buy", itemId: 6, quantity: 0 },
  });
  assert.equal(JSON.stringify(capturedContexts).includes(secret), false);
  assert.equal(findPotentialSecrets(output.report.requestMetrics).length, 0);
});

test("bounded-retry-v2 retries one timed-out attempt inside the same logical deadline", async () => {
  let requestCount = 0;
  const startedAt = performance.now();
  const output = await runRetryEpisode("retry-timeout", retryTestDriver(input => {
    requestCount++;
    if (requestCount === 1) {
      return new Promise((_, reject) => input.signal.addEventListener(
        "abort",
        () => reject(input.signal.reason),
        { once: true },
      ));
    }
    return Promise.resolve({ action: { type: "move", locationId: 0 } });
  }), 200);
  const elapsedMs = performance.now() - startedAt;
  assert.equal(output.report.attemptTimeoutMs, 100);
  assert.equal(output.report.validActionCount, 1);
  assert.equal(output.report.recoveredDecisionCount, 1);
  assert.equal(output.report.requestMetrics.calls[0].failure.category, "timeout");
  assert.equal(output.report.requestMetrics.calls[0].retryReason, "timeout");
  assert.equal(output.report.requestMetrics.calls[1].attemptIndex, 1);
  assert.ok(elapsedMs >= 90 && elapsedMs < 500, `unexpected elapsed ${elapsedMs}`);
});

test("bounded-retry-v2 exhausts repair attempts but never retries context_limit", async () => {
  const exhausted = await runRetryEpisode("retry-exhausted", retryTestDriver(async () => {
    throw new DirectProviderRequestError(
      "retry-provider",
      "invalid_response",
      "safe invalid response",
    );
  }));
  assert.equal(exhausted.trace.finalResult.technicalFailure.category, "invalid_response");
  assert.equal(exhausted.report.requestMetrics.requestCount, 3);
  assert.deepEqual(
    exhausted.report.requestMetrics.calls.map(call => call.retryReason),
    ["invalid_response", "invalid_response", null],
  );
  assert.equal(exhausted.report.requestMetrics.calls[2].terminationEventId !== null, true);

  const contextLimit = await runRetryEpisode("retry-context-limit", retryTestDriver(async () => {
    throw new DirectProviderRequestError(
      "retry-provider",
      "context_limit",
      "safe context limit",
      400,
    );
  }));
  assert.equal(contextLimit.trace.finalResult.technicalFailure.category, "context_limit");
  assert.equal(contextLimit.report.requestMetrics.requestCount, 1);
  assert.equal(contextLimit.report.requestMetrics.calls[0].retryReason, null);
});

test("cyclic-v1 rotates only personal slots while public market facts stay shared", async () => {
  const first = directDrivers({ rotationIndex: 0 });
  const second = directDrivers({ rotationIndex: 3 });
  const [output0, output3] = await Promise.all([
    runMatch({
      matchId: "rotation-0", seed: 20260820, scenario: DEFAULT_SCENARIO,
      drivers: first.drivers, maxActionsPerAgent: 160, slotRotationIndex: 0,
    }),
    runMatch({
      matchId: "rotation-3", seed: 20260820, scenario: DEFAULT_SCENARIO,
      drivers: second.drivers, maxActionsPerAgent: 160, slotRotationIndex: 3,
    }),
  ]);
  assert.deepEqual(
    output0.replay.days.map(day => day.publicReferencePrice),
    output3.replay.days.map(day => day.publicReferencePrice),
  );
  assert.deepEqual(
    output3.replay.competitionAudit.slotRotation.mappings.map(item => item.slot),
    [3, 4, 0, 1, 2],
  );
});

test("one Provider failure is isolated and does not count as a model failure", async () => {
  const { drivers } = directDrivers({ failedEntry: 1 });
  const output = await runMatch({
    matchId: "direct-fake-failure",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    maxActionsPerAgent: 160,
  });
  const failed = output.traces.find(trace => trace.agentId === "competitor-2");
  assert.deepEqual(failed.finalResult.technicalFailure, {
    category: "http_error",
    phase: "decide",
    domain: "provider",
    countsTowardModelFailure: false,
    provider: "fake-provider-1",
    httpStatus: 503,
  });
  assert.ok(output.traces.filter(trace => trace.agentId !== "competitor-2")
    .every(trace => trace.finalResult.status === "completed"));
  const report = buildDirectRunReport(reportOptions("direct-fake-failure", 30_000, 4_800_000), output);
  const failedReport = report.agents.find(agent => agent.agentId === "competitor-2");
  assert.equal(failedReport.failedRequests, 2);
  assert.equal(failedReport.retryAttempts, 1);
  assert.equal(failedReport.faultDomains.provider, 2);
  assert.equal(failedReport.countsTowardModelFailure, false);
  assert.equal(failedReport.modelCalls[0].retryReason, "http_error");
  assert.equal(failedReport.modelCalls[1].terminationEventId !== null, true);
  assert.equal(report.totals.modelFailureAgents, 0);
});

test("context limit is a model-boundary DNF while the other four complete", async () => {
  const providers = Array.from({ length: 5 }, (_, index) => fakeProvider(index, {
    failure: index === 2
      ? () => new DirectProviderRequestError("fake-provider-2", "context_limit", "safe context limit", 400)
      : undefined,
  }));
  const { drivers } = directDrivers({ providers });
  const output = await runMatch({
    matchId: "context-limit-isolation",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
  });
  const failed = output.traces.find(trace => trace.agentId === "competitor-3");
  assert.equal(failed.finalResult.technicalFailure.category, "context_limit");
  assert.equal(failed.finalResult.technicalFailure.domain, "model");
  assert.equal(failed.finalResult.technicalFailure.countsTowardModelFailure, true);
  assert.equal(output.traces.filter(trace => trace.agentId !== "competitor-3")
    .every(trace => trace.finalResult.status === "completed"), true);
});

test("per-Agent total wall clock terminates only the exhausted contestant", async () => {
  const providers = Array.from({ length: 5 }, (_, index) => index === 0 ? {
    providerId: "slow-provider",
    adapterVersion: "slow-v1",
    modelId: "slow-model",
    maxOutputTokens: 128,
    reasoningEffort: "max",
    requestDecision() { return new Promise(() => {}); },
  } : fakeProvider(index));
  const { drivers } = directDrivers({ providers });
  const output = await runMatch({
    matchId: "total-wall-clock",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    // Keep enough headroom for the four CPU-bound fake episodes when Node runs
    // multiple test files concurrently; only the never-resolving Provider should expire.
    decisionTimeoutMs: 3_000,
    totalWallClockMs: 2_000,
  });
  const failed = output.traces.find(trace => trace.agentId === "competitor-1");
  assert.equal(failed.finalResult.status, "model_timeout");
  assert.equal(failed.finalResult.technicalFailure.category, "total_wall_clock");
  assert.equal(failed.finalResult.technicalFailure.domain, "undetermined");
  const failedReport = output.report.episodeReports.find(report => report.agentId === "competitor-1");
  assert.equal(failedReport.requestMetrics.calls[0].modelRevision.resolved, "unavailable");
  assert.equal(output.traces.filter(trace => trace.agentId !== "competitor-1")
    .every(trace => trace.finalResult.status === "completed"), true);
});

test("Direct Match rejects count, alias duplicates, internal IDs, personas and invalid rotation before execution", async () => {
  const { drivers } = directDrivers();
  await assert.rejects(
    runMatch({ matchId: "too-few", seed: 1, scenario: DEFAULT_SCENARIO, drivers: drivers.slice(0, 4) }),
    /恰好包含五个/,
  );
  const duplicate = directDrivers();
  duplicate.drivers[4] = new DirectModelDriver({
    id: "competitor-5",
    slot: 4,
    provider: fakeProvider(0),
  });
  await assert.rejects(
    runMatch({ matchId: "duplicate", seed: 1, scenario: DEFAULT_SCENARIO, drivers: duplicate.drivers }),
    /互不重复/,
  );
  const aliasDuplicate = directDrivers();
  aliasDuplicate.drivers[0] = new DirectModelDriver({
    id: "competitor-1",
    slot: 0,
    provider: { ...fakeProvider(0), providerId: "gpt", modelId: "same-model" },
  });
  aliasDuplicate.drivers[1] = new DirectModelDriver({
    id: "competitor-2",
    slot: 1,
    provider: { ...fakeProvider(1), providerId: "openai", modelId: "same-model" },
  });
  await assert.rejects(
    runMatch({ matchId: "alias-duplicate", seed: 1, scenario: DEFAULT_SCENARIO, drivers: aliasDuplicate.drivers }),
    /互不重复/,
  );
  const wrongId = directDrivers();
  wrongId.drivers[2] = new DirectModelDriver({
    id: "strategy-agent",
    slot: 2,
    provider: fakeProvider(2),
  });
  await assert.rejects(
    runMatch({ matchId: "wrong-id", seed: 1, scenario: DEFAULT_SCENARIO, drivers: wrongId.drivers }),
    /competitor-1\.\.\.5/,
  );
  const nonContinuous = directDrivers();
  nonContinuous.drivers[2] = new DirectModelDriver({
    id: "competitor-3",
    slot: 5,
    provider: fakeProvider(2),
  });
  await assert.rejects(
    runMatch({ matchId: "non-continuous", seed: 1, scenario: DEFAULT_SCENARIO, drivers: nonContinuous.drivers }),
    /连续覆盖 0\.\.4/,
  );
  const persona = directDrivers();
  persona.drivers[0] = {
    ...persona.drivers[0],
    descriptor: { ...persona.drivers[0].descriptor, displayName: "策略身份" },
  };
  await assert.rejects(
    runMatch({ matchId: "persona", seed: 1, scenario: DEFAULT_SCENARIO, drivers: persona.drivers }),
    /禁止 displayName/,
  );
  const missingEffort = directDrivers();
  missingEffort.drivers[0] = {
    ...missingEffort.drivers[0],
    descriptor: { ...missingEffort.drivers[0].descriptor, providerReasoningEffort: "default" },
  };
  await assert.rejects(
    runMatch({ matchId: "missing-effort", seed: 1, scenario: DEFAULT_SCENARIO, drivers: missingEffort.drivers }),
    /显式思考等级/,
  );
  const rotated = directDrivers({ rotationIndex: 1 });
  await assert.rejects(
    runMatch({ matchId: "wrong-rotation", seed: 1, scenario: DEFAULT_SCENARIO, drivers: rotated.drivers, slotRotationIndex: 0 }),
    /cyclic-v1/,
  );
});

test("Replay assembler binds each cyclic-v1 mapping to its competitor and actual slot", async () => {
  const { drivers } = directDrivers({ rotationIndex: 2 });
  const output = await runMatch({
    matchId: "rotation-audit-binding",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    slotRotationIndex: 2,
  });
  const forged = structuredClone(output.replay.competitionAudit);
  [forged.slotRotation.mappings[0].agentId, forged.slotRotation.mappings[1].agentId] = [
    forged.slotRotation.mappings[1].agentId,
    forged.slotRotation.mappings[0].agentId,
  ];
  assert.throws(
    () => assembleMatchReplay("rotation-audit-binding", output.traces, DEFAULT_SCENARIO, forged),
    /cyclic-v1 映射无效/,
  );
  const forgedBudget = structuredClone(output.replay.competitionAudit);
  forgedBudget.attemptTimeoutMs = forgedBudget.decisionTimeoutMs;
  assert.throws(
    () => assembleMatchReplay("rotation-audit-binding", output.traces, DEFAULT_SCENARIO, forgedBudget),
    /预算、恢复或随机策略无效/,
  );
});

test("Match Runner rejects mixed and MCP driver sets before execution", async () => {
  const [direct] = directDrivers().drivers;
  const [scripted] = createSampleScriptedDrivers();
  await assert.rejects(
    runMatch({ matchId: "mixed", seed: 1, scenario: DEFAULT_SCENARIO, drivers: [direct, scripted] }),
    /不能混合执行模式/,
  );
  await assert.rejects(
    runMatch({
      matchId: "mcp", seed: 1, scenario: DEFAULT_SCENARIO,
      drivers: [{
        descriptor: { id: "mcp-agent", displayName: "MCP", slot: 0, driver: "mcp" },
        decide() { return { type: "move", locationId: 1 }; },
      }],
    }),
    /尚未实现 MCP Host/,
  );
});

test("Replay assembler rejects a forged unsupported driver kind", async () => {
  const output = await runMatch({
    matchId: "forged-driver-kind-test",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers: [createSampleScriptedDrivers()[0]],
  });
  const forged = structuredClone(output.traces[0]);
  forged.driver = "bogus";
  forged.agent.driver = "bogus";
  const { traceHash: _, ...body } = forged;
  forged.traceHash = integrityHash(body);
  assert.throws(
    () => assembleMatchReplay("forged-driver-kind-test", [forged], DEFAULT_SCENARIO),
    /不支持的执行模式/,
  );
});
