import assert from "node:assert/strict";
import test from "node:test";

import { DirectProviderRequestError } from "../../dist/arena/agent-driver.js";
import { DirectModelDriver } from "../../dist/arena/direct-driver.js";
import { probeProviders } from "../../dist/arena/provider-probe.js";
import { DEFAULT_SCENARIO } from "../../dist/core/scenario.js";

function probeDrivers(failedSlot = -1) {
  const calls = [0, 0, 0, 0];
  const observations = [];
  const drivers = calls.map((_, slot) => new DirectModelDriver({
    id: `probe-agent-${slot}`,
    displayName: `展示名 ${slot}`,
    personaId: `persona-${slot}`,
    slot,
    provider: {
      providerId: `probe-provider-${slot}`,
      adapterVersion: "probe-adapter-v2",
      modelId: `probe-model-${slot}`,
      maxOutputTokens: 64,
      thinkingMode: "disabled",
      async requestDecision(input) {
        calls[slot]++;
        observations[slot] = structuredClone(input.observation);
        if (slot === failedSlot) {
          throw new DirectProviderRequestError(
            `probe-provider-${slot}`,
            "invalid_response",
            "safe failure",
          );
        }
        return {
          action: { type: "move", locationId: 1 },
          usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
        };
      },
    },
  }));
  return { drivers, calls, observations };
}

test("Provider Probe makes exactly one parallel-safe request per slot", async () => {
  const { drivers, calls, observations } = probeDrivers();
  const result = await probeProviders({
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    decisionTimeoutMs: 1_000,
  });
  assert.equal(result.passed, true);
  assert.equal(result.requestCount, 4);
  assert.deepEqual(calls, [1, 1, 1, 1]);
  assert.ok(result.entries.every(entry => entry.passed));
  assert.ok(result.entries.every(entry => entry.usage.totalTokens === 13));
  assert.ok(result.entries.every(entry => entry.providerThinkingMode === "disabled"));
  assert.equal(new Set(observations.map(value => JSON.stringify(value))).size, 1);
  assert.ok(observations.every(observation => !(
    "agentId" in observation
    || "agentSlot" in observation
    || "episodeId" in observation
    || "observationHash" in observation
  )));
});

test("a failed Probe still attempts all four providers and reports only safe classification", async () => {
  const { drivers, calls } = probeDrivers(2);
  const result = await probeProviders({
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    decisionTimeoutMs: 1_000,
  });
  assert.equal(result.passed, false);
  assert.equal(result.requestCount, 4);
  assert.deepEqual(calls, [1, 1, 1, 1]);
  assert.equal(result.entries[2].errorCategory, "invalid_response");
  assert.equal("message" in result.entries[2], false);
});
