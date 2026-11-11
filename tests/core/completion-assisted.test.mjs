import assert from "node:assert/strict";
import test from "node:test";

import { DirectProviderRequestError } from "../../dist/arena/agent-driver.js";
import {
  COMPLETION_SYSTEM_INSTRUCTION,
  COMPLETION_RUN_TRACK,
  generateDailyPlanOptions,
} from "../../dist/arena/completion-assisted.js";
import { DirectModelDriver } from "../../dist/arena/direct-driver.js";
import { runEpisode } from "../../dist/arena/episode-runner.js";
import { runMatch } from "../../dist/arena/match-runner.js";
import { assembleMatchReplay } from "../../dist/arena/replay.js";
import {
  assertMatchingProviderProbe,
  computeProbeConfigFingerprint,
  probeProviders,
} from "../../dist/arena/provider-probe.js";
import { buildDirectRunReport } from "../../dist/arena/run-report.js";
import {
  assertMatchingProviderStability,
  buildProviderStabilityResult,
} from "../../dist/arena/stability-probe.js";
import { GameEnvironment } from "../../dist/core/game-environment.js";
import { DEFAULT_SCENARIO } from "../../dist/core/scenario.js";
import { integrityHash } from "../../dist/core/stable-value.js";

function shortScenario(totalDays, suffix = "default") {
  return Object.freeze({
    ...DEFAULT_SCENARIO,
    id: `completion-assisted-test-${totalDays}-${suffix}`,
    totalDays,
  });
}

function episodeConfig(scenario, suffix = "episode") {
  return {
    matchId: `completion-${suffix}`,
    episodeId: `completion-${suffix}:slot-0`,
    agentId: "competitor-1",
    agentSlot: 0,
    seed: 20260822,
    scenario,
  };
}

function completionProvider(index, requestDecision) {
  return {
    providerId: `completion-provider-${index}`,
    adapterVersion: "completion-fake-v1",
    modelId: `completion-model-${index}`,
    maxOutputTokens: 128,
    thinkingMode: "enabled",
    reasoningEffort: "low",
    samplingAudit: {
      policyVersion: "provider-explicit-effort-audited-v2",
      temperature: "omitted",
      topP: "omitted",
      maxOutputTokens: 128,
      jsonMode: "json-schema",
      thinking: { mode: "enabled", sent: true },
      reasoningEffort: { level: "low", sent: true },
    },
    requestDecision,
  };
}

function completionDriver(index, requestDecision) {
  return new DirectModelDriver({
    id: `competitor-${index + 1}`,
    slot: index,
    provider: completionProvider(index, requestDecision),
    completionAssisted: true,
  });
}

function firstPlan(input) {
  assert.equal(input.decisionContract.kind, "daily-plan");
  return {
    action: {
      planId: input.decisionContract.planIds[0],
      destinationId: input.decisionContract.destinationIds[0],
    },
    usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  };
}

function assistedEpisodeOptions(scenario, driver, overrides = {}) {
  return {
    matchId: `assisted-${scenario.id}`,
    seed: 20260822,
    scenario,
    driver,
    completionAssisted: true,
    decisionTimeoutMs: 120_000,
    providerTimeBudgetMs: 2_700_000,
    maxDailyDecisions: scenario.totalDays,
    completionBackoffScheduleMs: [0, 0],
    ...overrides,
  };
}

test("completion prompt prioritizes a valid concise selection over exhaustive search", () => {
  assert.match(COMPLETION_SYSTEM_INSTRUCTION, /valid selection is more important/i);
  assert.match(COMPLETION_SYSTEM_INSTRUCTION, /Do not enumerate or compare every supplied plan/i);
  assert.match(COMPLETION_SYSTEM_INSTRUCTION, /Reserve enough output for the final answer/i);
  assert.match(COMPLETION_SYSTEM_INSTRUCTION, /Return JSON only with exactly two fields/i);
});

test("daily-plan candidates are deterministic, bounded, deduplicated and executable", () => {
  const scenario = shortScenario(3, "candidates");
  const environment = new GameEnvironment();
  environment.reset(episodeConfig(scenario, "candidates"));
  const first = generateDailyPlanOptions(environment);
  const second = generateDailyPlanOptions(environment);
  assert.deepEqual(first, second);
  assert.ok(first.plans.length > 1 && first.plans.length <= 128);
  assert.equal(new Set(first.plans.map(plan => plan.resultingStateHash)).size, first.plans.length);
  assert.equal(first.destinationIds.length, 20);
  assert.deepEqual(first.destinationIds, Array.from({ length: 20 }, (_, index) => index));
  assert.deepEqual(first.plans[0].actions, []);
  assert.ok(first.plans.every((plan, index) => (
    plan.id === `P${String(index + 1).padStart(3, "0")}`
    && plan.actions.length <= 2
    && plan.actions.every(action => action.type !== "move")
    && environment.previewActions(plan.actions).success
  )));
  const deposits = first.plans
    .filter(plan => plan.actions.length === 1)
    .flatMap(plan => plan.actions)
    .filter(action => action.type === "deposit")
    .map(action => action.amount);
  assert.ok([500, 1_000, 2_000].every(amount => deposits.includes(amount)));
  assert.equal(JSON.stringify(first).includes("assisted_pass_day"), false);

  for (const [index, plan] of first.plans.entries()) {
    const isolated = new GameEnvironment();
    isolated.reset(episodeConfig(scenario, `candidate-${index}`));
    const result = isolated.executeDailyPlan(plan.actions, first.destinationIds[0]);
    assert.equal(result.success, true);
    assert.equal(result.events.length, plan.actions.length + 1);
  }
});

test("daily-plan commit is atomic and one model call can link every committed action", () => {
  const scenario = shortScenario(3, "atomic");
  const environment = new GameEnvironment();
  environment.reset(episodeConfig(scenario, "atomic"));
  environment.step({ type: "move", locationId: 0 });
  const before = environment.observe();
  const eventCount = environment.eventLog.length;
  const rejected = environment.executeDailyPlan([
    { type: "deposit", amount: 100 },
    { type: "withdraw", amount: 999_999 },
  ], 1);
  assert.equal(rejected.success, false);
  assert.deepEqual(environment.observe(), before);
  assert.equal(environment.eventLog.length, eventCount);

  const prevalidated = environment.previewDailyPlan([
    { type: "deposit", amount: 100 },
    { type: "withdraw", amount: 50 },
  ], 1);
  assert.equal(prevalidated.success, true);
  const mismatched = environment.executeDailyPlan([
    { type: "deposit", amount: 100 },
    { type: "withdraw", amount: 50 },
  ], 1, undefined, `sha256:${"0".repeat(64)}`);
  assert.equal(mismatched.success, false);
  assert.deepEqual(environment.observe(), before);
  assert.equal(environment.eventLog.length, eventCount);

  const evidence = {
    modelCallId: "model-call_atomic",
    fullContextHash: `sha256:${"a".repeat(64)}`,
  };
  const committed = environment.executeDailyPlan([
    { type: "deposit", amount: 100 },
    { type: "withdraw", amount: 50 },
  ], 1, evidence, integrityHash(prevalidated.after));
  assert.equal(committed.success, true);
  assert.equal(committed.events.length, 3);
  assert.ok(committed.events.every(event => event.modelCallId === evidence.modelCallId));
  assert.ok(committed.events.every(event => event.fullContextHash === evidence.fullContextHash));
  assert.equal(committed.events[0].observationHash, before.observationHash);
  assert.notEqual(committed.events[1].observationHash, before.observationHash);
  assert.equal(committed.after.day, before.state.day + 1);
});

test("assisted pass-day shares settlement with move while preserving location and map", () => {
  const scenario = shortScenario(4, "settlement");
  const moving = new GameEnvironment();
  const assisted = new GameEnvironment();
  const shared = episodeConfig(scenario, "settlement");
  moving.reset({ ...shared, episodeId: "completion-settlement:moving" });
  assisted.reset({ ...shared, episodeId: "completion-settlement:assisted" });
  moving.step({ type: "move", locationId: 0 });
  assisted.step({ type: "move", locationId: 0 });
  const moved = moving.step({ type: "move", locationId: 10 });
  const passed = assisted.assistPassDay({
    policyVersion: "assisted-pass-day-v1",
    reason: "transient_retries_exhausted",
    failureCategory: "transport_error",
    triggerModelCallIds: ["model-call_settlement"],
  });
  assert.equal(moved.success, true);
  assert.equal(passed.success, true);
  assert.deepEqual(moved.event.result.effects, passed.event.result.effects);
  const omitLocality = state => {
    const { currentLocation, currentMap, market, ...shared } = state;
    return shared;
  };
  assert.deepEqual(omitLocality(moved.after), omitLocality(passed.after));
  assert.equal(moved.after.currentLocation, 10);
  assert.equal(passed.after.currentLocation, 0);
  assert.equal(passed.event.type, "assistance");
  assert.equal(passed.event.action.type, "assisted_pass_day");
  assert.equal(passed.event.modelCallId, undefined);
});

test("completion recovery uses 15s/45s virtual backoff and three total attempts", async () => {
  const sleeps = [];
  let now = 0;
  let requests = 0;
  const driver = completionDriver(0, async () => {
    requests++;
    throw new DirectProviderRequestError(
      "completion-provider-0",
      "transport_error",
      "safe transport failure",
    );
  });
  const output = await runEpisode(assistedEpisodeOptions(shortScenario(1, "backoff"), driver, {
    completionBackoffScheduleMs: [15_000, 45_000],
    completionClock: {
      now: () => now,
      async sleep(milliseconds) {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    },
  }));
  assert.equal(requests, 3);
  assert.deepEqual(sleeps, [15_000, 45_000]);
  assert.equal(output.report.reliability.providerWaitMs, 60_000);
  assert.equal(output.report.reliability.assistedDays, 1);
  assert.equal(output.trace.finalResult.status, "completed");
  assert.deepEqual(
    output.report.requestMetrics.calls.map(call => [call.retryReason, call.assistanceEventId !== null]),
    [["transport_error", false], ["transport_error", false], [null, true]],
  );
});

test("three transient assisted days escalate through 2/4/8-day circuits with half-open checks", async () => {
  let requests = 0;
  const driver = completionDriver(0, async () => {
    requests++;
    throw new DirectProviderRequestError(
      "completion-provider-0",
      "transport_error",
      "safe transport failure",
    );
  });
  const output = await runEpisode(assistedEpisodeOptions(shortScenario(20, "circuit"), driver));
  assert.equal(output.trace.finalResult.status, "completed");
  assert.equal(output.trace.finalResult.rankEligible, true);
  assert.equal(requests, 12);
  assert.equal(output.report.reliability.assistedDays, 20);
  assert.equal(output.report.reliability.circuitSkippedDays, 14);
  assert.deepEqual(output.report.reliability.assistanceReasons, {
    transient_retries_exhausted: 6,
    circuit_open: 14,
  });
  assert.deepEqual(
    output.trace.events
      .filter(event => event.assistance?.reason === "circuit_open")
      .map(event => event.assistance.circuitSkipDaysRemaining),
    [1, 0, 3, 2, 1, 0, 7, 6, 5, 4, 3, 2, 1, 0],
  );
  assert.ok(output.trace.events
    .filter(event => event.assistance?.reason === "circuit_open")
    .every(event => event.assistance.failureCategory === "transport_error"));
});

test("invalid plan selection repairs immediately without an assisted day", async () => {
  let requests = 0;
  const driver = completionDriver(0, async input => {
    requests++;
    if (requests === 1) {
      return { action: { planId: "P999", destinationId: input.decisionContract.destinationIds[0] } };
    }
    return firstPlan(input);
  });
  const output = await runEpisode(assistedEpisodeOptions(shortScenario(1, "repair"), driver));
  assert.equal(output.trace.finalResult.status, "completed");
  assert.equal(requests, 2);
  assert.equal(output.report.invalidActionCount, 1);
  assert.equal(output.report.recoveredDecisionCount, 1);
  assert.equal(output.report.reliability.autonomousDays, 1);
  assert.equal(output.report.reliability.assistedDays, 0);
  assert.equal(output.report.requestMetrics.calls[0].retryReason, "invalid_action");
  assert.ok(output.report.requestMetrics.calls[1].actionEventIds.length >= 1);
});

test("context limit and provider-budget exhaustion assist the remaining days without repeated calls", async () => {
  let contextRequests = 0;
  const contextDriver = completionDriver(0, async () => {
    contextRequests++;
    throw new DirectProviderRequestError(
      "completion-provider-0",
      "context_limit",
      "safe context failure",
    );
  });
  const contextOutput = await runEpisode(
    assistedEpisodeOptions(shortScenario(3, "context"), contextDriver),
  );
  assert.equal(contextRequests, 1);
  assert.equal(contextOutput.trace.finalResult.status, "completed");
  assert.deepEqual(contextOutput.report.reliability.assistanceReasons, {
    non_retryable_failure: 3,
  });
  const firstContextAssistance = contextOutput.trace.events.find(event => event.type === "assistance");
  assert.equal(firstContextAssistance.stateBefore.currentLocation, null);
  assert.equal(firstContextAssistance.stateAfter.currentLocation, null);

  let budgetRequests = 0;
  const budgetDriver = completionDriver(0, async () => {
    budgetRequests++;
    throw new DirectProviderRequestError(
      "completion-provider-0",
      "transport_error",
      "safe transport failure",
    );
  });
  const budgetOutput = await runEpisode(assistedEpisodeOptions(
    shortScenario(3, "budget"),
    budgetDriver,
    {
      providerTimeBudgetMs: 1,
      completionBackoffScheduleMs: [15, 45],
      completionClock: { now: () => 0, sleep: async () => assert.fail("budget must prevent sleep") },
    },
  ));
  assert.equal(budgetRequests, 1);
  assert.equal(budgetOutput.trace.finalResult.status, "completed");
  assert.equal(budgetOutput.report.reliability.providerBudgetExhaustedDays, 3);
  assert.deepEqual(budgetOutput.report.reliability.assistanceReasons, {
    provider_time_budget_exhausted: 3,
  });
  const budgetAssistance = budgetOutput.trace.events
    .filter(event => event.assistance?.reason === "provider_time_budget_exhausted");
  assert.equal(budgetAssistance.length, 3);
  assert.ok(budgetAssistance.every(event => event.assistance.triggerModelCallIds.length === 1));
  assert.equal(new Set(budgetAssistance.map(event => event.assistance.triggerModelCallIds[0])).size, 1);
});

test("an assisted day can end in natural death without becoming a technical DNF", async () => {
  const scenario = Object.freeze({
    ...shortScenario(20, "assisted-death"),
    debtInterestRate: 1,
    bankInterestRate: 0,
  });
  const driver = completionDriver(0, async () => {
    throw new DirectProviderRequestError(
      "completion-provider-0",
      "context_limit",
      "safe permanent failure",
    );
  });
  const output = await runEpisode(assistedEpisodeOptions(scenario, driver));
  assert.equal(output.trace.finalResult.status, "dead");
  assert.equal(output.trace.finalResult.endDay, 8);
  assert.equal(output.trace.finalResult.rankEligible, true);
  assert.equal(output.report.technicalFailure, undefined);
  assert.equal(output.report.reliability.assistedDays, 8);
  const terminalAssistance = output.trace.events.find(event => (
    event.type === "assistance" && event.stateAfter.status === "dead"
  ));
  assert.equal(terminalAssistance.day, 8);
});

test("unknown driver failures remain fail-closed Runner defects", async () => {
  const driver = completionDriver(0, async () => {
    throw new Error("simulated adapter defect");
  });
  const output = await runEpisode(assistedEpisodeOptions(shortScenario(3, "defect"), driver));
  assert.equal(output.trace.finalResult.status, "runtime_error");
  assert.equal(output.trace.finalResult.rankEligible, false);
  assert.equal(output.report.reliability.assistedDays, 0);
  assert.equal(output.report.technicalFailure.domain, "runner");
  assert.equal(output.report.technicalFailure.countsTowardModelFailure, false);
});

test("all unavailable Providers still produce a natural Replay with explicit assistance", async () => {
  const scenario = shortScenario(6, "all-unavailable");
  const drivers = Array.from({ length: 5 }, (_, index) => completionDriver(index, async () => {
    throw new DirectProviderRequestError(
      `completion-provider-${index}`,
      "context_limit",
      "safe permanent provider failure",
    );
  }));
  const output = await runMatch({
    matchId: "completion-all-unavailable",
    seed: 20260822,
    scenario,
    drivers,
    completionAssisted: true,
    decisionTimeoutMs: 120_000,
    providerTimeBudgetMs: 2_700_000,
    maxDailyDecisionsPerAgent: scenario.totalDays,
  });
  assert.ok(output.replay.agents.every(agent => agent.finalResult.rankEligible));
  assert.ok(output.replay.agents.every(agent => agent.status === "completed"));
  assert.equal(output.replay.reliabilityAudit.policyVersion, "completion-reliability-v1");
  assert.ok(output.replay.reliabilityAudit.agents.every(agent => agent.assistedDays === 6));
  assert.equal(output.replay.days.flatMap(day => day.events).filter(event => event.type === "assistance").length, 30);

  const forgedReliability = structuredClone(output.replay.reliabilityAudit);
  forgedReliability.agents[0].autonomousDayRate = 50;
  assert.throws(() => assembleMatchReplay(
    "completion-all-unavailable",
    output.traces,
    scenario,
    output.replay.competitionAudit,
    forgedReliability,
  ), /可靠性审计无法与 Trace 对账/);

  const forgedTraces = structuredClone(output.traces);
  const forgedAssistance = forgedTraces[0].events.find(event => event.type === "assistance");
  forgedAssistance.assistance.reason = "forged_reason";
  const { traceHash: _traceHash, ...forgedTraceBody } = forgedTraces[0];
  forgedTraces[0].traceHash = integrityHash(forgedTraceBody);
  assert.throws(() => assembleMatchReplay(
    "completion-all-unavailable",
    forgedTraces,
    scenario,
    output.replay.competitionAudit,
    output.replay.reliabilityAudit,
  ), /assistance 事件状态语义无效/);
});

test("healthy five-model Assisted Match emits v6 report, multi-action links and reliability facts", async () => {
  const scenario = shortScenario(3, "report");
  const drivers = Array.from({ length: 5 }, (_, index) => completionDriver(index, async input => ({
    action: {
      planId: input.decisionContract.planIds.at(-1),
      destinationId: input.decisionContract.destinationIds[0],
    },
    usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
  })));
  const output = await runMatch({
    matchId: "completion-report",
    seed: 20260822,
    scenario,
    drivers,
    completionAssisted: true,
    decisionTimeoutMs: 120_000,
    providerTimeBudgetMs: 2_700_000,
    maxDailyDecisionsPerAgent: scenario.totalDays,
  });
  const reportOptions = {
    matchId: "completion-report",
    seed: 20260822,
    maxActionsPerAgent: 160,
    decisionTimeoutMs: 120_000,
    totalWallClockMs: 1,
    maxOutputTokens: 128,
    completionAssisted: true,
    maxDailyDecisionsPerAgent: scenario.totalDays,
    providerTimeBudgetMs: 2_700_000,
    probeSummaryHash: `sha256:${"1".repeat(64)}`,
    probeCreatedAt: "2026-08-22T00:00:00.000Z",
    stabilitySummaryHash: `sha256:${"2".repeat(64)}`,
    stabilityCreatedAt: "2026-08-22T00:10:00.000Z",
  };
  const report = buildDirectRunReport(reportOptions, output);
  assert.equal(output.replay.competitionAudit.runTrack, COMPLETION_RUN_TRACK);
  assert.equal(report.artifactType, "arena-direct-run-report-v6");
  assert.equal(report.runTrack, COMPLETION_RUN_TRACK);
  assert.equal(report.totals.reliability.assistedDays, 0);
  assert.equal(report.totals.reliability.retryCount, 0);
  assert.equal(report.limits.maxActionsPerAgent, scenario.totalDays * 3);
  assert.equal(report.totals.reliability.autonomousDays, 15);
  assert.ok(report.agents.every(agent => agent.reliability.autonomousDayRate === 100));
  assert.ok(report.agents.some(agent => agent.modelCalls.some(call => call.actionEventIds.length > 1)));
  assert.equal(report.limits.maxModelRequests, 45);

  const forgedOutput = structuredClone(output);
  const forgedCall = forgedOutput.report.episodeReports
    .flatMap(episode => episode.requestMetrics.calls)
    .find(call => call.actionEventIds.length > 1);
  forgedCall.actionEventIds.pop();
  assert.throws(
    () => buildDirectRunReport(reportOptions, forgedOutput),
    /整日动作账本不完整/,
  );
});

function gateDrivers() {
  return Array.from({ length: 5 }, (_, index) => completionDriver(index, firstPlan));
}

function assistedFingerprint(drivers, scenario, matchId) {
  return computeProbeConfigFingerprint({
    matchId,
    seed: 20260822,
    scenario,
    agents: drivers.map((driver, entryIndex) => ({
      entryIndex,
      provider: driver.descriptor.provider,
      model: driver.descriptor.model,
      providerAdapterVersion: driver.descriptor.providerAdapterVersion,
      endpointFingerprint: integrityHash({ endpoint: entryIndex }),
      declaredModelRevision: null,
      thinkingMode: "enabled",
      reasoningEffort: "low",
    })),
    maxActionsPerAgent: 160,
    decisionTimeoutMs: 120_000,
    totalWallClockMs: 19_200_000,
    maxOutputTokens: 128,
    slotRotationIndex: 0,
    completionAssisted: true,
    providerTimeBudgetMs: 2_700_000,
    maxDailyDecisionsPerAgent: scenario.totalDays,
  });
}

test("Assisted Probe and ten-autonomous-day Stability use isolated gate artifacts", async () => {
  const scenario = shortScenario(12, "gates");
  const matchId = "completion-gates";
  const probeDriversSet = gateDrivers();
  const fingerprint = assistedFingerprint(probeDriversSet, scenario, matchId);
  const probe = await probeProviders({
    matchId,
    seed: 20260822,
    scenario,
    drivers: probeDriversSet,
    decisionTimeoutMs: 120_000,
    slotRotationIndex: 0,
    configFingerprint: fingerprint,
    completionAssisted: true,
    createdAt: "2026-08-22T00:00:00.000Z",
  });
  assert.equal(probe.artifactType, "arena-provider-probe-v4");
  assert.equal(probe.runTrack, COMPLETION_RUN_TRACK);
  assert.equal(probe.requestCount, 5);
  assert.ok(probe.entries.every(entry => entry.action === null && entry.dailyPlanSelection));
  assert.doesNotThrow(() => assertMatchingProviderProbe(probe, fingerprint, true));

  const output = await runMatch({
    matchId,
    seed: 20260822,
    scenario,
    drivers: gateDrivers(),
    completionAssisted: true,
    decisionTimeoutMs: 120_000,
    providerTimeBudgetMs: 2_700_000,
    maxDailyDecisionsPerAgent: 10,
  });
  const stability = buildProviderStabilityResult(
    output,
    fingerprint,
    probe,
    "2026-08-22T00:10:00.000Z",
  );
  assert.equal(stability.artifactType, "arena-provider-stability-v2");
  assert.equal(stability.runTrack, COMPLETION_RUN_TRACK);
  assert.equal(stability.passed, true);
  assert.ok(stability.entries.every(entry => entry.autonomousDays === 10 && entry.assistedDays === 0));
  assert.doesNotThrow(() => assertMatchingProviderStability(stability, fingerprint, probe));

  const waivedBody = structuredClone(stability);
  delete waivedBody.stabilitySummaryHash;
  waivedBody.passed = false;
  waivedBody.entries[0].passed = false;
  waivedBody.entries[0].autonomousDays = 9;
  waivedBody.entries[0].assistedDays = 1;
  const waived = {
    ...waivedBody,
    stabilitySummaryHash: integrityHash(waivedBody),
  };
  assert.throws(
    () => assertMatchingProviderStability(waived, fingerprint, probe),
    /Stability Probe 摘要/,
  );
  assert.doesNotThrow(() => assertMatchingProviderStability(
    waived,
    fingerprint,
    probe,
    { allowAssistedDays: true },
  ));

  const incompleteBody = structuredClone(waivedBody);
  incompleteBody.entries[0].autonomousDays = 8;
  const incomplete = {
    ...incompleteBody,
    stabilitySummaryHash: integrityHash(incompleteBody),
  };
  assert.throws(
    () => assertMatchingProviderStability(
      incomplete,
      fingerprint,
      probe,
      { allowAssistedDays: true },
    ),
    /Stability Probe 摘要/,
  );
});
