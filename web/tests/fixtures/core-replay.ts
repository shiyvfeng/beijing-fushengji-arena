import { integrityHash } from "../../src/replay-integrity.ts";

const hash = `sha256:${"a".repeat(64)}`;
const coreAgentIds = ["competitor-1", "competitor-2", "competitor-3", "competitor-4", "competitor-5"];

function state(day: number, status: string, slot: number) {
  const prices = Array.from({ length: 8 }, (_, index) => 100 + day + index);
  return {
    day,
    totalDays: 40,
    daysLeft: Math.max(0, 40 - day),
    cash: 2_000 + slot * 100,
    bank: 1_000,
    debt: 500,
    health: 90 - slot,
    fame: 0,
    capacity: 20,
    currentLocation: slot,
    currentMap: "subway",
    inventory: [{ itemId: slot, quantity: day === 40 ? 0 : 2, averageCost: 80 }],
    market: prices,
    publicReferencePrice: prices,
    status,
    actionCount: day * 2,
    dayActionCount: 2,
  };
}

function finalResult(slot: number) {
  const technical = slot === 4;
  const status = technical ? "runtime_error" : "completed";
  const endDay = technical ? 12 : 40;
  const finalNetWorth = 6_000 - slot * 100;
  const finalState = {
    ...state(endDay, status, slot),
    cash: 5_000 - slot * 100,
    bank: 1_500,
    debt: 500,
    inventory: [{ itemId: slot, quantity: 0, averageCost: 0 }],
  };
  return {
    status,
    endDay,
    finalNetWorth,
    rankEligible: !technical,
    rankEligibility: technical ? "technical_dnf" : "eligible",
    cash: finalState.cash,
    bank: finalState.bank,
    debt: finalState.debt,
    inventoryLiquidationValue: 0,
    publicReferencePrice: Array.from({ length: 8 }, (_, index) => 140 + index),
    settlement: [],
    finalState,
    finalStateHash: hash,
    evidenceEventId: `final-${slot}`,
    ...(technical ? {
      failureMessage: "Provider 请求未能返回可执行的 Arena 动作。",
      technicalFailure: {
        category: "http_error",
        phase: "decide",
        domain: "provider",
        countsTowardModelFailure: false,
        provider: "provider-4",
        httpStatus: 503,
      },
    } : {}),
  };
}

export function rehashReplay(replay: any): any {
  const body = { ...replay };
  delete body.replayHash;
  replay.replayHash = integrityHash(body);
  return replay;
}

export function coreReplayFixture(): any {
  const policyHash = `sha256:${"b".repeat(64)}`;
  const agents = coreAgentIds.map((id, slot) => {
    const result = finalResult(slot);
    return {
      id,
      slot,
      driver: "direct",
      decisionPolicyId: "neutral-v1",
      decisionPolicyHash: policyHash,
      provider: `provider-${slot}`,
      model: `model-${slot}`,
      providerAdapterVersion: `adapter-${slot}-v3`,
      status: result.status,
      finalNetWorth: result.finalNetWorth,
      rank: slot === 4 ? null : slot + 1,
      rankEligible: slot !== 4,
      traceHash: hash,
      finalResult: result,
    };
  });
  const days = Array.from({ length: 40 }, (_, dayIndex) => {
    const day = dayIndex + 1;
    const events = coreAgentIds.flatMap((agentId, slot) => {
      if (slot === 4 && day > 12) return [];
      const status = slot === 4 && day === 12 ? "runtime_error" : day === 40 ? "completed" : "running";
      const effects = day === 2 && slot < 2
        ? [{ scope: "public", kind: "market", globalEventId: "public-market-day-2", message: "全场公开价格波动" }]
        : day === 5 && slot === 0
          ? [{ scope: "personal", kind: "cash", catalogEventId: "cash-01", amount: -50, sourceRandomStream: "personal.cash.event", message: "个人现金损失" }]
          : [];
      return [0, 1].map(sequence => ({
        id: `event-${day}-${slot}-${sequence}`,
        agentId,
        day,
        sequence: day * 10 + sequence,
        type: "action",
        observationHash: hash,
        fullContextHash: hash,
        modelCallId: `model-call-${day}-${slot}-${sequence}`,
        action: sequence === 0 ? { type: "move", locationId: (slot + day) % 20 } : { type: "deposit", amount: 1 },
        stateAfter: state(day, status, slot),
        result: { success: true, message: `参赛者 ${slot} 动作 ${sequence + 1} 结果`, effects },
      }));
    });
    return {
      day,
      publicReferencePrice: Array.from({ length: 8 }, (_, index) => 100 + day + index),
      agentSnapshots: coreAgentIds.map((agentId, slot) => ({
        agentId,
        agentSlot: slot,
        state: state(day, slot === 4 && day >= 12 ? "runtime_error" : day === 40 ? "completed" : "running", slot),
      })),
      events,
    };
  });
  const body = {
    schemaVersion: "arena-schema-v3",
    matchId: "web-adapter-test",
    rulesetVersion: "fushengji-rules-v1",
    toolSchemaVersion: "arena-tools-v1",
    rngVersion: "arena-rng-v1",
    settlementRuleVersion: "public-reference-v1",
    scenarioId: "adapter-test-scenario",
    seed: 42,
    metadata: { title: "受控五模型展示赛", executionMode: "direct", agentCount: 5, totalDays: 40 },
    sourceTraceHashes: Array(5).fill(hash),
    agents,
    days,
    finalRanking: agents.slice(0, 4).map((agent, index) => ({
      rank: index + 1,
      agentId: agent.id,
      agentSlot: agent.slot,
      finalNetWorth: agent.finalNetWorth,
      tier: "completed",
    })),
    setupEvents: coreAgentIds.map((agentId, slot) => ({
      agentId,
      stateAfter: state(0, "running", slot),
    })),
    competitionAudit: {
      fairnessClass: "controlled-exhibition",
      decisionPolicyId: "neutral-v1",
      decisionPolicyHash: policyHash,
      modelObservationVersion: "identity-free-v1",
      contextPolicyVersion: "full-history-v1",
      samplingPolicyVersion: "provider-default-audited-v1",
      publicRandomization: "shared-seed",
      personalRandomization: "slot-isolated",
      slotRotation: {
        version: "cyclic-v1",
        rotationIndex: 0,
        mappings: coreAgentIds.map((agentId, entryIndex) => ({ entryIndex, agentId, slot: entryIndex })),
      },
      maxActionsPerAgent: 160,
      decisionTimeoutMs: 60_000,
      totalWallClockMsPerAgent: 9_600_000,
      maxOutputTokensPerRequest: 512,
      automaticRetries: 0,
    },
    personalRandomEventAudit: {
      basis: "personal-event-count-v1",
      revealDay: 40,
      agents: coreAgentIds.map((agentId, slot) => ({
        agentId,
        favorableEvents: slot === 1 ? 1 : 0,
        adverseEvents: slot === 0 ? 1 : 0,
        favorableInventoryEvents: slot === 1 ? 1 : 0,
        adverseCashEvents: slot === 0 ? 1 : 0,
        adverseDebtEvents: 0,
        adverseHealthEvents: 0,
      })),
    },
    configHash: hash,
    eventHash: hash,
    factHash: hash,
  };
  return { ...body, replayHash: integrityHash(body) };
}
