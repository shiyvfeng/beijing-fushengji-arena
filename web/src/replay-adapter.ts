import { verifyReplayIntegrity } from "./replay-integrity.ts";
import type {
  AgentAction,
  AgentId,
  AgentLuckSummary,
  AgentProfile,
  AgentSnapshot,
  CompetitionAudit,
  FinalResult,
  InventoryLine,
  LuckAudit,
  PriceQuote,
  PublicEpisodeStatus,
  PublicEvent,
  ReplayArtifact,
  ReplayDay,
  TechnicalFailure,
  TechnicalFailureCategory,
} from "./replay-types.ts";
import { AGENT_IDS } from "./replay-types.ts";

type JsonObject = Record<string, unknown>;

const SUPPORTED_SCHEMA_VERSION = "arena-schema-v2";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ITEM_NAMES = ["进口香烟", "走私汽车", "盗版VCD", "假白酒", "禁书", "进口玩具", "水货手机", "伪劣化妆品"];
const LOCATION_NAMES = [
  "西直门", "复兴门", "积水潭", "东直门", "建国门", "北京站", "崇文门", "长椿街", "公主坟", "苹果园",
  "海淀大街", "府右街", "亚运村", "三元西桥", "永安里", "方庄", "永定门", "玉泉营", "翠微路", "八角西路",
];
const STATUSES: readonly PublicEpisodeStatus[] = [
  "running", "completed", "dead", "bankrupt", "model_timeout", "tool_limit", "loop_terminated", "runtime_error",
];
const TECHNICAL_STATUSES = new Set<PublicEpisodeStatus>([
  "model_timeout", "tool_limit", "loop_terminated", "runtime_error",
]);
const TECHNICAL_CATEGORIES: readonly TechnicalFailureCategory[] = [
  "timeout", "action_budget", "invalid_action_loop", "transport_error", "http_error",
  "invalid_response", "refusal", "incomplete", "driver_error",
];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数值`);
  return value;
}

function requireInteger(value: unknown, label: string): number {
  const number = requireNumber(value, label);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} 必须是安全整数`);
  return number;
}

function requireSha256(value: unknown, label: string): string {
  const hash = requireString(value, label);
  if (!SHA256_PATTERN.test(hash)) throw new Error(`${label} 必须是 sha256: 加 64 位小写十六进制`);
  return hash;
}

function requireStatus(value: unknown, label: string): PublicEpisodeStatus {
  if (!STATUSES.includes(value as PublicEpisodeStatus)) throw new Error(`${label} 不是支持的状态`);
  return value as PublicEpisodeStatus;
}

function requireNumberArray(value: unknown, length: number, label: string): number[] {
  const entries = requireArray(value, label);
  if (entries.length !== length) throw new Error(`${label} 必须包含 ${length} 个数值`);
  return entries.map((entry, index) => requireNumber(entry, `${label}[${index}]`));
}

function validateTechnicalFailure(value: unknown, label: string): TechnicalFailure {
  const failure = requireObject(value, label);
  if (!TECHNICAL_CATEGORIES.includes(failure.category as TechnicalFailureCategory)) {
    throw new Error(`${label}.category 无效`);
  }
  if (failure.phase !== "reset" && failure.phase !== "decide" && failure.phase !== "action") {
    throw new Error(`${label}.phase 无效`);
  }
  if (failure.httpStatus !== undefined) requireInteger(failure.httpStatus, `${label}.httpStatus`);
  return {
    category: failure.category as TechnicalFailureCategory,
    phase: failure.phase,
    ...(optionalString(failure.provider) ? { provider: optionalString(failure.provider) } : {}),
    ...(failure.httpStatus !== undefined ? { httpStatus: requireInteger(failure.httpStatus, `${label}.httpStatus`) } : {}),
  };
}

function validateState(value: unknown, label: string): JsonObject {
  const state = requireObject(value, label);
  for (const key of ["day", "totalDays", "daysLeft", "cash", "bank", "debt", "health", "capacity", "actionCount", "dayActionCount"]) {
    requireNumber(state[key], `${label}.${key}`);
  }
  if (state.currentLocation !== null) {
    const location = requireInteger(state.currentLocation, `${label}.currentLocation`);
    if (location < 0 || location >= LOCATION_NAMES.length) throw new Error(`${label}.currentLocation 超出范围`);
  }
  requireStatus(state.status, `${label}.status`);
  requireNumberArray(state.publicReferencePrice, ITEM_NAMES.length, `${label}.publicReferencePrice`);
  requireNumberArray(state.market, ITEM_NAMES.length, `${label}.market`);
  requireArray(state.inventory, `${label}.inventory`).forEach((entry, index) => {
    const position = requireObject(entry, `${label}.inventory[${index}]`);
    const itemId = requireInteger(position.itemId, `${label}.inventory[${index}].itemId`);
    if (itemId < 0 || itemId >= ITEM_NAMES.length) throw new Error(`${label}.inventory[${index}].itemId 超出范围`);
    requireNumber(position.quantity, `${label}.inventory[${index}].quantity`);
    requireNumber(position.averageCost, `${label}.inventory[${index}].averageCost`);
  });
  return state;
}

interface ValidatedReplay {
  raw: JsonObject;
  agents: JsonObject[];
  days: JsonObject[];
  executionMode: "direct" | "scripted";
  replayHash: string;
  factHash: string;
  competitionAudit?: CompetitionAudit;
}

function validateCompetitionAudit(value: unknown): CompetitionAudit {
  const audit = requireObject(value, "Replay.competitionAudit");
  if (audit.fairnessClass !== "controlled-exhibition"
    || audit.publicRandomization !== "shared-seed"
    || audit.personalRandomization !== "slot-isolated"
    || audit.automaticRetries !== 0) {
    throw new Error("Replay.competitionAudit 的公平性或随机策略无效");
  }
  const maxActionsPerAgent = requireInteger(audit.maxActionsPerAgent, "Replay.competitionAudit.maxActionsPerAgent");
  const decisionTimeoutMs = requireInteger(audit.decisionTimeoutMs, "Replay.competitionAudit.decisionTimeoutMs");
  const maxOutputTokensPerRequest = requireInteger(audit.maxOutputTokensPerRequest, "Replay.competitionAudit.maxOutputTokensPerRequest");
  if (maxActionsPerAgent <= 0
    || decisionTimeoutMs <= 0
    || maxOutputTokensPerRequest < 16
    || maxOutputTokensPerRequest > 4_096) {
    throw new Error("Replay.competitionAudit 预算无效");
  }
  return {
    fairnessClass: "controlled-exhibition",
    decisionPolicyId: requireString(audit.decisionPolicyId, "Replay.competitionAudit.decisionPolicyId"),
    decisionPolicyHash: requireSha256(audit.decisionPolicyHash, "Replay.competitionAudit.decisionPolicyHash"),
    modelObservationVersion: requireString(audit.modelObservationVersion, "Replay.competitionAudit.modelObservationVersion"),
    publicRandomization: "shared-seed",
    personalRandomization: "slot-isolated",
    maxActionsPerAgent,
    decisionTimeoutMs,
    maxOutputTokensPerRequest,
    automaticRetries: 0,
  };
}

function validateCoreMatchReplay(rawValue: unknown): ValidatedReplay {
  const raw = requireObject(rawValue, "注入 Replay");
  if (raw.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`不支持的 Replay schemaVersion：${String(raw.schemaVersion ?? "缺失")}`);
  }
  if (raw.rulesetVersion !== "fushengji-rules-v1"
    || raw.toolSchemaVersion !== "arena-tools-v1"
    || raw.rngVersion !== "arena-rng-v1"
    || raw.settlementRuleVersion !== "public-reference-v1") {
    throw new Error("Replay 规则、工具、随机或结算版本不兼容");
  }
  const replayHash = requireSha256(raw.replayHash, "Replay.replayHash");
  const factHash = requireSha256(raw.factHash, "Replay.factHash");
  requireSha256(raw.configHash, "Replay.configHash");
  requireSha256(raw.eventHash, "Replay.eventHash");
  verifyReplayIntegrity(raw);
  requireString(raw.matchId, "Replay.matchId");
  requireString(raw.scenarioId, "Replay.scenarioId");
  requireInteger(raw.seed, "Replay.seed");

  const metadata = requireObject(raw.metadata, "Replay.metadata");
  if (metadata.agentCount !== 4 || metadata.totalDays !== 40) {
    throw new Error("Replay.metadata 必须声明四个 Agent 与 40 天");
  }
  if (metadata.executionMode !== "direct" && metadata.executionMode !== "scripted") {
    throw new Error("Replay.metadata.executionMode 必须是 direct 或 scripted");
  }
  const executionMode = metadata.executionMode;
  const competitionAudit = executionMode === "direct"
    ? validateCompetitionAudit(raw.competitionAudit)
    : undefined;
  if (executionMode === "scripted" && raw.competitionAudit !== undefined) {
    throw new Error("Scripted Replay 不得声明 Direct competitionAudit");
  }

  const agentValues = requireArray(raw.agents, "Replay.agents");
  if (agentValues.length !== 4) throw new Error("正式看板必须包含四个 Agent");
  const agents = agentValues.map((value, index) => requireObject(value, `Replay.agents[${index}]`));
  const sourceTraceHashes = requireArray(raw.sourceTraceHashes, "Replay.sourceTraceHashes");
  if (sourceTraceHashes.length !== 4) throw new Error("Replay.sourceTraceHashes 必须包含四项");
  sourceTraceHashes.forEach((value, index) => requireSha256(value, `Replay.sourceTraceHashes[${index}]`));
  const ids = new Set<string>();
  const slots = new Set<number>();
  for (const [index, agent] of agents.entries()) {
    const label = `Replay.agents[${index}]`;
    const id = requireString(agent.id, `${label}.id`);
    const slot = requireInteger(agent.slot, `${label}.slot`);
    if (ids.has(id) || slots.has(slot)) throw new Error("Replay Agent id/slot 必须唯一");
    ids.add(id);
    slots.add(slot);
    requireString(agent.displayName, `${label}.displayName`);
    requireSha256(agent.traceHash, `${label}.traceHash`);
    const status = requireStatus(agent.status, `${label}.status`);
    if (status === "running") throw new Error(`${label}.status 不能是 running`);
    const rank = agent.rank === null ? null : requireInteger(agent.rank, `${label}.rank`);
    if (TECHNICAL_STATUSES.has(status) && rank !== null) throw new Error(`${label} 技术 DNF 不得有正式名次`);
    const finalResult = requireObject(agent.finalResult, `${label}.finalResult`);
    if (requireStatus(finalResult.status, `${label}.finalResult.status`) !== status) {
      throw new Error(`${label} status 与 finalResult.status 不一致`);
    }
    const endDay = requireInteger(finalResult.endDay, `${label}.finalResult.endDay`);
    if (endDay < 0 || endDay > 40) throw new Error(`${label}.finalResult.endDay 越界`);
    for (const key of ["finalNetWorth", "cash", "bank", "debt", "inventoryLiquidationValue"]) {
      requireNumber(finalResult[key], `${label}.finalResult.${key}`);
    }
    validateState(finalResult.finalState, `${label}.finalResult.finalState`);
    if (TECHNICAL_STATUSES.has(status)) {
      validateTechnicalFailure(finalResult.technicalFailure, `${label}.finalResult.technicalFailure`);
    } else if (finalResult.technicalFailure !== undefined) {
      throw new Error(`${label} 非技术终止不得包含 technicalFailure`);
    }
    if (executionMode === "direct") {
      if (agent.driver !== "direct") throw new Error(`${label}.driver 必须为 direct`);
      requireString(agent.personaId, `${label}.personaId`);
      requireString(agent.provider, `${label}.provider`);
      requireString(agent.model, `${label}.model`);
      requireString(agent.providerAdapterVersion, `${label}.providerAdapterVersion`);
      if (agent.providerThinkingMode !== undefined) {
        const mode = requireString(agent.providerThinkingMode, `${label}.providerThinkingMode`);
        if (mode !== "default" && mode !== "disabled" && mode !== "enabled") {
          throw new Error(`${label}.providerThinkingMode 无效`);
        }
      }
      if (agent.decisionPolicyId !== competitionAudit?.decisionPolicyId
        || agent.decisionPolicyHash !== competitionAudit?.decisionPolicyHash) {
        throw new Error(`${label} 的中性决策策略与 competitionAudit 不一致`);
      }
    }
  }
  if ([...slots].sort((a, b) => a - b).some((slot, index) => slot !== index)) {
    throw new Error("Replay Agent slot 必须唯一覆盖 0..3");
  }
  const setupEvents = requireArray(raw.setupEvents, "Replay.setupEvents");
  const setupIds = new Set<string>();
  setupEvents.forEach((value, index) => {
    const event = requireObject(value, `Replay.setupEvents[${index}]`);
    const id = requireString(event.agentId, `Replay.setupEvents[${index}].agentId`);
    if (!ids.has(id)) throw new Error("Replay.setupEvents 引用了未知 Agent");
    setupIds.add(id);
    validateState(event.stateAfter, `Replay.setupEvents[${index}].stateAfter`);
  });
  if (setupIds.size !== 4) throw new Error("Replay.setupEvents 必须覆盖四个 Agent");

  const dayValues = requireArray(raw.days, "Replay.days");
  if (dayValues.length !== 40) throw new Error("Replay 必须包含 40 天");
  const days = dayValues.map((value, index) => requireObject(value, `Replay.days[${index}]`));
  for (const [index, day] of days.entries()) {
    const label = `Replay.days[${index}]`;
    if (requireInteger(day.day, `${label}.day`) !== index + 1) throw new Error("Replay 日期必须连续覆盖 1..40");
    requireNumberArray(day.publicReferencePrice, ITEM_NAMES.length, `${label}.publicReferencePrice`);
    const snapshots = requireArray(day.agentSnapshots, `${label}.agentSnapshots`);
    if (snapshots.length !== 4) throw new Error(`${label} 必须包含四个 Agent 快照`);
    const seen = new Set<string>();
    snapshots.forEach((value, snapshotIndex) => {
      const snapshot = requireObject(value, `${label}.agentSnapshots[${snapshotIndex}]`);
      const id = requireString(snapshot.agentId, `${label}.agentSnapshots[${snapshotIndex}].agentId`);
      if (!ids.has(id) || seen.has(id)) throw new Error(`${label} Agent 快照引用无效`);
      seen.add(id);
      validateState(snapshot.state, `${label}.agentSnapshots[${snapshotIndex}].state`);
    });
    requireArray(day.events, `${label}.events`).forEach((value, eventIndex) => {
      const event = requireObject(value, `${label}.events[${eventIndex}]`);
      if (!ids.has(requireString(event.agentId, `${label}.events[${eventIndex}].agentId`))) {
        throw new Error(`${label}.events 引用了未知 Agent`);
      }
      if (requireInteger(event.day, `${label}.events[${eventIndex}].day`) !== index + 1) {
        throw new Error(`${label}.events 日期不一致`);
      }
      requireInteger(event.sequence, `${label}.events[${eventIndex}].sequence`);
      validateState(event.stateAfter, `${label}.events[${eventIndex}].stateAfter`);
    });
  }

  const ranking = requireArray(raw.finalRanking, "Replay.finalRanking");
  const rankedIds = new Set<string>();
  ranking.forEach((value, index) => {
    const entry = requireObject(value, `Replay.finalRanking[${index}]`);
    const id = requireString(entry.agentId, `Replay.finalRanking[${index}].agentId`);
    if (!ids.has(id) || rankedIds.has(id)) throw new Error("Replay.finalRanking Agent 引用无效");
    rankedIds.add(id);
    if (requireInteger(entry.rank, `Replay.finalRanking[${index}].rank`) !== index + 1) {
      throw new Error("Replay.finalRanking 名次必须连续递增");
    }
    const agent = agents.find(candidate => candidate.id === id)!;
    if (requireNumber(entry.finalNetWorth, `Replay.finalRanking[${index}].finalNetWorth`)
      !== requireNumber(agent.finalNetWorth, `Agent ${id}.finalNetWorth`)) {
      throw new Error("Replay.finalRanking 与核心 FinalResult 不一致");
    }
  });
  for (const agent of agents) {
    const expectedRank = ranking.findIndex(value => isObject(value) && value.agentId === agent.id);
    const recordedRank = agent.rank === null ? null : requireInteger(agent.rank, `Agent ${String(agent.id)}.rank`);
    if (recordedRank !== (expectedRank < 0 ? null : expectedRank + 1)) {
      throw new Error(`Agent ${String(agent.id)}.rank 与 Replay.finalRanking 不一致`);
    }
  }
  const luck = requireObject(raw.luckAudit, "Replay.luckAudit");
  if (luck.basis !== "personal-event-count-v1" || luck.revealDay !== 40) {
    throw new Error("Replay.luckAudit 口径或揭示日无效");
  }
  const luckAgents = requireArray(luck.agents, "Replay.luckAudit.agents");
  if (luckAgents.length !== 4) {
    throw new Error("Replay.luckAudit 必须包含四个 Agent");
  }
  const luckAgentIds = new Set<string>();
  luckAgents.forEach((value, index) => {
    const entry = requireObject(value, `Replay.luckAudit.agents[${index}]`);
    const id = requireString(entry.agentId, `Replay.luckAudit.agents[${index}].agentId`);
    if (!ids.has(id) || luckAgentIds.has(id)) throw new Error("Replay.luckAudit Agent 引用无效或重复");
    luckAgentIds.add(id);
    for (const key of [
      "favorableEvents", "adverseEvents", "favorableInventoryEvents",
      "adverseCashEvents", "adverseDebtEvents", "adverseHealthEvents",
    ]) {
      if (requireInteger(entry[key], `Replay.luckAudit.agents[${index}].${key}`) < 0) {
        throw new Error("Replay.luckAudit 计数不得为负数");
      }
    }
  });
  for (const key of ["luckiestAgentIds", "unluckiestAgentIds"]) {
    const values = requireArray(luck[key], `Replay.luckAudit.${key}`);
    if (!values.length || values.some(value => typeof value !== "string" || !ids.has(value))) {
      throw new Error(`Replay.luckAudit.${key} 引用无效`);
    }
  }
  return { raw, agents, days, executionMode, replayHash, factHash, ...(competitionAudit ? { competitionAudit } : {}) };
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function actionLabel(action: unknown): string {
  if (!isObject(action)) return "未知动作";
  switch (action.type) {
    case "move": return `前往${LOCATION_NAMES[number(action.locationId, -1)] ?? "未知地点"}`;
    case "buy": return `买入${ITEM_NAMES[number(action.itemId, -1)] ?? "未知商品"} × ${number(action.quantity)}`;
    case "sell": return `卖出${ITEM_NAMES[number(action.itemId, -1)] ?? "未知商品"} × ${number(action.quantity)}`;
    case "deposit": return `存入银行 ¥${number(action.amount).toLocaleString("zh-CN")}`;
    case "withdraw": return `取出存款 ¥${number(action.amount).toLocaleString("zh-CN")}`;
    case "repay_debt": return `偿还债务 ¥${number(action.amount).toLocaleString("zh-CN")}`;
    case "heal": return `治疗 ${number(action.points)} 点`;
    case "expand_capacity": return "扩充随身容量";
    default: return "未知动作";
  }
}

function inventoryLines(state: JsonObject, prices: number[]): InventoryLine[] {
  return objects(state.inventory)
    .filter(position => number(position.quantity) > 0)
    .map(position => {
      const itemId = number(position.itemId, -1);
      const quantity = number(position.quantity);
      const referencePrice = prices[itemId] ?? 0;
      return {
        itemId,
        name: ITEM_NAMES[itemId] ?? "未知商品",
        quantity,
        averageCost: number(position.averageCost),
        referencePrice,
        markedValue: Math.round(quantity * referencePrice),
      };
    });
}

function markedNetWorth(state: JsonObject, prices: number[]): number {
  return Math.round(
    number(state.cash)
      + number(state.bank)
      - number(state.debt)
      + inventoryLines(state, prices).reduce((sum, line) => sum + line.markedValue, 0),
  );
}

function buildPrices(prices: number[], previous: number[]): PriceQuote[] {
  return ITEM_NAMES.map((commodity, itemId) => {
    const price = prices[itemId];
    const prior = previous[itemId] ?? price;
    return {
      itemId,
      commodity,
      price,
      changePercent: prior === 0 ? 0 : Math.round(((price / prior) - 1) * 1_000) / 10,
    };
  });
}

function buildPublicEvents(events: JsonObject[]): PublicEvent[] {
  const seen = new Set<string>();
  const output: PublicEvent[] = [];
  for (const event of events) {
    const result = isObject(event.result) ? event.result : {};
    for (const effect of objects(result.effects)) {
      if (effect.scope !== "public") continue;
      const summary = string(effect.message).trim();
      if (!summary) continue;
      const id = string(effect.globalEventId)
        || `${string(effect.catalogEventId, "public-event")}:${summary}`;
      if (seen.has(id)) continue;
      seen.add(id);
      output.push({ id, title: "公共市场事件", summary });
    }
  }
  return output;
}

export function adaptCoreMatchReplay(rawValue: unknown): ReplayArtifact {
  const validated = validateCoreMatchReplay(rawValue);
  const coreAgents = [...validated.agents].sort((left, right) => number(left.slot) - number(right.slot));
  const idByCore = new Map(coreAgents.map((agent, index) => [string(agent.id), AGENT_IDS[index]]));
  const coreById = new Map(coreAgents.map(agent => [string(agent.id), agent]));
  const profiles: AgentProfile[] = coreAgents.map((agent, index) => ({
    id: AGENT_IDS[index],
    coreId: string(agent.id),
    name: string(agent.displayName),
    ...(optionalString(agent.personaId) ? { personaId: optionalString(agent.personaId) } : {}),
    provider: validated.executionMode === "direct" ? string(agent.provider) : "scripted",
    model: validated.executionMode === "direct" ? string(agent.model) : "deterministic-golden-sample",
    adapterVersion: validated.executionMode === "direct" ? string(agent.providerAdapterVersion) : "scripted-driver",
  }));
  const finalByCore = new Map(coreAgents.map(agent => [string(agent.id), requireObject(agent.finalResult, "Agent.finalResult")]));
  const rankByCore = new Map(objects(validated.raw.finalRanking).map(entry => [string(entry.agentId), number(entry.rank)]));
  let previousPrices: number[] = [];
  let previousRanks = new Map<AgentId, number>();

  const days: ReplayDay[] = validated.days.map(coreDay => {
    const day = number(coreDay.day);
    const prices = requireNumberArray(coreDay.publicReferencePrice, ITEM_NAMES.length, `Day ${day} prices`);
    const events = objects(coreDay.events).sort((left, right) => {
      const leftSlot = number(coreById.get(string(left.agentId))?.slot, 99);
      const rightSlot = number(coreById.get(string(right.agentId))?.slot, 99);
      return leftSlot - rightSlot || number(left.sequence) - number(right.sequence);
    });
    const snapshots = objects(coreDay.agentSnapshots).map((snapshot): AgentSnapshot => {
      const coreId = string(snapshot.agentId);
      const agentId = idByCore.get(coreId)!;
      const state = requireObject(snapshot.state, `Day ${day} Agent ${coreId} state`);
      const final = finalByCore.get(coreId)!;
      const status = requireStatus(state.status, `Day ${day} Agent ${coreId} status`);
      const technicalFailure = TECHNICAL_STATUSES.has(status)
        ? validateTechnicalFailure(final.technicalFailure, `Agent ${coreId}.technicalFailure`)
        : undefined;
      return {
        agentId,
        cash: number(state.cash),
        bank: number(state.bank),
        debt: number(state.debt),
        health: number(state.health),
        netWorth: day === 40 ? number(final.finalNetWorth) : markedNetWorth(state, prices),
        location: LOCATION_NAMES[number(state.currentLocation, -1)] ?? "移动中",
        inventory: inventoryLines(state, prices),
        status,
        ...(status !== "running" ? { exitDay: number(final.endDay) } : {}),
        ...(technicalFailure ? { technicalFailure } : {}),
        provisionalRank: null,
        rankChange: null,
      } satisfies AgentSnapshot;
    });
    const rankable = day === 40
      ? snapshots.filter(snapshot => rankByCore.has(profiles.find(profile => profile.id === snapshot.agentId)!.coreId))
      : snapshots.filter(snapshot => snapshot.status === "running");
    const ordered = day === 40
      ? [...rankable].sort((left, right) => {
          const leftCore = profiles.find(profile => profile.id === left.agentId)!.coreId;
          const rightCore = profiles.find(profile => profile.id === right.agentId)!.coreId;
          return rankByCore.get(leftCore)! - rankByCore.get(rightCore)!;
        })
      : [...rankable].sort((left, right) => right.netWorth - left.netWorth || left.agentId.localeCompare(right.agentId));
    const ranks = new Map(ordered.map((snapshot, index) => [snapshot.agentId, index + 1]));
    for (const snapshot of snapshots) {
      const rank = ranks.get(snapshot.agentId) ?? null;
      snapshot.provisionalRank = rank;
      snapshot.rankChange = rank === null || !previousRanks.has(snapshot.agentId)
        ? null
        : previousRanks.get(snapshot.agentId)! - rank;
    }
    previousRanks = new Map([...ranks]);
    const actions: AgentAction[] = events
      .filter(event => event.type === "action" && event.action !== undefined)
      .map(event => {
        const result = isObject(event.result) ? event.result : {};
        const stateAfter = requireObject(event.stateAfter, `Event ${string(event.id)} stateAfter`);
        const code = optionalString(result.code);
        return {
          id: string(event.id),
          agentId: idByCore.get(string(event.agentId))!,
          sequence: number(event.sequence),
          summary: actionLabel(event.action),
          result: string(result.message, "无结果说明"),
          success: result.success === true,
          ...(code ? { code } : {}),
          location: LOCATION_NAMES[number(stateAfter.currentLocation, -1)] ?? "移动中",
        };
      });
    const adapted: ReplayDay = {
      day,
      prices: buildPrices(prices, previousPrices),
      agents: snapshots.sort((left, right) => left.agentId.localeCompare(right.agentId)),
      actions,
      publicEvents: buildPublicEvents(events),
    };
    previousPrices = prices;
    return adapted;
  });

  const finalResults: FinalResult[] = coreAgents.map((agent, index) => {
    const final = requireObject(agent.finalResult, `Agent ${string(agent.id)} finalResult`);
    const status = requireStatus(final.status, `Agent ${string(agent.id)} finalResult.status`);
    return {
      agentId: AGENT_IDS[index],
      rank: rankByCore.get(string(agent.id)) ?? null,
      status: status as Exclude<PublicEpisodeStatus, "running">,
      exitDay: number(final.endDay),
      finalNetWorth: number(final.finalNetWorth),
      cash: number(final.cash),
      bank: number(final.bank),
      debt: number(final.debt),
      inventoryLiquidationValue: number(final.inventoryLiquidationValue),
      ...(TECHNICAL_STATUSES.has(status)
        ? { technicalFailure: validateTechnicalFailure(final.technicalFailure, `Agent ${string(agent.id)} technicalFailure`) }
        : {}),
    };
  }).sort((left, right) => {
    if (left.rank === null && right.rank === null) return left.agentId.localeCompare(right.agentId);
    if (left.rank === null) return 1;
    if (right.rank === null) return -1;
    return left.rank - right.rank;
  });

  const coreLuck = requireObject(validated.raw.luckAudit, "Replay.luckAudit");
  const luckAgents: AgentLuckSummary[] = objects(coreLuck.agents).map(entry => ({
    agentId: idByCore.get(string(entry.agentId))!,
    favorableEvents: number(entry.favorableEvents),
    adverseEvents: number(entry.adverseEvents),
    favorableInventoryEvents: number(entry.favorableInventoryEvents),
    adverseCashEvents: number(entry.adverseCashEvents),
    adverseDebtEvents: number(entry.adverseDebtEvents),
    adverseHealthEvents: number(entry.adverseHealthEvents),
  })).sort((left, right) => left.agentId.localeCompare(right.agentId));
  const luckAudit: LuckAudit = {
    basis: "personal-event-count-v1",
    revealDay: 40,
    agents: luckAgents,
    luckiestAgentIds: requireArray(coreLuck.luckiestAgentIds, "luckiestAgentIds").map(value => idByCore.get(string(value))!),
    unluckiestAgentIds: requireArray(coreLuck.unluckiestAgentIds, "unluckiestAgentIds").map(value => idByCore.get(string(value))!),
  };

  return {
    schemaVersion: "arena-replay-view-v1",
    executionMode: validated.executionMode,
    matchId: string(validated.raw.matchId),
    title: string(requireObject(validated.raw.metadata, "Replay.metadata").title),
    scenarioId: string(validated.raw.scenarioId),
    seed: number(validated.raw.seed),
    totalDays: 40,
    factLayerHash: validated.factHash,
    replayHash: validated.replayHash,
    agentProfiles: profiles,
    days,
    ...(validated.competitionAudit ? { competitionAudit: validated.competitionAudit } : {}),
    luckAudit,
    finalResults,
  };
}

export type ReplaySource =
  | { status: "ready"; replay: ReplayArtifact; source: "injected-core" }
  | { status: "error"; message: string };

export function loadReplaySource(): ReplaySource {
  if (typeof document === "undefined") return { status: "error", message: "当前环境没有 DOM，无法读取 Replay" };
  const element = document.getElementById("arena-replay-data");
  if (!element?.textContent?.trim()) {
    return { status: "error", message: "正式页面缺少 Replay 数据，已停止展示" };
  }
  const source = element.textContent;
  element.remove();
  try {
    return {
      status: "ready",
      replay: adaptCoreMatchReplay(JSON.parse(source) as unknown),
      source: "injected-core",
    };
  } catch (error: unknown) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Replay 验证失败",
    };
  }
}
