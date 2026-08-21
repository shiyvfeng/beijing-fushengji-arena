import assert from "node:assert/strict";
import test from "node:test";

import { adaptCoreMatchReplay, loadReplaySource } from "../src/replay-adapter.ts";
import { integrityHash } from "../src/replay-integrity.ts";
import { coreReplayFixture, rehashReplay } from "./fixtures/core-replay.ts";

test("browser-side canonical SHA-256 matches the core implementation vector", () => {
  assert.equal(
    integrityHash({ z: [1, "北京", true], a: { n: -0, x: "浮生记" } }),
    "sha256:2749de87e1603e30b5b9ea1cbbd892c42bba0595ac836bdc6b1f7fab5cf863a7",
  );
});

test("adapter exposes real Direct identity, full action sequences and classified DNF", () => {
  const core = coreReplayFixture();
  const replay = adaptCoreMatchReplay(core);
  assert.equal(replay.executionMode, "direct");
  assert.equal(replay.agentProfiles[0].provider, "provider-0");
  assert.equal(replay.agentProfiles[0].model, "model-0");
  assert.equal(replay.agentProfiles[0].adapterVersion, "adapter-0-v2");
  assert.equal(replay.competitionAudit?.decisionPolicyId, "neutral-v1");
  assert.equal(replay.competitionAudit?.personalRandomization, "slot-isolated");
  assert.equal(replay.days[0].actions.filter(action => action.agentId === "A").length, 2);
  assert.deepEqual(
    replay.days[0].actions.filter(action => action.agentId === "A").map(action => action.result),
    ["Agent 0 动作 1 结果", "Agent 0 动作 2 结果"],
  );
  const dnf = replay.days[11].agents.find(agent => agent.agentId === "D");
  assert.equal(dnf?.status, "runtime_error");
  assert.equal(dnf?.exitDay, 12);
  assert.equal(dnf?.technicalFailure?.category, "http_error");
  assert.equal(replay.finalResults.find(result => result.agentId === "D")?.rank, null);
});

test("public effects deduplicate across traces and personal effects stay out of public events", () => {
  const replay = adaptCoreMatchReplay(coreReplayFixture());
  assert.equal(replay.days[1].publicEvents.length, 1);
  assert.equal(replay.days[1].publicEvents[0].summary, "全场公开价格波动");
  assert.equal(replay.days[4].publicEvents.length, 0);
  assert.equal(JSON.stringify(replay.days[4].publicEvents).includes("个人现金损失"), false);
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
  assert.throws(() => adaptCoreMatchReplay(mismatchedPolicy), /中性决策策略/);

  const missingIdentity = coreReplayFixture();
  delete missingIdentity.agents[2].provider;
  rehashReplay(missingIdentity);
  assert.throws(() => adaptCoreMatchReplay(missingIdentity), /provider/);

  const nonFinite = coreReplayFixture();
  nonFinite.days[7].agentSnapshots[2].state.cash = Number.NaN;
  nonFinite.replayHash = `sha256:${"0".repeat(64)}`;
  assert.throws(() => adaptCoreMatchReplay(nonFinite), /完整性|有限数值/);
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
