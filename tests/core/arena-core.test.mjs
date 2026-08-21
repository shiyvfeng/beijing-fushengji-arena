import assert from "node:assert/strict";
import test from "node:test";

import { GameEnvironment } from "../../dist/core/game-environment.js";
import { BASE_EVENT_CATALOG } from "../../dist/core/event-catalog.js";
import { SeededRng } from "../../dist/core/random/seeded-rng.js";
import { DEFAULT_SCENARIO } from "../../dist/core/scenario.js";
import { findPotentialSecrets } from "../../dist/core/secret-scan.js";
import { integrityHash, stableStringify } from "../../dist/core/stable-value.js";
import { runEpisode } from "../../dist/arena/episode-runner.js";
import { runMatch, runSampleScriptedMatch } from "../../dist/arena/match-runner.js";
import { assembleMatchReplay } from "../../dist/arena/replay.js";
import { createSampleScriptedDrivers } from "../../dist/arena/scripted-driver.js";

function episodeConfig(slot = 0) {
  return {
    matchId: "core-test-match",
    episodeId: `core-test-match:slot-${slot}`,
    agentId: `agent-${slot}`,
    agentSlot: slot,
    seed: 424242,
    scenario: DEFAULT_SCENARIO,
  };
}

function runMoveTrace(slot = 0) {
  const environment = new GameEnvironment();
  environment.reset(episodeConfig(slot));
  for (let day = 0; day < 40; day++) {
    const current = environment.observe().state.currentLocation;
    let destination = (day + slot * 3) % 20;
    if (destination === current) destination = (destination + 1) % 20;
    environment.step({ type: "move", locationId: destination });
    if (environment.observe().state.status !== "running") break;
  }
  const firstFinal = environment.finalize();
  const secondFinal = environment.finalize();
  return { environment, firstFinal, secondFinal };
}

function exportMoveTrace(slot = 0) {
  const { environment } = runMoveTrace(slot);
  return environment.exportTrace({
    id: `agent-${slot}`,
    displayName: `测试 Agent ${slot}`,
    slot,
    driver: "scripted",
  });
}

function rehashTrace(trace) {
  const copy = structuredClone(trace);
  const { traceHash: _, ...body } = copy;
  copy.traceHash = integrityHash(body);
  return copy;
}

test("arena-rng-v1 has fixed named-stream vectors", () => {
  const rng = new SeededRng(12345, "test");
  assert.equal(rng.uint32("public.market.base", 1, 0), 814513214);
  assert.equal(rng.uint32("personal.health.event", 2, 7), 1317913716);
  assert.equal(rng.int("public.market.event", 950, "s", 40, 17), 203);
  assert.equal(rng.stream("vector").nextUint32(), 1104581569);
});

test("all 37 legacy events have stable catalog IDs", () => {
  assert.equal(BASE_EVENT_CATALOG.length, 37);
  assert.equal(new Set(BASE_EVENT_CATALOG.map(event => event.id)).size, 37);
  assert.ok(BASE_EVENT_CATALOG.every(event => /^(market|health|cash)-\d{2}$/.test(event.id)));
});

test("canonical Arena JSON rejects non-finite numbers", () => {
  assert.throws(() => stableStringify({ value: Number.NaN }), /rejects NaN/);
  assert.throws(() => stableStringify({ value: Number.POSITIVE_INFINITY }), /rejects NaN/);
  assert.throws(() => stableStringify({ value: undefined }), /rejects undefined/);
});

test("same config and action trace are byte-for-byte deterministic", () => {
  const first = runMoveTrace();
  const second = runMoveTrace();
  const descriptor = { id: "agent-0", displayName: "测试 Agent", slot: 0, driver: "scripted" };
  const firstTrace = first.environment.exportTrace(descriptor);
  const secondTrace = second.environment.exportTrace(descriptor);

  assert.deepEqual(firstTrace, secondTrace);
  assert.equal(firstTrace.traceHash, integrityHash((({ traceHash: _, ...body }) => body)(firstTrace)));
  assert.ok(firstTrace.events.every(event => event.id === event.evidenceId));
  assert.ok(firstTrace.events.every(event => event.contextHash.startsWith("sha256:")));
});

test("observe and invalid calls do not consume public randomness", () => {
  const baseline = new GameEnvironment();
  const noisy = new GameEnvironment();
  baseline.reset(episodeConfig(0));
  noisy.reset(episodeConfig(0));

  noisy.observe();
  noisy.observe();
  const rejected = noisy.step({ type: "not-a-real-action", surprise: true });
  assert.equal(rejected.success, false);
  assert.equal(rejected.code, "invalid_action");

  const cleanStep = baseline.step({ type: "move", locationId: 1 });
  const noisyStep = noisy.step({ type: "move", locationId: 1 });
  assert.deepEqual(cleanStep.after, noisyStep.after);
  assert.deepEqual(
    baseline.publicReferencePriceForDay(40),
    noisy.publicReferencePriceForDay(40),
  );
});

test("public price stream is shared while personal streams are slot-isolated", () => {
  const first = new GameEnvironment();
  const second = new GameEnvironment();
  first.reset(episodeConfig(0));
  second.reset(episodeConfig(1));

  for (let day = 1; day <= 40; day++) {
    assert.deepEqual(
      first.publicReferencePriceForDay(day),
      second.publicReferencePriceForDay(day),
    );
  }
  const firstMove = first.step({ type: "move", locationId: 1 });
  const secondMove = second.step({ type: "move", locationId: 1 });
  assert.deepEqual(firstMove.after.publicReferencePrice, secondMove.after.publicReferencePrice);
});

test("finalize settles once, locks state and returns the same immutable result", () => {
  const { environment, firstFinal, secondFinal } = runMoveTrace();
  assert.strictEqual(firstFinal, secondFinal);
  assert.ok(Object.isFrozen(firstFinal));
  assert.ok(Object.isFrozen(firstFinal.finalState));
  assert.equal(firstFinal.finalNetWorth, firstFinal.cash + firstFinal.bank - firstFinal.debt);

  const eventCount = environment.eventLog.length;
  const rejected = environment.step({ type: "move", locationId: 10 });
  assert.equal(rejected.code, "episode_terminated");
  assert.equal(environment.eventLog.length, eventCount);
  assert.strictEqual(environment.finalize(), firstFinal);
});

test("sample runner emits four 40-day traces and a stable recoverable replay", async () => {
  const first = await runSampleScriptedMatch(20260820);
  const second = await runSampleScriptedMatch(20260820);

  assert.equal(first.traces.length, 4);
  assert.ok(first.traces.every(trace => trace.finalResult.endDay === 40));
  assert.ok(first.traces.every(trace => trace.finalResult.status === "completed"));
  assert.ok(first.traces.every(trace => trace.driver === "scripted"));
  assert.equal(first.replay.days.length, 40);
  assert.deepEqual(first.replay.days.map(day => day.day), Array.from({ length: 40 }, (_, index) => index + 1));
  assert.ok(first.replay.days.every(day => day.agentSnapshots.length === 4));
  assert.ok(first.traces.every(trace => (
    JSON.stringify(trace.finalResult.publicReferencePrice)
      === JSON.stringify(first.traces[0].finalResult.publicReferencePrice)
  )));
  assert.equal(first.replay.replayHash, second.replay.replayHash);
  assert.deepEqual(first.replay, second.replay);
  const { replayHash, ...replayBody } = first.replay;
  assert.equal(replayHash, integrityHash(replayBody));
  assert.ok(first.replay.configHash.startsWith("sha256:"));
  assert.ok(first.replay.eventHash.startsWith("sha256:"));
  assert.ok(first.replay.factHash.startsWith("sha256:"));
  assert.equal(first.replay.competitionAudit, undefined);
  assert.equal(first.replay.luckAudit.basis, "personal-event-count-v1");
  assert.equal(first.replay.luckAudit.revealDay, 40);
  assert.equal(first.replay.luckAudit.agents.length, 4);
  for (const trace of first.traces) {
    const evidence = new Map();
    for (const event of trace.events) {
      for (const effect of event.result.effects) {
        if (effect.scope !== "personal" || !effect.catalogEventId || !effect.sourceRandomStream) continue;
        const key = `${event.id}|${effect.catalogEventId}|${effect.sourceRandomStream}`;
        const group = evidence.get(key) ?? [];
        group.push(effect);
        evidence.set(key, group);
      }
    }
    const expected = { favorable: 0, adverse: 0 };
    for (const effects of evidence.values()) {
      const adverse = effects.some(effect => (
        effect.kind === "cash" && (effect.amount ?? 0) < 0
        || effect.kind === "health" && (effect.amount ?? 0) < 0
        || effect.kind === "debt" && (effect.amount ?? 0) > 0
      ));
      const gift = effects.some(effect => effect.kind === "inventory" && (effect.amount ?? 0) > 0);
      if (adverse) expected.adverse++;
      else if (gift) expected.favorable++;
    }
    const actual = first.replay.luckAudit.agents.find(agent => agent.agentId === trace.agentId);
    assert.equal(actual.adverseEvents, expected.adverse);
    assert.equal(actual.favorableEvents, expected.favorable);
  }
  assert.equal(first.report.executionMode, "scripted");
});

test("one scripted Agent runtime failure is isolated and excluded from ranking", async () => {
  const drivers = createSampleScriptedDrivers();
  const failedId = drivers[1].descriptor.id;
  drivers[1] = {
    descriptor: drivers[1].descriptor,
    decide() {
      throw new Error("故障注入");
    },
  };

  const output = await runMatch({
    matchId: "failure-isolation-test",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
  });
  const failed = output.traces.find(trace => trace.agentId === failedId);
  assert.equal(output.traces.length, 4);
  assert.equal(failed?.finalResult.status, "runtime_error");
  assert.equal(failed?.finalResult.rankEligibility, "technical_dnf");
  assert.equal(output.replay.agents.find(agent => agent.id === failedId)?.rank, null);
  assert.ok(output.traces.filter(trace => trace.agentId !== failedId).every(trace => trace.finalResult.status !== "runtime_error"));
  assert.ok(!output.replay.finalRanking.some(entry => entry.agentId === failedId));
});

test("driver reset and decide timeouts become isolated model_timeout results", async () => {
  let resetSignalAborted = false;
  const resetTimeout = await runEpisode({
    matchId: "reset-timeout-test",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    resetTimeoutMs: 15,
    decisionTimeoutMs: 100,
    driver: {
      descriptor: { id: "hung-reset", displayName: "挂起初始化", slot: 0, driver: "scripted" },
      reset({ signal }) {
        signal.addEventListener("abort", () => { resetSignalAborted = true; }, { once: true });
        return new Promise(() => {});
      },
      decide() {
        return { type: "move", locationId: 1 };
      },
    },
  });
  assert.equal(resetTimeout.trace.finalResult.status, "model_timeout");
  assert.equal(resetTimeout.report.timeoutPhase, "reset");
  assert.equal(resetSignalAborted, true);

  const drivers = createSampleScriptedDrivers();
  const timedOutAgentId = drivers[2].descriptor.id;
  let decideSignalAborted = false;
  drivers[2] = {
    descriptor: drivers[2].descriptor,
    decide({ signal }) {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          decideSignalAborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    },
  };
  const match = await runMatch({
    matchId: "decision-timeout-test",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    decisionTimeoutMs: 15,
  });
  const timedOut = match.traces.find(trace => trace.agentId === timedOutAgentId);
  assert.equal(timedOut?.finalResult.status, "model_timeout");
  assert.equal(match.report.episodeReports.find(report => report.agentId === timedOutAgentId)?.timeoutPhase, "decide");
  assert.equal(decideSignalAborted, true);
  assert.equal(match.replay.agents.find(agent => agent.id === timedOutAgentId)?.rank, null);
  assert.ok(match.traces.filter(trace => trace.agentId !== timedOutAgentId).every(trace => trace.finalResult.status !== "model_timeout"));
});

test("episode action limits reject unsafe values before invoking a driver", async () => {
  let driverCalls = 0;
  const driver = {
    descriptor: { id: "budget-test", displayName: "预算测试", slot: 0, driver: "scripted" },
    reset() { driverCalls++; },
    decide() {
      driverCalls++;
      return { type: "move", locationId: 1 };
    },
  };
  for (const maxActions of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 321]) {
    await assert.rejects(
      runEpisode({
        matchId: "invalid-action-budget-test",
        seed: 20260820,
        scenario: DEFAULT_SCENARIO,
        driver,
        maxActions,
      }),
      /maxActions/,
    );
  }
  assert.equal(driverCalls, 0);
});

test("assembler rejects rank semantics forged behind a recomputed trace hash", async () => {
  const driver = {
    descriptor: { id: "technical-dnf", displayName: "技术故障", slot: 0, driver: "scripted" },
    decide() {
      throw new Error("故障注入");
    },
  };
  const output = await runEpisode({
    matchId: "rank-forgery-test",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    driver,
  });
  const forged = structuredClone(output.trace);
  forged.finalResult.rankEligibility = "eligible";
  forged.finalResult.rankEligible = true;
  const rehashed = rehashTrace(forged);
  assert.throws(
    () => assembleMatchReplay("rank-forgery-test", [rehashed], DEFAULT_SCENARIO),
    /排名语义/,
  );
});

test("assembler binds traces to the complete canonical scenario", () => {
  const trace = exportMoveTrace();
  const alteredScenario = {
    ...DEFAULT_SCENARIO,
    bankInterestRate: DEFAULT_SCENARIO.bankInterestRate + 0.01,
  };
  assert.throws(
    () => assembleMatchReplay("core-test-match", [trace], alteredScenario),
    /scenario|configHash/,
  );
});

test("assembler rejects reordered, disconnected and identity-forged event chains", () => {
  const original = exportMoveTrace();
  const corruptions = [
    trace => {
      trace.events.reverse();
    },
    trace => {
      trace.events[1].sequence += 3;
    },
    trace => {
      trace.events[1].day = 40;
    },
    trace => {
      trace.events[1].evidenceId = "event_forged";
    },
    trace => {
      trace.events[1].agentId = "other-agent";
    },
    trace => {
      trace.events[1].stateBefore.cash += 1;
    },
    trace => {
      trace.finalResult.finalState.cash += 1;
      trace.finalResult.finalStateHash = integrityHash(trace.finalResult.finalState);
    },
  ];

  for (const corrupt of corruptions) {
    const forged = structuredClone(original);
    corrupt(forged);
    assert.throws(
      () => assembleMatchReplay("core-test-match", [rehashTrace(forged)], DEFAULT_SCENARIO),
      /EpisodeTrace|FinalResult/,
    );
  }
});

test("invalid actions and exported artifacts cannot retain credential-like fields", () => {
  const secret = "sk-super-secret-value-123456789";
  const environment = new GameEnvironment();
  environment.reset(episodeConfig());
  environment.step({
    type: "buy",
    itemId: 0,
    quantity: 1,
    apiKey: secret,
    authorization: `Bearer ${secret}`,
    prompt: secret,
    token: secret,
  });
  environment.step({
    type: "buy",
    itemId: Number.NaN,
    quantity: Number.POSITIVE_INFINITY,
    apiKey: secret,
    authorization: secret,
    prompt: secret,
    token: secret,
  });
  environment.finalize();
  const trace = environment.exportTrace({
    id: "agent-0",
    displayName: "安全测试 Agent",
    slot: 0,
    driver: "scripted",
  });
  const replay = assembleMatchReplay("core-test-match", [trace], DEFAULT_SCENARIO);
  const actionEvents = trace.events.filter(event => event.type === "action");

  assert.deepEqual(actionEvents[0].action, { type: "buy", itemId: 0, quantity: 1 });
  assert.deepEqual(actionEvents[1].action, { type: "buy" });
  assert.equal(findPotentialSecrets(trace).length, 0);
  assert.equal(findPotentialSecrets(replay).length, 0);
  assert.ok(!JSON.stringify(trace).includes(secret));
  assert.ok(!JSON.stringify(replay).includes(secret));
  assert.ok(findPotentialSecrets({ apiKey: secret, authorization: `Bearer ${secret}` }).length >= 2);
});
