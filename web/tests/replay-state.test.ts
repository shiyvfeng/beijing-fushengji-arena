import assert from "node:assert/strict";
import test from "node:test";

import { adaptCoreMatchReplay } from "../src/replay-adapter.ts";
import { createVisibleReplaySlice } from "../src/replay-state.ts";
import { coreReplayFixture } from "./fixtures/core-replay.ts";

test("Day 1 slice contains only Day 1 facts and no terminal or luck data", () => {
  const replay = adaptCoreMatchReplay(coreReplayFixture());
  const visible = createVisibleReplaySlice(replay, 1);
  assert.deepEqual(visible.days.map(day => day.day), [1]);
  assert.equal(visible.latestDay.day, 1);
  assert.equal(visible.finalResults, undefined);
  assert.equal(visible.luckAudit, undefined);
  assert.equal(JSON.stringify(visible).includes("最幸运"), false);
});

test("Day 39 keeps Day 40 settlement and luck labels locked", () => {
  const replay = adaptCoreMatchReplay(coreReplayFixture());
  const visible = createVisibleReplaySlice(replay, 39);
  assert.equal(visible.days.length, 39);
  assert.equal(visible.days.some(day => day.day === 40), false);
  assert.equal(visible.finalResults, undefined);
  assert.equal(visible.luckAudit, undefined);
  assert.equal(JSON.stringify(visible).includes("luckiestAgentIds"), false);
});

test("Day 40 rankings are copied from core finalRanking and DNF has no rank", () => {
  const core = coreReplayFixture();
  const replay = adaptCoreMatchReplay(core);
  const visible = createVisibleReplaySlice(replay, 40);
  assert.equal(visible.days.length, 40);
  assert.equal(visible.latestDay.day, 40);
  assert.equal(visible.finalResults?.length, 4);
  for (const entry of core.finalRanking) {
    const profile = replay.agentProfiles.find(agent => agent.coreId === entry.agentId)!;
    const final = visible.finalResults?.find(result => result.agentId === profile.id);
    assert.equal(final?.rank, entry.rank);
    assert.equal(final?.finalNetWorth, entry.finalNetWorth);
  }
  assert.equal(visible.finalResults?.find(result => result.agentId === "D")?.rank, null);
  assert.deepEqual(visible.luckAudit?.luckiestAgentIds, ["B"]);
  assert.deepEqual(visible.luckAudit?.unluckiestAgentIds, ["A"]);
});

test("visible day is clamped to the factual 1..40 range", () => {
  const replay = adaptCoreMatchReplay(coreReplayFixture());
  assert.equal(createVisibleReplaySlice(replay, -100).visibleThroughDay, 1);
  assert.equal(createVisibleReplaySlice(replay, 100).visibleThroughDay, 40);
});
