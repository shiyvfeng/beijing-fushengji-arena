import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  generateCuratedReplayEnrichment,
  generateReplayEnrichment,
  loadReplayEnrichmentSource,
  validateReplayEnrichment,
} from "../src/enrichment.ts";
import { adaptCoreMatchReplay } from "../src/replay-adapter.ts";
import { integrityHash } from "../src/replay-integrity.ts";
import type { ReplayArtifact } from "../src/replay-types.ts";
import { coreReplayFixture } from "./fixtures/core-replay.ts";

function replayFixture(): ReplayArtifact {
  return adaptCoreMatchReplay(coreReplayFixture());
}

function rehashEnrichment<T extends Record<string, unknown>>(artifact: T): T {
  const body = { ...artifact };
  delete body.enrichmentHash;
  artifact.enrichmentHash = integrityHash(body);
  return artifact;
}

test("programmatic highlights are byte-deterministic, ordered, evidenced and capped at eight featured items", () => {
  const replay = replayFixture();
  for (let day = 3; day <= 14; day++) {
    replay.days[day - 1].publicEvents.push({
      id: `extra-public-${day}`,
      title: `公开事件 ${day}`,
      summary: `第 ${day} 天公开结构化事件`,
    });
  }
  const first = generateReplayEnrichment(replay);
  const second = generateReplayEnrichment(replay);
  assert.deepEqual(first, second);
  assert.match(first.enrichmentHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.highlights.filter(item => item.featured).length, 8);
  assert.equal(first.highlights.slice(0, 8).every(item => item.featured), true);
  assert.equal(first.highlights.slice(8).every(item => !item.featured), true);
  assert.equal(first.highlights.every(item => item.evidenceEventIds.length > 0), true);
  assert.equal(first.highlights.every((item, index, items) => index === 0 || items[index - 1].priority >= item.priority), true);
});

test("generator covers exit, debt, first health crisis, public event and each agent largest daily swing", () => {
  const replay = replayFixture();
  replay.days[2].agents[0].debt = 0;
  replay.days[3].agents[1].health = 29;
  replay.days[4].agents[1].health = 20;
  replay.days[9].agents.forEach((snapshot, index) => {
    snapshot.netWorth += 10_000 + index;
  });
  const artifact = generateReplayEnrichment(replay);
  const kinds = new Set(artifact.highlights.map(item => item.kind));
  assert.equal(kinds.has("technical_dnf"), true);
  assert.equal(kinds.has("debt_cleared"), true);
  assert.equal(kinds.has("health_crisis"), true);
  assert.equal(kinds.has("public_event"), true);
  assert.equal(kinds.has("net_worth_swing"), true);
  assert.equal(artifact.highlights.filter(item => item.kind === "health_crisis" && item.agentIds[0] === "competitor-2").length, 1);
  assert.equal(artifact.highlights.filter(item => item.kind === "net_worth_swing").length, 5);
});

test("same agent and day merges to the highest-priority fact while retaining evidence", () => {
  const replay = replayFixture();
  replay.days[11].agents[4].debt = 0;
  const artifact = generateReplayEnrichment(replay);
  const dayTwelve = artifact.highlights.filter(item => item.day === 12 && item.agentIds[0] === "competitor-5");
  assert.equal(dayTwelve.length, 1);
  assert.equal(dayTwelve[0].kind, "technical_dnf");
  assert.ok(dayTwelve[0].evidenceEventIds.length >= 1);
});

test("candidates without valid evidence are omitted and an empty highlighter remains valid", () => {
  const replay = replayFixture();
  replay.days.forEach(day => {
    day.publicEvents = [];
    day.agents.forEach(snapshot => { snapshot.evidenceEventIds = []; });
  });
  const artifact = generateReplayEnrichment(replay);
  assert.deepEqual(artifact.highlights, []);
  assert.deepEqual(validateReplayEnrichment(artifact, replay), artifact);
});

test("validation rejects replay/fact/hash mismatch and any future-day evidence remapping", () => {
  const replay = replayFixture();
  const artifact = generateReplayEnrichment(replay);
  assert.deepEqual(validateReplayEnrichment(artifact, replay), artifact);

  const wrongReplay = structuredClone(artifact) as unknown as Record<string, unknown>;
  wrongReplay.sourceReplayHash = `sha256:${"0".repeat(64)}`;
  rehashEnrichment(wrongReplay);
  assert.throws(() => validateReplayEnrichment(wrongReplay, replay), /sourceReplayHash/u);

  const wrongFact = structuredClone(artifact) as unknown as Record<string, unknown>;
  wrongFact.sourceFactHash = `sha256:${"1".repeat(64)}`;
  rehashEnrichment(wrongFact);
  assert.throws(() => validateReplayEnrichment(wrongFact, replay), /sourceFactHash/u);

  const tampered = structuredClone(artifact) as unknown as Record<string, any>;
  tampered.highlights[0].day = tampered.highlights[0].day === 40 ? 39 : tampered.highlights[0].day + 1;
  rehashEnrichment(tampered);
  assert.throws(() => validateReplayEnrichment(tampered, replay), /同日有效|确定性/u);

  const wrongHash = structuredClone(artifact) as unknown as Record<string, unknown>;
  wrongHash.enrichmentHash = `sha256:${"f".repeat(64)}`;
  assert.throws(() => validateReplayEnrichment(wrongHash, replay), /enrichmentHash/u);
});

test("Gold1 curated highlights are an exact five-item allowlist with validated historical evidence", () => {
  const rawReplay = JSON.parse(readFileSync(new URL("../../samples/gold-001/replay.json", import.meta.url), "utf8"));
  const replay = adaptCoreMatchReplay(rawReplay);
  const artifact = generateCuratedReplayEnrichment(replay);
  assert.equal(artifact.generator.id, "curated-highlights");
  assert.deepEqual(artifact.highlights.map(item => [item.id, item.day]), [
    ["g1-04-qwen-comeback", 21],
    ["g1-08-altman-gift", 24],
    ["g1-14-deepseek-gamble", 32],
    ["g1-18-claude-exit", 36],
    ["g1-20-final-podium", 40],
  ]);
  assert.equal(artifact.highlights.every(item => item.featured), true);
  assert.equal(artifact.highlights[2].evidenceEventIds.includes("event_651292f85e7f672a"), true);
  assert.deepEqual(validateReplayEnrichment(artifact, replay), artifact);

  const tampered = structuredClone(artifact) as unknown as Record<string, any>;
  tampered.highlights[0].title = "未经选择的标题";
  rehashEnrichment(tampered);
  assert.throws(() => validateReplayEnrichment(tampered, replay), /人工精选白名单/u);
});

test("loader degrades missing or malformed Enrichment without changing Replay readiness", () => {
  const replay = replayFixture();
  const originalDocument = globalThis.document;
  try {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { getElementById: () => null },
    });
    assert.equal(loadReplayEnrichmentSource(replay).status, "missing");

    let removed = false;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        getElementById: () => ({ textContent: "{not-json", remove: () => { removed = true; } }),
      },
    });
    assert.equal(loadReplayEnrichmentSource(replay).status, "error");
    assert.equal(removed, true);
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});
