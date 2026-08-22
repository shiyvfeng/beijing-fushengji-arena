import { verifyReplayIntegrity } from "./replay-integrity.ts";
import type {
  AgentAction,
  AgentId,
  AgentPersonalRandomEventSummary,
  AgentProfile,
  AgentSnapshot,
  CompetitionAudit,
  FaultDomain,
  FinalResult,
  InventoryLine,
  PersonalRandomEventAudit,
  PriceQuote,
  PublicEpisodeStatus,
  PublicEvent,
  ReplayArtifact,
  ReplayDay,
  TechnicalFailure,
  TechnicalFailureCategory,
} from "./replay-types.ts";

type JsonObject = Record<string, unknown>;
const SUPPORTED_SCHEMA_VERSION = "arena-schema-v3";
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
const EXPLICIT_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
const TECHNICAL_CATEGORIES: readonly TechnicalFailureCategory[] = [
  "timeout", "total_wall_clock", "context_limit", "action_budget", "invalid_action_loop",
  "transport_error", "http_error", "invalid_response", "invalid_action", "refusal", "incomplete", "driver_error",
];
const FAULT_DOMAINS: readonly FaultDomain[] = [
  "platform", "provider", "model", "protocol", "runner", "undetermined",
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
  const result = requireNumber(value, label);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} 必须是安全整数`);
  return result;
}
function requireSha256(value: unknown, label: string): string {
  const hash = requireString(value, label);
  if (!SHA256_PATTERN.test(hash)) throw new Error(`${label} 必须是 SHA-256 hash`);
  return hash;
}
function requireStatus(value: unknown, label: string): PublicEpisodeStatus {
  if (!STATUSES.includes(value as PublicEpisodeStatus)) throw new Error(`${label} 不是支持的状态`);
  return value as PublicEpisodeStatus;
}
function requireNumberArray(value: unknown, length: number, label: string): number[] {
  const items = requireArray(value, label);
  if (items.length !== length) throw new Error(`${label} 必须包含 ${length} 个数值`);
  return items.map((item, index) => requireNumber(item, `${label}[${index}]`));
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

function validateTechnicalFailure(value: unknown, label: string): TechnicalFailure {
  const failure = requireObject(value, label);
  if (!TECHNICAL_CATEGORIES.includes(failure.category as TechnicalFailureCategory)) {
    throw new Error(`${label}.category 无效`);
  }
  if (failure.phase !== "reset" && failure.phase !== "decide" && failure.phase !== "action") {
    throw new Error(`${label}.phase 无效`);
  }
  if (!FAULT_DOMAINS.includes(failure.domain as FaultDomain)
    || typeof failure.countsTowardModelFailure !== "boolean") {
    throw new Error(`${label} 缺少安全故障归属`);
  }
  return {
    category: failure.category as TechnicalFailureCategory,
    phase: failure.phase,
    domain: failure.domain as FaultDomain,
    countsTowardModelFailure: failure.countsTowardModelFailure,
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
    if (location < 0 || location >= LOCATION_NAMES.length) throw new Error(`${label}.currentLocation 越界`);
  }
  requireStatus(state.status, `${label}.status`);
  requireNumberArray(state.publicReferencePrice, ITEM_NAMES.length, `${label}.publicReferencePrice`);
  requireNumberArray(state.market, ITEM_NAMES.length, `${label}.market`);
  requireArray(state.inventory, `${label}.inventory`).forEach((entry, index) => {
    const position = requireObject(entry, `${label}.inventory[${index}]`);
    const itemId = requireInteger(position.itemId, `${label}.inventory[${index}].itemId`);
    if (itemId < 0 || itemId >= ITEM_NAMES.length) throw new Error(`${label}.inventory itemId 越界`);
    requireNumber(position.quantity, `${label}.inventory[${index}].quantity`);
    requireNumber(position.averageCost, `${label}.inventory[${index}].averageCost`);
  });
  return state;
}

function validateCompetitionAudit(value: unknown, slotsByAgent: ReadonlyMap<string, number>): CompetitionAudit {
  const audit = requireObject(value, "Replay.competitionAudit");
  if (audit.fairnessClass !== "controlled-exhibition"
    || audit.contextPolicyVersion !== "full-history-v1"
    || audit.samplingPolicyVersion !== "provider-explicit-effort-audited-v2"
    || audit.publicRandomization !== "shared-seed"
    || audit.personalRandomization !== "slot-isolated"
    || audit.automaticRetries !== 0) {
    throw new Error("Replay.competitionAudit 的策略版本无效");
  }
  const rotation = requireObject(audit.slotRotation, "Replay.competitionAudit.slotRotation");
  const rotationIndex = requireInteger(rotation.rotationIndex, "slotRotation.rotationIndex");
  const mappings = requireArray(rotation.mappings, "slotRotation.mappings").map((value, index) => {
    const item = requireObject(value, `slotRotation.mappings[${index}]`);
    const entryIndex = requireInteger(item.entryIndex, "mapping.entryIndex");
    const agentId = requireString(item.agentId, "mapping.agentId");
    const slot = requireInteger(item.slot, "mapping.slot");
    if (!slotsByAgent.has(agentId)
      || entryIndex !== index
      || agentId !== `competitor-${index + 1}`
      || slot !== (entryIndex + rotationIndex) % 5
      || slotsByAgent.get(agentId) !== slot) {
      throw new Error("Replay cyclic-v1 映射无效");
    }
    return { entryIndex, agentId, slot };
  });
  if (rotation.version !== "cyclic-v1" || rotationIndex < 0 || rotationIndex > 4 || mappings.length !== 5
    || new Set(mappings.map(item => item.agentId)).size !== 5
    || new Set(mappings.map(item => item.slot)).size !== 5) {
    throw new Error("Replay slotRotation 无效");
  }
  const maxActionsPerAgent = requireInteger(audit.maxActionsPerAgent, "competitionAudit.maxActionsPerAgent");
  const decisionTimeoutMs = requireInteger(audit.decisionTimeoutMs, "competitionAudit.decisionTimeoutMs");
  const totalWallClockMsPerAgent = requireInteger(audit.totalWallClockMsPerAgent, "competitionAudit.totalWallClockMsPerAgent");
  const maxOutputTokensPerRequest = requireInteger(audit.maxOutputTokensPerRequest, "competitionAudit.maxOutputTokensPerRequest");
  if (maxActionsPerAgent <= 0 || decisionTimeoutMs <= 0 || totalWallClockMsPerAgent <= 0
    || maxOutputTokensPerRequest < 16 || maxOutputTokensPerRequest > 4_096) {
    throw new Error("Replay.competitionAudit 预算无效");
  }
  return {
    fairnessClass: "controlled-exhibition",
    decisionPolicyId: requireString(audit.decisionPolicyId, "competitionAudit.decisionPolicyId"),
    decisionPolicyHash: requireSha256(audit.decisionPolicyHash, "competitionAudit.decisionPolicyHash"),
    modelObservationVersion: requireString(audit.modelObservationVersion, "competitionAudit.modelObservationVersion"),
    contextPolicyVersion: "full-history-v1",
    samplingPolicyVersion: "provider-explicit-effort-audited-v2",
    publicRandomization: "shared-seed",
    personalRandomization: "slot-isolated",
    slotRotation: { version: "cyclic-v1", rotationIndex, mappings },
    maxActionsPerAgent,
    decisionTimeoutMs,
    totalWallClockMsPerAgent,
    maxOutputTokensPerRequest,
    automaticRetries: 0,
  };
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
  const executionMode = metadata.executionMode;
  if (executionMode !== "direct" && executionMode !== "scripted") {
    throw new Error("Replay executionMode 无效");
  }
  const expectedCount = executionMode === "direct" ? 5 : requireInteger(metadata.agentCount, "metadata.agentCount");
  if (metadata.agentCount !== expectedCount || metadata.totalDays !== 40) {
    throw new Error("Replay metadata Agent 数或天数无效");
  }
  const agents = requireArray(raw.agents, "Replay.agents").map((value, index) => (
    requireObject(value, `Replay.agents[${index}]`)
  ));
  if (agents.length !== expectedCount || (executionMode === "direct" && agents.length !== 5)) {
    throw new Error("正式 Direct 看板必须包含五个 Agent");
  }
  const ids = new Set<string>();
  const slots = new Set<number>();
  const slotsByAgent = new Map<string, number>();
  const identities = new Set<string>();
  for (const [index, agent] of agents.entries()) {
    const label = `Replay.agents[${index}]`;
    const id = requireString(agent.id, `${label}.id`);
    const slot = requireInteger(agent.slot, `${label}.slot`);
    if (ids.has(id) || slots.has(slot)) throw new Error("Replay Agent id/slot 必须唯一");
    ids.add(id);
    slots.add(slot);
    slotsByAgent.set(id, slot);
    requireSha256(agent.traceHash, `${label}.traceHash`);
    const status = requireStatus(agent.status, `${label}.status`);
    if (status === "running") throw new Error(`${label}.status 不能是 running`);
    const rank = agent.rank === null ? null : requireInteger(agent.rank, `${label}.rank`);
    if (TECHNICAL_STATUSES.has(status) && rank !== null) throw new Error("技术 DNF 不得有正式名次");
    const finalResult = requireObject(agent.finalResult, `${label}.finalResult`);
    if (requireStatus(finalResult.status, `${label}.finalResult.status`) !== status) {
      throw new Error("终局状态不一致");
    }
    const endDay = requireInteger(finalResult.endDay, `${label}.finalResult.endDay`);
    if (endDay < 0 || endDay > 40) throw new Error("终局日越界");
    for (const key of ["finalNetWorth", "cash", "bank", "debt", "inventoryLiquidationValue"]) {
      requireNumber(finalResult[key], `${label}.finalResult.${key}`);
    }
    validateState(finalResult.finalState, `${label}.finalResult.finalState`);
    if (TECHNICAL_STATUSES.has(status)) validateTechnicalFailure(finalResult.technicalFailure, `${label}.technicalFailure`);
    if (executionMode === "direct") {
      if (agent.driver !== "direct" || agent.displayName !== undefined || agent.personaId !== undefined) {
        throw new Error("Direct Replay 禁止策略展示身份");
      }
      const provider = requireString(agent.provider, `${label}.provider`);
      const model = requireString(agent.model, `${label}.model`);
      requireString(agent.providerAdapterVersion, `${label}.providerAdapterVersion`);
      const reasoningEffort = requireString(
        agent.providerReasoningEffort,
        `${label}.providerReasoningEffort`,
      );
      if (!EXPLICIT_REASONING_EFFORTS.has(reasoningEffort)) {
        throw new Error(`${label}.providerReasoningEffort 必须是显式等级`);
      }
      identities.add(`${normalizedProviderIdentity(provider)}\0${model.trim()}`);
    }
  }
  if ([...slots].sort((a, b) => a - b).some((slot, index) => slot !== index)) {
    throw new Error("Replay Agent slot 必须连续");
  }
  if (executionMode === "direct" && identities.size !== 5) {
    throw new Error("Replay Provider + model 必须五组唯一");
  }
  if (executionMode === "direct"
    && [...ids].sort().join("\0") !== [1, 2, 3, 4, 5].map(index => `competitor-${index}`).join("\0")) {
    throw new Error("Direct Replay 内部 Agent ID 必须是 competitor-1...5");
  }
  const competitionAudit = executionMode === "direct"
    ? validateCompetitionAudit(raw.competitionAudit, slotsByAgent)
    : undefined;
  if (executionMode === "scripted" && raw.competitionAudit !== undefined) {
    throw new Error("Scripted Replay 不得声明 competitionAudit");
  }
  if (competitionAudit) {
    for (const agent of agents) {
      if (agent.decisionPolicyId !== competitionAudit.decisionPolicyId
        || agent.decisionPolicyHash !== competitionAudit.decisionPolicyHash) {
        throw new Error("Agent 与 competitionAudit 策略不一致");
      }
    }
  }
  const sourceTraceHashes = requireArray(raw.sourceTraceHashes, "Replay.sourceTraceHashes");
  if (sourceTraceHashes.length !== expectedCount) throw new Error("sourceTraceHashes 数量无效");
  sourceTraceHashes.forEach((value, index) => requireSha256(value, `sourceTraceHashes[${index}]`));
  const setupIds = new Set<string>();
  requireArray(raw.setupEvents, "Replay.setupEvents").forEach((value, index) => {
    const event = requireObject(value, `setupEvents[${index}]`);
    const id = requireString(event.agentId, "setup event agentId");
    if (!ids.has(id)) throw new Error("setup event 引用未知 Agent");
    setupIds.add(id);
    validateState(event.stateAfter, "setup event state");
  });
  if (setupIds.size !== expectedCount) throw new Error("setupEvents 未覆盖全部 Agent");
  const days = requireArray(raw.days, "Replay.days").map((value, index) => requireObject(value, `days[${index}]`));
  if (days.length !== 40) throw new Error("Replay 必须包含 40 天");
  days.forEach((day, dayIndex) => {
    if (requireInteger(day.day, "day") !== dayIndex + 1) throw new Error("Replay 日期不连续");
    requireNumberArray(day.publicReferencePrice, ITEM_NAMES.length, "publicReferencePrice");
    const snapshots = requireArray(day.agentSnapshots, "agentSnapshots");
    if (snapshots.length !== expectedCount) throw new Error("每日快照 Agent 数量无效");
    const seen = new Set<string>();
    snapshots.forEach(value => {
      const snapshot = requireObject(value, "snapshot");
      const id = requireString(snapshot.agentId, "snapshot.agentId");
      if (!ids.has(id) || seen.has(id)) throw new Error("快照 Agent 引用无效");
      seen.add(id);
      validateState(snapshot.state, "snapshot.state");
    });
    requireArray(day.events, "day.events").forEach(value => {
      const event = requireObject(value, "event");
      if (!ids.has(requireString(event.agentId, "event.agentId"))) throw new Error("event Agent 未知");
      if (event.type === "action" && executionMode === "direct") {
        requireString(event.modelCallId, "event.modelCallId");
        requireSha256(event.fullContextHash, "event.fullContextHash");
        requireSha256(event.observationHash, "event.observationHash");
      }
      validateState(event.stateAfter, "event.stateAfter");
    });
  });
  const ranking = requireArray(raw.finalRanking, "Replay.finalRanking");
  const ranked = new Set<string>();
  ranking.forEach((value, index) => {
    const entry = requireObject(value, "ranking entry");
    const id = requireString(entry.agentId, "ranking.agentId");
    if (!ids.has(id) || ranked.has(id) || requireInteger(entry.rank, "ranking.rank") !== index + 1) {
      throw new Error("正式排名引用无效");
    }
    ranked.add(id);
  });
  const personal = requireObject(raw.personalRandomEventAudit, "Replay.personalRandomEventAudit");
  if (raw.luckAudit !== undefined
    || personal.basis !== "personal-event-count-v1"
    || personal.revealDay !== 40
    || personal.luckiestAgentIds !== undefined
    || personal.unluckiestAgentIds !== undefined) {
    throw new Error("个人随机事件审计口径无效");
  }
  const personalAgents = requireArray(personal.agents, "personalRandomEventAudit.agents");
  if (personalAgents.length !== expectedCount) throw new Error("个人随机事件计数不完整");
  const personalIds = new Set<string>();
  personalAgents.forEach(value => {
    const entry = requireObject(value, "personal event entry");
    const id = requireString(entry.agentId, "personal event agentId");
    if (!ids.has(id) || personalIds.has(id)) throw new Error("个人随机事件 Agent 引用无效");
    personalIds.add(id);
    for (const key of [
      "favorableEvents", "adverseEvents", "favorableInventoryEvents",
      "adverseCashEvents", "adverseDebtEvents", "adverseHealthEvents",
    ]) if (requireInteger(entry[key], key) < 0) throw new Error("事件计数不得为负");
  });
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
  return objects(state.inventory).filter(position => number(position.quantity) > 0).map(position => {
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
  return Math.round(number(state.cash) + number(state.bank) - number(state.debt)
    + inventoryLines(state, prices).reduce((sum, line) => sum + line.markedValue, 0));
}
function buildPrices(prices: number[], previous: number[]): PriceQuote[] {
  return ITEM_NAMES.map((commodity, itemId) => {
    const price = prices[itemId];
    const prior = previous[itemId] ?? price;
    return { itemId, commodity, price, changePercent: prior === 0 ? 0 : Math.round(((price / prior) - 1) * 1_000) / 10 };
  });
}
function buildPublicEvents(events: JsonObject[]): PublicEvent[] {
  const seen = new Set<string>();
  const result: PublicEvent[] = [];
  for (const event of events) {
    const payload = isObject(event.result) ? event.result : {};
    for (const effect of objects(payload.effects)) {
      if (effect.scope !== "public") continue;
      const summary = string(effect.message).trim();
      if (!summary) continue;
      const id = string(effect.globalEventId) || `${string(effect.catalogEventId, "public-event")}:${summary}`;
      if (!seen.has(id)) {
        seen.add(id);
        result.push({ id, title: "公共市场事件", summary });
      }
    }
  }
  return result;
}

export function adaptCoreMatchReplay(rawValue: unknown): ReplayArtifact {
  const validated = validateCoreMatchReplay(rawValue);
  const mappingIndex = new Map(validated.competitionAudit?.slotRotation.mappings.map(item => [item.agentId, item.entryIndex]) ?? []);
  const coreAgents = [...validated.agents].sort((left, right) => {
    const leftIndex = mappingIndex.get(string(left.id)) ?? number(left.slot);
    const rightIndex = mappingIndex.get(string(right.id)) ?? number(right.slot);
    return leftIndex - rightIndex;
  });
  const coreById = new Map(coreAgents.map(agent => [string(agent.id), agent]));
  const profiles: AgentProfile[] = coreAgents.map((agent, index) => {
    const provider = validated.executionMode === "direct" ? string(agent.provider) : "scripted";
    const model = validated.executionMode === "direct" ? string(agent.model) : string(agent.displayName, "deterministic");
    return {
      id: string(agent.id),
      label: `${provider} + ${model}`,
      provider,
      model,
      adapterVersion: validated.executionMode === "direct" ? string(agent.providerAdapterVersion) : "scripted-driver",
      visualIndex: mappingIndex.get(string(agent.id)) ?? index,
    };
  });
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  const finalById = new Map(coreAgents.map(agent => [string(agent.id), requireObject(agent.finalResult, "Agent.finalResult")]));
  const rankById = new Map(objects(validated.raw.finalRanking).map(entry => [string(entry.agentId), number(entry.rank)]));
  let previousPrices: number[] = [];
  let previousRanks = new Map<AgentId, number>();
  const days: ReplayDay[] = validated.days.map(coreDay => {
    const day = number(coreDay.day);
    const prices = requireNumberArray(coreDay.publicReferencePrice, ITEM_NAMES.length, `Day ${day} prices`);
    const events = objects(coreDay.events).sort((left, right) => (
      number(coreById.get(string(left.agentId))?.slot, 99)
      - number(coreById.get(string(right.agentId))?.slot, 99)
      || number(left.sequence) - number(right.sequence)
    ));
    const snapshots = objects(coreDay.agentSnapshots).map((snapshot): AgentSnapshot => {
      const agentId = string(snapshot.agentId);
      const state = requireObject(snapshot.state, `Day ${day} state`);
      const final = finalById.get(agentId)!;
      const status = requireStatus(state.status, "snapshot status");
      const technicalFailure = TECHNICAL_STATUSES.has(status)
        ? validateTechnicalFailure(final.technicalFailure, "technicalFailure")
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
      };
    });
    const rankable = day === 40
      ? snapshots.filter(snapshot => rankById.has(snapshot.agentId))
      : snapshots.filter(snapshot => snapshot.status === "running");
    const ordered = day === 40
      ? [...rankable].sort((a, b) => rankById.get(a.agentId)! - rankById.get(b.agentId)!)
      : [...rankable].sort((a, b) => b.netWorth - a.netWorth || a.agentId.localeCompare(b.agentId));
    const ranks = new Map(ordered.map((snapshot, index) => [snapshot.agentId, index + 1]));
    for (const snapshot of snapshots) {
      const rank = ranks.get(snapshot.agentId) ?? null;
      snapshot.provisionalRank = rank;
      snapshot.rankChange = rank === null || !previousRanks.has(snapshot.agentId)
        ? null
        : previousRanks.get(snapshot.agentId)! - rank;
    }
    previousRanks = new Map(ranks);
    const actions: AgentAction[] = events.filter(event => event.type === "action" && event.action !== undefined).map(event => {
      const payload = isObject(event.result) ? event.result : {};
      const stateAfter = requireObject(event.stateAfter, "event stateAfter");
      const code = optionalString(payload.code);
      return {
        id: string(event.id),
        agentId: string(event.agentId),
        sequence: number(event.sequence),
        summary: actionLabel(event.action),
        result: string(payload.message, "无结果说明"),
        success: payload.success === true,
        ...(code ? { code } : {}),
        location: LOCATION_NAMES[number(stateAfter.currentLocation, -1)] ?? "移动中",
      };
    });
    const adapted: ReplayDay = {
      day,
      prices: buildPrices(prices, previousPrices),
      agents: snapshots.sort((a, b) => (
        (profileById.get(a.agentId)?.visualIndex ?? 99) - (profileById.get(b.agentId)?.visualIndex ?? 99)
      )),
      actions,
      publicEvents: buildPublicEvents(events),
    };
    previousPrices = prices;
    return adapted;
  });
  const finalResults: FinalResult[] = coreAgents.map(agent => {
    const agentId = string(agent.id);
    const final = requireObject(agent.finalResult, "finalResult");
    const status = requireStatus(final.status, "finalResult.status");
    return {
      agentId,
      rank: rankById.get(agentId) ?? null,
      status: status as Exclude<PublicEpisodeStatus, "running">,
      exitDay: number(final.endDay),
      finalNetWorth: number(final.finalNetWorth),
      cash: number(final.cash),
      bank: number(final.bank),
      debt: number(final.debt),
      inventoryLiquidationValue: number(final.inventoryLiquidationValue),
      ...(TECHNICAL_STATUSES.has(status)
        ? { technicalFailure: validateTechnicalFailure(final.technicalFailure, "technicalFailure") }
        : {}),
    };
  }).sort((a, b) => {
    if (a.rank === null && b.rank === null) {
      return (profileById.get(a.agentId)?.visualIndex ?? 99) - (profileById.get(b.agentId)?.visualIndex ?? 99);
    }
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  });
  const corePersonal = requireObject(validated.raw.personalRandomEventAudit, "personalRandomEventAudit");
  const personalAgents: AgentPersonalRandomEventSummary[] = objects(corePersonal.agents).map(entry => ({
    agentId: string(entry.agentId),
    favorableEvents: number(entry.favorableEvents),
    adverseEvents: number(entry.adverseEvents),
    favorableInventoryEvents: number(entry.favorableInventoryEvents),
    adverseCashEvents: number(entry.adverseCashEvents),
    adverseDebtEvents: number(entry.adverseDebtEvents),
    adverseHealthEvents: number(entry.adverseHealthEvents),
  })).sort((a, b) => (
    (profileById.get(a.agentId)?.visualIndex ?? 99) - (profileById.get(b.agentId)?.visualIndex ?? 99)
  ));
  const personalRandomEventAudit: PersonalRandomEventAudit = {
    basis: "personal-event-count-v1",
    revealDay: 40,
    agents: personalAgents,
  };
  return {
    schemaVersion: "arena-replay-view-v2",
    executionMode: validated.executionMode,
    matchId: string(validated.raw.matchId),
    title: string(requireObject(validated.raw.metadata, "metadata").title),
    scenarioId: string(validated.raw.scenarioId),
    seed: number(validated.raw.seed),
    totalDays: 40,
    factLayerHash: validated.factHash,
    replayHash: validated.replayHash,
    agentProfiles: profiles,
    days,
    ...(validated.competitionAudit ? { competitionAudit: validated.competitionAudit } : {}),
    personalRandomEventAudit,
    finalResults,
  };
}

export type ReplaySource =
  | { status: "ready"; replay: ReplayArtifact; source: "injected-core" }
  | { status: "error"; message: string };

export function loadReplaySource(): ReplaySource {
  if (typeof document === "undefined") return { status: "error", message: "当前环境没有 DOM，无法读取 Replay" };
  const element = document.getElementById("arena-replay-data");
  if (!element?.textContent?.trim()) return { status: "error", message: "正式页面缺少 Replay 数据，已停止展示" };
  const source = element.textContent;
  element.remove();
  try {
    return { status: "ready", replay: adaptCoreMatchReplay(JSON.parse(source) as unknown), source: "injected-core" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Replay 解析失败" };
  }
}
