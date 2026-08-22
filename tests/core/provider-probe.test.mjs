import assert from "node:assert/strict";
import test from "node:test";

import { DirectProviderRequestError } from "../../dist/arena/agent-driver.js";
import { DirectModelDriver } from "../../dist/arena/direct-driver.js";
import {
  assertMatchingProviderProbe,
  computeProbeConfigFingerprint,
  probeProviders,
} from "../../dist/arena/provider-probe.js";
import { DEFAULT_SCENARIO } from "../../dist/core/scenario.js";
import { integrityHash } from "../../dist/core/stable-value.js";

function probeDrivers(failedSlot = -1) {
  const calls = [0, 0, 0, 0, 0];
  const observations = [];
  const drivers = calls.map((_, slot) => new DirectModelDriver({
    id: `competitor-${slot + 1}`,
    slot,
    provider: {
      providerId: `probe-provider-${slot}`,
      adapterVersion: "probe-adapter-v3",
      modelId: `probe-model-${slot}`,
      maxOutputTokens: 64,
      thinkingMode: "enabled",
      reasoningEffort: "max",
      declaredModelRevision: `declared-${slot}`,
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
          responseModelRevision: `response-${slot}`,
        };
      },
    },
  }));
  return { drivers, calls, observations };
}

function fingerprint(drivers) {
  return computeProbeConfigFingerprint({
    matchId: "probe-test",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    agents: drivers.map((driver, entryIndex) => ({
      entryIndex,
      provider: driver.descriptor.provider,
      model: driver.descriptor.model,
      providerAdapterVersion: driver.descriptor.providerAdapterVersion,
      endpointFingerprint: integrityHash({ endpoint: entryIndex }),
      declaredModelRevision: driver.descriptor.declaredModelRevision ?? null,
      thinkingMode: driver.descriptor.providerThinkingMode ?? "default",
      reasoningEffort: driver.descriptor.providerReasoningEffort ?? "default",
    })),
    maxActionsPerAgent: 160,
    decisionTimeoutMs: 1_000,
    totalWallClockMs: 160_000,
    maxOutputTokens: 64,
    slotRotationIndex: 0,
  });
}

test("Provider Probe v3 makes exactly five parallel requests and produces a verifiable summary", async () => {
  const { drivers, calls, observations } = probeDrivers();
  const configFingerprint = fingerprint(drivers);
  const result = await probeProviders({
    matchId: "probe-test",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    decisionTimeoutMs: 1_000,
    slotRotationIndex: 0,
    configFingerprint,
    createdAt: "2026-08-22T00:00:00.000Z",
  });
  assert.equal(result.artifactType, "arena-provider-probe-v3");
  assert.equal(result.recoveryPolicyVersion, "bounded-retry-v1");
  assert.equal(result.passed, true);
  assert.equal(result.requestCount, 5);
  assert.deepEqual(calls, [1, 1, 1, 1, 1]);
  assert.ok(result.entries.every(entry => entry.passed && entry.usage.totalTokens === 13));
  assert.ok(result.entries.every(entry => entry.sampling.temperature === "omitted"));
  assert.ok(result.entries.every(entry => entry.providerReasoningEffort === "max"));
  assert.ok(result.entries.every(entry => entry.sampling.reasoningEffort.sent));
  assert.ok(result.entries.every(entry => entry.modelRevision.mismatch));
  assert.equal(new Set(observations.map(value => JSON.stringify(value))).size, 1);
  assert.doesNotThrow(() => assertMatchingProviderProbe(result, configFingerprint));
  assert.throws(
    () => assertMatchingProviderProbe(result, integrityHash({ mismatch: true })),
    /配置匹配/,
  );
});

test("a failed Probe still attempts all five providers and reports only safe fault attribution", async () => {
  const { drivers, calls } = probeDrivers(2);
  const result = await probeProviders({
    matchId: "probe-test",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    decisionTimeoutMs: 1_000,
    slotRotationIndex: 0,
    configFingerprint: fingerprint(drivers),
  });
  assert.equal(result.passed, false);
  assert.equal(result.requestCount, 5);
  assert.deepEqual(calls, [1, 1, 1, 1, 1]);
  assert.deepEqual(result.entries[2].fault, {
    category: "invalid_response",
    domain: "protocol",
    countsTowardModelFailure: false,
  });
  assert.deepEqual(result.entries[2].modelRevision, {
    declared: "declared-2",
    response: null,
    resolved: "declared-2",
    mismatch: false,
  });
  assert.equal("message" in result.entries[2], false);
  assert.throws(
    () => assertMatchingProviderProbe(result, result.configFingerprint),
    /全部通过/,
  );
});
