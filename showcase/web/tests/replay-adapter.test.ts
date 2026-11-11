import assert from "node:assert/strict";
import test from "node:test";

import { adaptCoreMatchReplay, loadReplaySource } from "../src/replay-adapter.ts";
import { integrityHash } from "../src/replay-integrity.ts";
import {
  completionReplayFixture,
  coreReplayFixture,
  rehashReplay,
} from "./fixtures/core-replay.ts";

test("browser-side canonical SHA-256 matches the core implementation vector", () => {
  assert.equal(
    integrityHash({ z: [1, "北京", true], a: { n: -0, x: "浮生记" } }),
    "sha256:2749de87e1603e30b5b9ea1cbbd892c42bba0595ac836bdc6b1f7fab5cf863a7",
  );
});

test("adapter exposes five Provider + Model identities, full actions and classified DNF", () => {
  const core = coreReplayFixture();
  const replay = adaptCoreMatchReplay(core);
  assert.equal(replay.executionMode, "direct");
  assert.equal(replay.agentProfiles[0].provider, "provider-0");
  assert.equal(replay.agentProfiles[0].model, "model-0");
  assert.equal(replay.agentProfiles[0].adapterVersion, "adapter-0-v3");
  assert.equal(replay.agentProfiles[0].label, "provider-0 + model-0");
  assert.equal(replay.agentProfiles.length, 5);
  assert.equal(replay.competitionAudit?.decisionPolicyId, "neutral-v1");
  assert.equal(replay.competitionAudit?.personalRandomization, "slot-isolated");
  assert.equal(replay.competitionAudit?.contextPolicyVersion, "bounded-history-v1");
  assert.equal(replay.competitionAudit?.recoveryPolicyVersion, "bounded-retry-v2");
  assert.equal(replay.days[0].actions.filter(action => action.agentId === "competitor-1").length, 2);
  assert.deepEqual(
    replay.days[0].actions.filter(action => action.agentId === "competitor-1").map(action => action.result),
    ["参赛者 0 动作 1 结果", "参赛者 0 动作 2 结果"],
  );
  const dnf = replay.days[11].agents.find(agent => agent.agentId === "competitor-5");
  assert.equal(dnf?.status, "runtime_error");
  assert.equal(dnf?.exitDay, 12);
  assert.equal(dnf?.technicalFailure?.category, "http_error");
  assert.equal(dnf?.technicalFailure?.domain, "provider");
  assert.equal(replay.finalResults.find(result => result.agentId === "competitor-5")?.rank, null);
  assert.equal("luckiestAgentIds" in replay.personalRandomEventAudit, false);
});

test("public effects deduplicate across traces and personal effects stay out of public events", () => {
  const replay = adaptCoreMatchReplay(coreReplayFixture());
  assert.equal(replay.days[1].publicEvents.length, 1);
  assert.equal(replay.days[1].publicEvents[0].summary, "全场公开价格波动");
  assert.equal(replay.days[4].publicEvents.length, 0);
  assert.equal(JSON.stringify(replay.days[4].publicEvents).includes("个人现金损失"), false);
});

test("adapter preserves public catalog event identity for deterministic artwork selection", () => {
  const core = coreReplayFixture();
  const effect = core.days[1].events[0].result.effects[0];
  effect.catalogEventId = "market-07";
  rehashReplay(core);
  const replay = adaptCoreMatchReplay(core);
  assert.equal(replay.days[1].publicEvents[0].catalogEventId, "market-07");
});

test("the same Reader preserves Strict behavior and exposes Assisted events and reliability", () => {
  const strict = adaptCoreMatchReplay(coreReplayFixture());
  assert.equal(strict.competitionAudit?.runTrack, undefined);
  assert.equal(strict.reliabilityAudit, undefined);
  assert.equal(strict.days[0].actions.some(action => action.assisted), false);

  const assisted = adaptCoreMatchReplay(completionReplayFixture());
  assert.equal(assisted.competitionAudit?.runTrack, "completion-assisted-v1");
  assert.equal(assisted.reliabilityAudit?.policyVersion, "completion-reliability-v1");
  assert.equal(assisted.reliabilityAudit?.agents[0].assistedDays, 1);
  const event = assisted.days[0].actions.find(action => action.agentId === "competitor-1");
  assert.equal(event?.summary, "Runner 辅助原地过日");
  assert.equal(event?.assisted, true);
  assert.equal(event?.assistanceReason, "transient_retries_exhausted");

  const missingReliability = completionReplayFixture();
  delete missingReliability.reliabilityAudit;
  rehashReplay(missingReliability);
  assert.throws(() => adaptCoreMatchReplay(missingReliability), /reliabilityAudit/);

  const forgedReliability = completionReplayFixture();
  forgedReliability.reliabilityAudit.agents[0].autonomousDayRate = 50;
  rehashReplay(forgedReliability);
  assert.throws(() => adaptCoreMatchReplay(forgedReliability), /无法与 Replay 事实对账/);

  const missingTrigger = completionReplayFixture();
  missingTrigger.days[0].events.find((event: any) => event.type === "assistance")
    .assistance.triggerModelCallIds = [];
  rehashReplay(missingTrigger);
  assert.throws(() => adaptCoreMatchReplay(missingTrigger), /辅助过日事件结构无效/);

  const forgedStrict = coreReplayFixture();
  forgedStrict.days[0].events[0].type = "assistance";
  forgedStrict.days[0].events[0].action = { type: "assisted_pass_day" };
  forgedStrict.days[0].events[0].assistance = {
    policyVersion: "assisted-pass-day-v1",
    reason: "circuit_open",
    triggerModelCallIds: [],
  };
  rehashReplay(forgedStrict);
  assert.throws(() => adaptCoreMatchReplay(forgedStrict), /Strict Replay/);
});

test("adapter verifies the canonical Replay hash before rendering", () => {
  const core = coreReplayFixture();
  const { replayHash, ...body } = core;
  assert.equal(replayHash, integrityHash(body));
  core.days[0].agentSnapshots[0].state.cash += 1;
  assert.throws(() => adaptCoreMatchReplay(core), /完整性校验失败/);
  rehashReplay(core);
  assert.equal(adaptCoreMatchReplay(core).days[0].agents[0].cash, 2_001);
});

test("adapter fails closed on schema, fairness, identity and state violations", () => {
  const badSchema = coreReplayFixture();
  badSchema.schemaVersion = "future-schema";
  assert.throws(() => adaptCoreMatchReplay(badSchema), /schemaVersion/);

  const mismatchedPolicy = coreReplayFixture();
  mismatchedPolicy.agents[0].decisionPolicyId = "persona-cup";
  rehashReplay(mismatchedPolicy);
  assert.throws(() => adaptCoreMatchReplay(mismatchedPolicy), /competitionAudit/);

  const missingIdentity = coreReplayFixture();
  delete missingIdentity.agents[2].provider;
  rehashReplay(missingIdentity);
  assert.throws(() => adaptCoreMatchReplay(missingIdentity), /provider/);

  const missingEffort = coreReplayFixture();
  delete missingEffort.agents[2].providerReasoningEffort;
  rehashReplay(missingEffort);
  assert.throws(() => adaptCoreMatchReplay(missingEffort), /providerReasoningEffort/);

  const nonFinite = coreReplayFixture();
  nonFinite.days[7].agentSnapshots[2].state.cash = Number.NaN;
  nonFinite.replayHash = `sha256:${"0".repeat(64)}`;
  assert.throws(() => adaptCoreMatchReplay(nonFinite), /完整性|有限数值/);

  const legacyPersona = coreReplayFixture();
  legacyPersona.agents[0].personaId = "legacy-persona";
  rehashReplay(legacyPersona);
  assert.throws(() => adaptCoreMatchReplay(legacyPersona), /禁止策略展示身份/);

  const wrongInternalId = coreReplayFixture();
  wrongInternalId.agents[0].id = "strategy-agent";
  rehashReplay(wrongInternalId);
  assert.throws(() => adaptCoreMatchReplay(wrongInternalId), /competitor-1\.\.\.5/);

  const mismatchedRotation = coreReplayFixture();
  [
    mismatchedRotation.competitionAudit.slotRotation.mappings[0].agentId,
    mismatchedRotation.competitionAudit.slotRotation.mappings[1].agentId,
  ] = [
    mismatchedRotation.competitionAudit.slotRotation.mappings[1].agentId,
    mismatchedRotation.competitionAudit.slotRotation.mappings[0].agentId,
  ];
  rehashReplay(mismatchedRotation);
  assert.throws(() => adaptCoreMatchReplay(mismatchedRotation), /cyclic-v1 映射无效/);

  const mismatchedAttemptBudget = coreReplayFixture();
  mismatchedAttemptBudget.competitionAudit.attemptTimeoutMs = 60_000;
  rehashReplay(mismatchedAttemptBudget);
  assert.throws(() => adaptCoreMatchReplay(mismatchedAttemptBudget), /预算无效/);

  const v2 = coreReplayFixture();
  v2.schemaVersion = "arena-schema-v2";
  rehashReplay(v2);
  assert.throws(() => adaptCoreMatchReplay(v2), /schemaVersion/);
});

test("formal loader reports missing Replay and never returns sample fallback", () => {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { getElementById: () => null },
  });
  try {
    const source = loadReplaySource();
    assert.equal(source.status, "error");
    assert.match(source.message, /缺少 Replay/);
    assert.equal("replay" in source, false);
  } finally {
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});
