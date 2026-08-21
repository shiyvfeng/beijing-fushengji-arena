import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECT_DECISION_POLICY_HASH,
  DIRECT_DECISION_POLICY_ID,
  DirectModelDriver,
  parseDirectGameAction,
} from "../../dist/arena/direct-driver.js";
import { DirectProviderRequestError } from "../../dist/arena/agent-driver.js";
import { runMatch } from "../../dist/arena/match-runner.js";
import { assembleMatchReplay } from "../../dist/arena/replay.js";
import { buildDirectRunReport } from "../../dist/arena/run-report.js";
import { ScriptedDriver, createSampleScriptedDrivers } from "../../dist/arena/scripted-driver.js";
import { DEFAULT_SCENARIO } from "../../dist/core/scenario.js";
import { findPotentialSecrets } from "../../dist/core/secret-scan.js";
import { integrityHash } from "../../dist/core/stable-value.js";

const SPECS = [
  ["agent-steady", "稳健铁算盘", "steady"],
  ["agent-value", "胡同捡漏王", "value"],
  ["agent-aggressive", "京城冲浪客", "aggressive"],
  ["agent-cash", "现金守门员", "cash-first"],
];

function fakeProvider(slot, { fail = false, captures = [] } = {}) {
  const policy = new ScriptedDriver(`fake-${slot}`, `Fake ${slot}`, slot, "steady");
  policy.reset();
  return {
    providerId: `fake-provider-${slot}`,
    adapterVersion: "fake-adapter-v2",
    modelId: `fake-model-${slot}`,
    maxOutputTokens: 128,
    thinkingMode: "disabled",
    async requestDecision(input) {
      captures.push(structuredClone({
        observation: input.observation,
        actionIndex: input.actionIndex,
        recentResults: input.recentResults,
      }));
      if (fail) {
        throw new DirectProviderRequestError(
          `fake-provider-${slot}`,
          "http_error",
          "sanitized fake failure",
          503,
        );
      }
      const observation = {
        ...input.observation,
        episodeId: "fake-episode",
        agentId: "fake-agent",
        agentSlot: slot,
        observationHash: "sha256:fake",
      };
      return {
        action: policy.decide({ ...input, observation }),
        usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
      };
    },
  };
}

function directDrivers(options = {}) {
  const captures = Array.from({ length: 4 }, () => []);
  const drivers = SPECS.map(([id, displayName, personaId], slot) => new DirectModelDriver({
    id,
    displayName,
    personaId,
    slot,
    provider: fakeProvider(slot, {
      fail: options.failedSlot === slot,
      captures: captures[slot],
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
    null,
    [],
    { type: "move", locationId: "1" },
    { type: "buy", itemId: 0, quantity: 0 },
    { type: "deposit", amount: Number.NaN },
    { type: "expand_capacity", apiKey: secret },
    { type: "unknown" },
  ]) {
    assert.throws(
      () => parseDirectGameAction(candidate),
      error => error instanceof Error && !error.message.includes(secret),
    );
  }
});

test("four Direct agents use one neutral identity-free boundary and complete 40 days", async () => {
  const { drivers, captures } = directDrivers();
  const output = await runMatch({
    matchId: "direct-fake-complete",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
    maxActionsPerAgent: 160,
    decisionTimeoutMs: 1_000,
  });

  assert.equal(output.report.executionMode, "direct");
  assert.equal(output.traces.length, 4);
  assert.ok(output.traces.every(trace => trace.finalResult.status === "completed"));
  assert.ok(output.traces.every(trace => trace.finalResult.endDay === 40));
  assert.equal(output.replay.metadata.executionMode, "direct");
  assert.equal(output.replay.competitionAudit.decisionPolicyId, DIRECT_DECISION_POLICY_ID);
  assert.equal(output.replay.competitionAudit.decisionPolicyHash, DIRECT_DECISION_POLICY_HASH);
  assert.equal(output.replay.competitionAudit.personalRandomization, "slot-isolated");
  assert.equal(output.replay.competitionAudit.publicRandomization, "shared-seed");
  assert.equal(output.replay.competitionAudit.automaticRetries, 0);
  assert.deepEqual(output.replay.agents.map(agent => agent.provider), [
    "fake-provider-0", "fake-provider-1", "fake-provider-2", "fake-provider-3",
  ]);
  assert.deepEqual(output.replay.agents.map(agent => agent.model), [
    "fake-model-0", "fake-model-1", "fake-model-2", "fake-model-3",
  ]);
  assert.ok(output.replay.agents.every(agent => agent.providerAdapterVersion === "fake-adapter-v2"));
  assert.ok(output.traces.every(trace => trace.agent.providerThinkingMode === "disabled"));
  assert.ok(output.replay.agents.every(agent => agent.providerThinkingMode === "disabled"));
  assert.equal(new Set(output.replay.agents.map(agent => agent.decisionPolicyHash)).size, 1);
  const initialObservations = captures.map(entries => entries.find(entry => entry.actionIndex === 0).observation);
  assert.equal(new Set(initialObservations.map(value => JSON.stringify(value))).size, 1);
  for (const observation of initialObservations) {
    for (const forbidden of ["agentId", "agentSlot", "episodeId", "observationHash"]) {
      assert.equal(forbidden in observation, false);
    }
  }
  const serializedInputs = JSON.stringify(captures);
  for (const forbidden of ["稳健铁算盘", "胡同捡漏王", "fake-provider", "fake-model", "steady", "cash-first"]) {
    assert.equal(serializedInputs.includes(forbidden), false, `model input leaked ${forbidden}`);
  }
  assert.equal(output.replay.luckAudit.agents.length, 4);
  assert.equal(findPotentialSecrets(output.replay).length, 0);
  assert.throws(() => assembleMatchReplay(
    "direct-fake-complete",
    output.traces,
    DEFAULT_SCENARIO,
    { ...output.replay.competitionAudit, decisionPolicyId: "forged-policy" },
  ), /统一决策策略/);

  const report = buildDirectRunReport({
    matchId: "direct-fake-complete",
    seed: 20260820,
    maxActionsPerAgent: 160,
    decisionTimeoutMs: 1_000,
    maxOutputTokens: 128,
  }, output);
  assert.ok(report.agents.every(agent => agent.requestCount > 0));
  assert.ok(report.agents.every(agent => agent.providerThinkingMode === "disabled"));
  assert.equal(report.totals.requestCount, report.totals.successfulRequests);
  assert.equal(report.totals.failedRequests, 0);
  assert.equal(report.totals.validActions, report.totals.requestCount);
  assert.equal(report.totals.tokens.total, report.totals.requestCount * 25);
  assert.equal(report.totals.tokens.requestsWithoutUsage, 0);
  assert.equal(report.cost.status, "unavailable");
});

test("one Direct provider failure becomes a classified isolated technical DNF", async () => {
  const failedSlot = 1;
  const { drivers } = directDrivers({ failedSlot });
  const output = await runMatch({
    matchId: "direct-fake-failure",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers,
  });
  const failed = output.traces.find(trace => trace.agentSlot === failedSlot);
  assert.equal(failed.finalResult.status, "runtime_error");
  assert.equal(failed.finalResult.rankEligibility, "technical_dnf");
  assert.deepEqual(failed.finalResult.technicalFailure, {
    category: "http_error",
    phase: "decide",
    provider: "fake-provider-1",
    httpStatus: 503,
  });
  assert.equal(output.replay.agents.find(agent => agent.slot === failedSlot).rank, null);
  assert.ok(output.traces.filter(trace => trace.agentSlot !== failedSlot).every(trace => trace.finalResult.status === "completed"));
  assert.equal(output.replay.finalRanking.some(entry => entry.agentSlot === failedSlot), false);

  const report = buildDirectRunReport({
    matchId: "direct-fake-failure",
    seed: 20260820,
    maxActionsPerAgent: 160,
    decisionTimeoutMs: 30_000,
    maxOutputTokens: 128,
  }, output);
  const failedReport = report.agents.find(agent => agent.agentSlot === failedSlot);
  assert.equal(failedReport.dnf, true);
  assert.equal(failedReport.failedRequests, 1);
  assert.equal(failedReport.errorCategories.http_error, 1);
  assert.equal(report.totals.dnfAgents, 1);
});

test("Direct report counts timeouts and invalid-action-loop DNF without retries", async () => {
  const timeoutDriver = new DirectModelDriver({
    id: "timeout-agent",
    displayName: "超时展示名",
    personaId: "timeout-persona",
    slot: 0,
    provider: {
      providerId: "timeout-provider",
      adapterVersion: "timeout-adapter-v2",
      modelId: "timeout-model",
      maxOutputTokens: 64,
      requestDecision() {
        return new Promise(() => {});
      },
    },
  });
  const timedOut = await runMatch({
    matchId: "direct-timeout-report",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers: [timeoutDriver],
    decisionTimeoutMs: 15,
  });
  const timeoutReport = buildDirectRunReport({
    matchId: "direct-timeout-report",
    seed: 20260820,
    maxActionsPerAgent: 160,
    decisionTimeoutMs: 15,
    maxOutputTokens: 64,
  }, timedOut);
  assert.equal(timeoutReport.totals.requestCount, 1);
  assert.equal(timeoutReport.totals.failedRequests, 1);
  assert.equal(timeoutReport.totals.timedOutRequests, 1);
  assert.equal(timeoutReport.totals.errorCategories.timeout, 1);
  assert.equal(timeoutReport.totals.latency.samples, 1);
  assert.ok(timeoutReport.totals.latency.totalMs >= 10);
  assert.ok(timeoutReport.totals.latency.minimumMs >= 10);
  assert.ok(timeoutReport.totals.latency.maximumMs >= 10);
  assert.equal(
    timeoutReport.totals.latency.averageMs,
    timeoutReport.totals.latency.totalMs,
  );

  const invalidDriver = new DirectModelDriver({
    id: "invalid-agent",
    displayName: "无效动作展示名",
    personaId: "invalid-persona",
    slot: 0,
    provider: {
      providerId: "invalid-provider",
      adapterVersion: "invalid-adapter-v2",
      modelId: "invalid-model",
      maxOutputTokens: 64,
      async requestDecision() {
        return { action: { type: "expand_capacity" } };
      },
    },
  });
  const invalid = await runMatch({
    matchId: "direct-invalid-report",
    seed: 20260820,
    scenario: DEFAULT_SCENARIO,
    drivers: [invalidDriver],
  });
  const invalidReport = buildDirectRunReport({
    matchId: "direct-invalid-report",
    seed: 20260820,
    maxActionsPerAgent: 160,
    decisionTimeoutMs: 30_000,
    maxOutputTokens: 64,
  }, invalid);
  assert.equal(invalidReport.agents[0].requestCount, 8);
  assert.equal(invalidReport.agents[0].successfulRequests, 8);
  assert.equal(invalidReport.agents[0].validActions, 0);
  assert.equal(invalidReport.agents[0].invalidActions, 8);
  assert.equal(invalidReport.agents[0].errorCategories.invalid_action_loop, 1);
  assert.equal(invalidReport.agents[0].tokens.requestsWithoutUsage, 8);
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
      matchId: "mcp",
      seed: 1,
      scenario: DEFAULT_SCENARIO,
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
