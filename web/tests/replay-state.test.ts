import assert from "node:assert/strict";
import test from "node:test";

import { adaptCoreMatchReplay } from "../src/replay-adapter.ts";
import { createVisibleReplaySlice } from "../src/replay-state.ts";
import { coreReplayFixture } from "./fixtures/core-replay.ts";

test("Day 1 slice contains only Day 1 facts and no terminal or personal-event audit", () => {
  const replay = adaptCoreMatchReplay(coreReplayFixture());
  const visible = createVisibleReplaySlice(replay, 1);
  assert.deepEqual(visible.days.map(day => day.day), [1]);
  assert.equal(visible.latestDay.day, 1);
  assert.equal(visible.finalResults, undefined);
  assert.equal(visible.personalRandomEventAudit, undefined);
  assert.equal(JSON.stringify(visible).includes("最幸运"), false);
});

test("Day 39 keeps Day 40 settlement and personal-event counts locked", () => {
  const replay = adaptCoreMatchReplay(coreReplayFixture());
  const visible = createVisibleReplaySlice(replay, 39);
  assert.equal(visible.days.length, 39);
  assert.equal(visible.days.some(day => day.day === 40), false);
  assert.equal(visible.finalResults, undefined);
  assert.equal(visible.personalRandomEventAudit, undefined);
  assert.equal(JSON.stringify(visible).includes("luckiestAgentIds"), false);
});

test("Day 40 rankings are copied from core finalRanking and DNF has no rank", () => {
  const core = coreReplayFixture();
  const replay = adaptCoreMatchReplay(core);
  const visible = createVisibleReplaySlice(replay, 40);
  assert.equal(visible.days.length, 40);
  assert.equal(visible.latestDay.day, 40);
  assert.equal(visible.finalResults?.length, 5);
  for (const entry of core.finalRanking) {
    const final = visible.finalResults?.find(result => result.agentId === entry.agentId);
    assert.equal(final?.rank, entry.rank);
    assert.equal(final?.finalNetWorth, entry.finalNetWorth);
  }
  assert.equal(visible.finalResults?.find(result => result.agentId === "competitor-5")?.rank, null);
  assert.equal(visible.personalRandomEventAudit?.agents.length, 5);
  assert.equal("luckiestAgentIds" in visible.personalRandomEventAudit!, false);
});

test("visible day is clamped to the factual 1..40 range", () => {
  const replay = adaptCoreMatchReplay(coreReplayFixture());
  assert.equal(createVisibleReplaySlice(replay, -100).visibleThroughDay, 1);
  assert.equal(createVisibleReplaySlice(replay, 100).visibleThroughDay, 40);
});
