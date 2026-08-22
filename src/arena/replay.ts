import type {
  ArenaExecutionMode,
  ArenaEvent,
  CompetitionAudit,
  EpisodeTrace,
  FinalRankingEntry,
  GameStateSnapshot,
  MatchReplay,
  ReplayAgent,
  ReplayAgentSnapshot,
  PersonalRandomEventAudit,
  ReplayDay,
  ScenarioConfig,
} from "../core/contracts.js";
import {
  ARENA_SCHEMA_VERSION,
  RULESET_VERSION,
  SETTLEMENT_RULE_VERSION,
  TOOL_SCHEMA_VERSION,
} from "../core/contracts.js";
import { GameEnvironment } from "../core/game-environment.js";
import {
  episodeConfigIntegrityHash,
  scenarioIntegrityHash,
} from "../core/integrity.js";
import { RNG_VERSION } from "../core/random/seeded-rng.js";
import { assertNoPotentialSecrets } from "../core/secret-scan.js";
import { diffState } from "../core/state-diff.js";
import {
  immutableClone,
  integrityHash,
  stableHash,
} from "../core/stable-value.js";

function verifyTraceIntegrity(trace: EpisodeTrace): void {
  assertNoPotentialSecrets(trace, `EpisodeTrace ${trace.episodeId}`);
  const { traceHash, ...body } = trace;
  if (integrityHash(body) !== traceHash) {
    throw new Error(`EpisodeTrace 完整性校验失败：${trace.episodeId}`);
  }
}

function expectedRankSemantics(status: EpisodeTrace["finalResult"]["status"]): {
  rankEligibility: EpisodeTrace["finalResult"]["rankEligibility"];
  rankEligible: boolean;
} {
  if (status === "completed") return { rankEligibility: "eligible", rankEligible: true };
  if (status === "dead" || status === "bankrupt") {
    return { rankEligibility: "game_failure", rankEligible: true };
  }
  return { rankEligibility: "technical_dnf", rankEligible: false };
}

function assertSameValue(actual: unknown, expected: unknown, message: string): void {
  if (integrityHash(actual) !== integrityHash(expected)) throw new Error(message);
}

function normalizedProviderIdentity(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "gpt": return "openai";
    case "claude": return "anthropic";
    case "dashscope": return "qwen";
    case "moonshot": return "kimi";
    case "openai-chat": return "openai-compatible";
    default: return value.trim().toLowerCase();
  }
}

function validateTraceEvents(trace: EpisodeTrace, scenario: ScenarioConfig): void {
  if (trace.events.length < 2) {
    throw new Error(`EpisodeTrace 缺少 reset/finalize 事件：${trace.episodeId}`);
  }
  let previousDay = -1;
  let previousAfter: GameStateSnapshot | undefined;
  let technicalTerminationStatus: GameStateSnapshot["status"] | undefined;

  trace.events.forEach((event, index) => {
    if (event.sequence !== index) {
      throw new Error(`EpisodeTrace event sequence 不连续：${trace.episodeId}`);
    }
    if (event.day < previousDay || event.day < 0 || event.day > scenario.totalDays) {
      throw new Error(`EpisodeTrace event day 非单调或越界：${trace.episodeId}`);
    }
    previousDay = event.day;
    if (event.id !== event.evidenceId) {
      throw new Error(`EpisodeTrace event.id 与 evidenceId 不一致：${trace.episodeId}`);
    }
    const expectedEventId = `event_${stableHash({
      matchId: trace.matchId,
      episodeId: trace.episodeId,
      agentId: trace.agentId,
      day: event.day,
      sequence: event.sequence,
      type: event.type,
    })}`;
    if (event.id !== expectedEventId) {
      throw new Error(`EpisodeTrace event ID 派生不正确：${trace.episodeId}`);
    }
    if (event.matchId !== trace.matchId
      || event.episodeId !== trace.episodeId
      || event.agentId !== trace.agentId) {
      throw new Error(`EpisodeTrace event 身份字段不一致：${trace.episodeId}`);
    }
    if (event.stateBefore.totalDays !== scenario.totalDays
      || event.stateAfter.totalDays !== scenario.totalDays) {
      throw new Error(`EpisodeTrace state totalDays 与 scenario 不一致：${trace.episodeId}`);
    }
    if (previousAfter) {
      assertSameValue(
        event.stateBefore,
        previousAfter,
        `EpisodeTrace state chain 断裂：${trace.episodeId}`,
      );
    }
    if (event.type === "technical_termination") {
      if (event.stateBefore.status !== "running"
        || !["model_timeout", "tool_limit", "loop_terminated", "runtime_error"].includes(event.stateAfter.status)
        || event.result.success) {
        throw new Error(`technical_termination 事件状态语义无效：${trace.episodeId}`);
      }
      if (technicalTerminationStatus !== undefined) {
        throw new Error(`EpisodeTrace 包含重复 technical_termination：${trace.episodeId}`);
      }
      technicalTerminationStatus = event.stateAfter.status;
    }
    if (trace.driver === "direct" && event.type === "action") {
      if (!event.modelCallId?.trim()
        || !/^sha256:[0-9a-f]{64}$/.test(event.fullContextHash ?? "")) {
        throw new Error(`Direct action 事件缺少 modelCallId/fullContextHash：${trace.episodeId}`);
      }
    }
    if (previousAfter && previousAfter.status !== "running" && event.type !== "finalize") {
      throw new Error(`EpisodeTrace 在终止状态后仍包含动作：${trace.episodeId}`);
    }
    assertSameValue(
      event.stateDiff,
      diffState(event.stateBefore, event.stateAfter),
      `EpisodeTrace stateDiff 无法由 before/after 重算：${trace.episodeId}`,
    );
    previousAfter = event.stateAfter;
  });

  const firstEvent = trace.events[0];
  const finalEvent = trace.events.at(-1)!;
  if (firstEvent.type !== "episode_reset" || firstEvent.day !== 0) {
    throw new Error(`EpisodeTrace 首事件必须是 day 0 reset：${trace.episodeId}`);
  }
  assertSameValue(
    firstEvent.stateBefore,
    firstEvent.stateAfter,
    `EpisodeTrace reset 事件不应改变状态：${trace.episodeId}`,
  );
  if (integrityHash(firstEvent.stateBefore) !== trace.initialStateHash) {
    throw new Error(`EpisodeTrace initialStateHash 不匹配：${trace.episodeId}`);
  }
  if (finalEvent.type !== "finalize" || finalEvent.day !== scenario.totalDays) {
    throw new Error(`EpisodeTrace 末事件必须是终局日 finalize：${trace.episodeId}`);
  }
  if (finalEvent.stateBefore.status === "running"
    || finalEvent.stateBefore.status !== finalEvent.stateAfter.status) {
    throw new Error(`finalize 不得创建或改变终止状态：${trace.episodeId}`);
  }
  if (finalEvent.id !== trace.finalResult.evidenceEventId) {
    throw new Error(`FinalResult evidenceEventId 未指向 finalize：${trace.episodeId}`);
  }
  assertSameValue(
    finalEvent.stateAfter,
    trace.finalResult.finalState,
    `FinalResult finalState 与末事件不一致：${trace.episodeId}`,
  );
  const finalStatus = trace.finalResult.status;
  const isTechnical = ["model_timeout", "tool_limit", "loop_terminated", "runtime_error"].includes(finalStatus);
  if ((isTechnical && technicalTerminationStatus !== finalStatus)
    || (!isTechnical && technicalTerminationStatus !== undefined)) {
    throw new Error(`FinalResult 与 technical_termination 证据不一致：${trace.episodeId}`);
  }
  if ((isTechnical && !trace.finalResult.technicalFailure)
    || (!isTechnical && trace.finalResult.technicalFailure)) {
    throw new Error(`FinalResult technicalFailure 与终止状态不一致：${trace.episodeId}`);
  }
}

function validateFinalResult(trace: EpisodeTrace, scenario: ScenarioConfig): void {
  const result = trace.finalResult;
  const expected = expectedRankSemantics(result.status);
  if (result.rankEligibility !== expected.rankEligibility
    || result.rankEligible !== expected.rankEligible) {
    throw new Error(`FinalResult 排名语义与 status 不一致：${trace.episodeId}`);
  }
  if (result.finalState.status !== result.status || result.finalState.day !== result.endDay) {
    throw new Error(`FinalResult status/endDay 与 finalState 不一致：${trace.episodeId}`);
  }
  if (result.status === "completed" && result.endDay !== scenario.totalDays) {
    throw new Error(`completed EpisodeTrace 未走完 scenario：${trace.episodeId}`);
  }
  if (result.endDay < 0 || result.endDay > scenario.totalDays) {
    throw new Error(`FinalResult endDay 越界：${trace.episodeId}`);
  }
  if (integrityHash(result.finalState) !== result.finalStateHash) {
    throw new Error(`FinalResult finalStateHash 不匹配：${trace.episodeId}`);
  }
  if (result.cash !== result.finalState.cash
    || result.bank !== result.finalState.bank
    || result.debt !== result.finalState.debt
    || result.finalNetWorth !== result.cash + result.bank - result.debt) {
    throw new Error(`FinalResult 净资产字段无法重算：${trace.episodeId}`);
  }
  if (result.inventoryLiquidationValue !== result.settlement.reduce((sum, line) => sum + line.value, 0)) {
    throw new Error(`FinalResult 库存结算汇总不一致：${trace.episodeId}`);
  }
  assertSameValue(
    result.publicReferencePrice,
    result.finalState.publicReferencePrice,
    `FinalResult 终局参考价与 finalState 不一致：${trace.episodeId}`,
  );
}

function validateTraces(
  matchId: string,
  traces: readonly EpisodeTrace[],
  scenario: ScenarioConfig,
): EpisodeTrace[] {
  if (traces.length === 0) throw new Error("至少需要一条 EpisodeTrace 才能组装 Replay");
  const sorted = [...traces].sort((a, b) => a.agentSlot - b.agentSlot || a.agentId.localeCompare(b.agentId));
  const first = sorted[0];
  const expectedScenarioHash = scenarioIntegrityHash(scenario);
  const slots = new Set<number>();
  const agentIds = new Set<string>();

  for (const trace of sorted) {
    verifyTraceIntegrity(trace);
    if (trace.schemaVersion !== ARENA_SCHEMA_VERSION
      || trace.rulesetVersion !== RULESET_VERSION
      || trace.toolSchemaVersion !== TOOL_SCHEMA_VERSION
      || trace.rngVersion !== RNG_VERSION
      || trace.settlementRuleVersion !== SETTLEMENT_RULE_VERSION) {
      throw new Error(`EpisodeTrace 版本不兼容：${trace.episodeId}`);
    }
    if (trace.matchId !== matchId
      || trace.scenarioId !== scenario.id
      || trace.scenarioHash !== expectedScenarioHash
      || trace.scenarioHash !== first.scenarioHash
      || trace.seed !== first.seed) {
      throw new Error(`EpisodeTrace 的 scenario/seed 不一致：${trace.episodeId}`);
    }
    const expectedConfigHash = episodeConfigIntegrityHash({
      matchId: trace.matchId,
      episodeId: trace.episodeId,
      agentId: trace.agentId,
      agentSlot: trace.agentSlot,
      seed: trace.seed,
      scenario,
    });
    if (trace.configHash !== expectedConfigHash) {
      throw new Error(`EpisodeTrace configHash 与完整 scenario 配置不一致：${trace.episodeId}`);
    }
    if (trace.agent.slot !== trace.agentSlot
      || trace.agent.id !== trace.agentId
      || trace.agent.driver !== trace.driver) {
      throw new Error(`EpisodeTrace 的 Agent 描述不一致：${trace.episodeId}`);
    }
    if (slots.has(trace.agentSlot) || agentIds.has(trace.agentId)) {
      throw new Error("EpisodeTrace 存在重复的 Agent slot 或 ID");
    }
    slots.add(trace.agentSlot);
    agentIds.add(trace.agentId);
    validateTraceEvents(trace, scenario);
    validateFinalResult(trace, scenario);
  }
  const driverKinds = new Set(sorted.map(trace => trace.driver));
  if (driverKinds.size !== 1) {
    throw new Error("同一 Replay 的 EpisodeTrace 不能混合执行模式");
  }
  const driverKind = sorted[0].driver;
  if (driverKind === "mcp") {
    throw new Error("Replay Assembler 尚未实现 MCP Host 执行能力");
  }
  if (driverKind !== "scripted" && driverKind !== "direct") {
    throw new Error("Replay Assembler 收到不支持的执行模式");
  }
  if (driverKind === "direct") {
    if (sorted.length !== 5
      || sorted.some((trace, index) => trace.agentSlot !== index)) {
      throw new Error("arena-schema-v3 Direct Replay 必须包含连续 slot 0..4 的五条 Trace");
    }
    const identities = new Set<string>();
    for (const trace of sorted) {
      if (!trace.agent.provider?.trim()
        || !trace.agent.model?.trim()
        || !trace.agent.providerAdapterVersion?.trim()
        || !trace.agent.providerReasoningEffort
        || trace.agent.providerReasoningEffort === "default"
        || !trace.agent.decisionPolicyId?.trim()
        || !/^sha256:[0-9a-f]{64}$/.test(trace.agent.decisionPolicyHash ?? "")) {
        throw new Error(
          `Direct EpisodeTrace 缺少 Provider、模型、显式思考等级或公平决策审计字段：${trace.episodeId}`,
        );
      }
      if (trace.agent.displayName !== undefined || trace.agent.personaId !== undefined) {
        throw new Error(`Direct EpisodeTrace 禁止策略展示身份：${trace.episodeId}`);
      }
      if (!/^competitor-[1-5]$/u.test(trace.agentId)) {
        throw new Error(`Direct EpisodeTrace 内部 Agent ID 无效：${trace.episodeId}`);
      }
      identities.add(`${normalizedProviderIdentity(trace.agent.provider)}\0${trace.agent.model.trim()}`);
    }
    if (identities.size !== 5
      || new Set(sorted.map(trace => trace.agentId)).size !== 5) {
      throw new Error("Direct Replay 的五组 Provider + model 与 competitor-1...5 必须互不重复");
    }
  }
  return sorted;
}

function buildPersonalRandomEventAudit(
  traces: readonly EpisodeTrace[],
  revealDay: number,
): PersonalRandomEventAudit {
  const agents = traces.map(trace => {
    let favorableEvents = 0;
    let adverseEvents = 0;
    let favorableInventoryEvents = 0;
    let adverseCashEvents = 0;
    let adverseDebtEvents = 0;
    let adverseHealthEvents = 0;

    for (const event of trace.events) {
      const occurrences = new Map<string, typeof event.result.effects[number][]>();
      event.result.effects.forEach(effect => {
        if (effect.scope !== "personal"
          || !effect.catalogEventId
          || !effect.sourceRandomStream) return;
        const key = [
          event.id,
          effect.catalogEventId,
          effect.sourceRandomStream,
        ].join("|");
        const group = occurrences.get(key) ?? [];
        group.push(effect);
        occurrences.set(key, group);
      });

      for (const effects of occurrences.values()) {
        const cash = effects.some(effect => effect.kind === "cash" && (effect.amount ?? 0) < 0);
        const debt = effects.some(effect => effect.kind === "debt" && (effect.amount ?? 0) > 0);
        const health = effects.some(effect => effect.kind === "health" && (effect.amount ?? 0) < 0);
        const inventory = effects.some(effect => effect.kind === "inventory" && (effect.amount ?? 0) > 0);
        if (cash || debt || health) {
          adverseEvents++;
          if (cash) adverseCashEvents++;
          if (debt) adverseDebtEvents++;
          if (health) adverseHealthEvents++;
        } else if (inventory) {
          favorableEvents++;
          favorableInventoryEvents++;
        }
      }
    }

    return Object.freeze({
      agentId: trace.agentId,
      favorableEvents,
      adverseEvents,
      favorableInventoryEvents,
      adverseCashEvents,
      adverseDebtEvents,
      adverseHealthEvents,
    });
  });

  return Object.freeze({
    basis: "personal-event-count-v1",
    revealDay,
    agents,
  });
}

function rankTraces(traces: readonly EpisodeTrace[]): FinalRankingEntry[] {
  const completed = traces
    .filter(trace => trace.finalResult.rankEligibility === "eligible")
    .sort((a, b) => b.finalResult.finalNetWorth - a.finalResult.finalNetWorth || a.agentSlot - b.agentSlot);
  const gameFailures = traces
    .filter(trace => trace.finalResult.rankEligibility === "game_failure")
    .sort((a, b) => b.finalResult.finalNetWorth - a.finalResult.finalNetWorth || a.agentSlot - b.agentSlot);
  return [...completed, ...gameFailures].map((trace, index) => ({
    rank: index + 1,
    agentId: trace.agentId,
    agentSlot: trace.agentSlot,
    finalNetWorth: trace.finalResult.finalNetWorth,
    tier: trace.finalResult.rankEligibility === "eligible" ? "completed" : "game_failure",
  }));
}

function snapshotAtDay(trace: EpisodeTrace, day: number): GameStateSnapshot {
  let latest = trace.events[0]?.stateAfter;
  for (const event of trace.events) {
    if (event.day <= day) latest = event.stateAfter;
  }
  if (!latest) throw new Error(`EpisodeTrace 缺少初始快照：${trace.episodeId}`);
  return latest;
}

function sortEvents(events: readonly ArenaEvent[], slotByAgent: ReadonlyMap<string, number>): ArenaEvent[] {
  return [...events].sort((a, b) => {
    const slotDifference = (slotByAgent.get(a.agentId) ?? 999) - (slotByAgent.get(b.agentId) ?? 999);
    return a.day - b.day || slotDifference || a.sequence - b.sequence || a.id.localeCompare(b.id);
  });
}

export function assembleMatchReplay(
  matchId: string,
  tracesInput: readonly EpisodeTrace[],
  scenario: ScenarioConfig,
  competitionAudit?: CompetitionAudit,
): MatchReplay {
  const traces = validateTraces(matchId, tracesInput, scenario);
  const traceMode = traces[0].driver;
  if (traceMode !== "scripted" && traceMode !== "direct") {
    throw new Error("Replay Assembler 收到不支持的执行模式");
  }
  const executionMode: ArenaExecutionMode = traceMode;
  if (executionMode === "direct" && !competitionAudit) {
    throw new Error("Direct Replay 缺少 competitionAudit");
  }
  if (executionMode === "scripted" && competitionAudit) {
    throw new Error("Scripted Replay 不得伪造 Direct competitionAudit");
  }
  if (competitionAudit) {
    if (!Number.isSafeInteger(competitionAudit.maxActionsPerAgent)
      || competitionAudit.maxActionsPerAgent <= 0
      || !Number.isSafeInteger(competitionAudit.decisionTimeoutMs)
      || competitionAudit.decisionTimeoutMs <= 0
      || !Number.isSafeInteger(competitionAudit.totalWallClockMsPerAgent)
      || competitionAudit.totalWallClockMsPerAgent <= 0
      || !Number.isSafeInteger(competitionAudit.maxOutputTokensPerRequest)
      || competitionAudit.maxOutputTokensPerRequest < 16
      || competitionAudit.maxOutputTokensPerRequest > 4_096
      || competitionAudit.automaticRetries !== 0
      || competitionAudit.publicRandomization !== "shared-seed"
      || competitionAudit.personalRandomization !== "slot-isolated"
      || competitionAudit.contextPolicyVersion !== "full-history-v1"
      || competitionAudit.samplingPolicyVersion !== "provider-explicit-effort-audited-v2"
      || competitionAudit.slotRotation.version !== "cyclic-v1"
      || competitionAudit.slotRotation.mappings.length !== 5) {
      throw new Error("Direct Replay competitionAudit 的预算或随机策略无效");
    }
    const { rotationIndex, mappings } = competitionAudit.slotRotation;
    const mappingSlots = new Set(mappings.map(item => item.slot));
    const mappingAgents = new Set(mappings.map(item => item.agentId));
    const traceSlotByAgent = new Map(traces.map(trace => [trace.agentId, trace.agentSlot]));
    if (!Number.isSafeInteger(rotationIndex) || rotationIndex < 0 || rotationIndex > 4
      || mappingSlots.size !== 5 || mappingAgents.size !== 5
      || mappings.some((item, entryIndex) => (
        item.entryIndex !== entryIndex
        || item.agentId !== `competitor-${entryIndex + 1}`
        || item.slot !== (entryIndex + rotationIndex) % 5
        || traceSlotByAgent.get(item.agentId) !== item.slot
      ))) {
      throw new Error("Direct Replay cyclic-v1 映射无效");
    }
    for (const trace of traces) {
      if (trace.agent.decisionPolicyId !== competitionAudit.decisionPolicyId
        || trace.agent.decisionPolicyHash !== competitionAudit.decisionPolicyHash) {
        throw new Error(`Direct Replay 的统一决策策略与 Trace 不一致：${trace.episodeId}`);
      }
    }
  }
  const seed = traces[0].seed;
  const eventMatchIds = new Set(traces.flatMap(trace => trace.events.map(event => event.matchId)));
  if (eventMatchIds.size !== 1 || !eventMatchIds.has(matchId)) {
    throw new Error("EpisodeTrace 的 matchId 与目标 Replay 不一致");
  }

  const probe = new GameEnvironment();
  probe.reset({
    matchId,
    episodeId: `${matchId}:public-market-probe`,
    agentId: "public-market-probe",
    agentSlot: 0,
    seed,
    scenario,
  });

  const ranking = rankTraces(traces);
  const rankByAgent = new Map(ranking.map(entry => [entry.agentId, entry.rank]));
  const slotByAgent = new Map(traces.map(trace => [trace.agentId, trace.agentSlot]));
  const allEvents = sortEvents(traces.flatMap(trace => [...trace.events]), slotByAgent);
  const setupEvents = allEvents.filter(event => event.day === 0);
  const days: ReplayDay[] = [];

  for (let day = 1; day <= scenario.totalDays; day++) {
    const agentSnapshots: ReplayAgentSnapshot[] = traces.map(trace => ({
      agentId: trace.agentId,
      agentSlot: trace.agentSlot,
      state: snapshotAtDay(trace, day),
    }));
    days.push({
      day,
      publicReferencePrice: probe.publicReferencePriceForDay(day),
      agentSnapshots,
      events: allEvents.filter(event => event.day === day),
    });
  }

  const agents: ReplayAgent[] = traces.map(trace => ({
    id: trace.agent.id,
    ...(trace.agent.displayName ? { displayName: trace.agent.displayName } : {}),
    slot: trace.agentSlot,
    driver: trace.driver,
    ...(trace.agent.personaId ? { personaId: trace.agent.personaId } : {}),
    ...(trace.agent.decisionPolicyId
      ? { decisionPolicyId: trace.agent.decisionPolicyId }
      : {}),
    ...(trace.agent.decisionPolicyHash
      ? { decisionPolicyHash: trace.agent.decisionPolicyHash }
      : {}),
    ...(trace.agent.provider ? { provider: trace.agent.provider } : {}),
    ...(trace.agent.model ? { model: trace.agent.model } : {}),
    ...(trace.agent.providerAdapterVersion
      ? { providerAdapterVersion: trace.agent.providerAdapterVersion }
      : {}),
    ...(trace.agent.providerThinkingMode
      ? { providerThinkingMode: trace.agent.providerThinkingMode }
      : {}),
    ...(trace.agent.providerReasoningEffort
      ? { providerReasoningEffort: trace.agent.providerReasoningEffort }
      : {}),
    ...(trace.agent.declaredModelRevision
      ? { declaredModelRevision: trace.agent.declaredModelRevision }
      : {}),
    status: trace.finalResult.status,
    finalNetWorth: trace.finalResult.finalNetWorth,
    rank: rankByAgent.get(trace.agentId) ?? null,
    rankEligible: trace.finalResult.rankEligible,
    traceHash: trace.traceHash,
    finalResult: trace.finalResult,
  }));

  const metadata = {
    title: executionMode === "direct"
      ? "北京浮生记 · 受控五模型展示赛"
      : "北京浮生记 Arena · Scripted 样例赛",
    executionMode,
    agentCount: traces.length,
    totalDays: scenario.totalDays,
  };
  const sourceTraceHashes = traces.map(trace => trace.traceHash);
  const personalRandomEventAudit = buildPersonalRandomEventAudit(traces, scenario.totalDays);
  const configHash = integrityHash({
    matchId,
    scenario,
    seed,
    versions: {
      schema: ARENA_SCHEMA_VERSION,
      ruleset: RULESET_VERSION,
      toolSchema: TOOL_SCHEMA_VERSION,
      rng: RNG_VERSION,
      settlement: SETTLEMENT_RULE_VERSION,
    },
    metadata,
    ...(competitionAudit ? { competitionAudit } : {}),
    agents: traces.map(trace => trace.agent),
  });
  const eventHash = integrityHash({ setupEvents, dayEvents: days.map(day => day.events) });
  const factHash = integrityHash({
    days: days.map(day => ({
      day: day.day,
      publicReferencePrice: day.publicReferencePrice,
      agentSnapshots: day.agentSnapshots,
    })),
    finalRanking: ranking,
    finalResults: agents.map(agent => ({ id: agent.id, finalResult: agent.finalResult })),
    personalRandomEventAudit,
  });
  const body = {
    schemaVersion: ARENA_SCHEMA_VERSION,
    matchId,
    rulesetVersion: RULESET_VERSION,
    toolSchemaVersion: TOOL_SCHEMA_VERSION,
    rngVersion: RNG_VERSION,
    settlementRuleVersion: SETTLEMENT_RULE_VERSION,
    scenarioId: scenario.id,
    seed,
    metadata,
    sourceTraceHashes,
    agents,
    days,
    finalRanking: ranking,
    setupEvents,
    ...(competitionAudit ? { competitionAudit } : {}),
    personalRandomEventAudit,
    configHash,
    eventHash,
    factHash,
  } as const;
  const replay = immutableClone({ ...body, replayHash: integrityHash(body) }) as MatchReplay;
  assertNoPotentialSecrets(replay, "MatchReplay");
  return replay;
}
