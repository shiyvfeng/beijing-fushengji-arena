import { integrityHash } from "./replay-integrity.ts";
import type {
  ReplayEnrichmentArtifact,
  ReplayEnrichmentGeneratorId,
  ReplayHighlight,
  ReplayHighlightKind,
} from "./enrichment-types.ts";
import type {
  AgentId,
  AgentSnapshot,
  PublicEpisodeStatus,
  ReplayArtifact,
} from "./replay-types.ts";

type JsonObject = Record<string, unknown>;

interface HighlightCandidate extends Omit<ReplayHighlight, "featured"> {
  magnitude: number;
}
const TECHNICAL_DNF = new Set<PublicEpisodeStatus>([
  "model_timeout",
  "tool_limit",
  "loop_terminated",
  "runtime_error",
]);

const HIGHLIGHT_KINDS = new Set<ReplayHighlightKind>([
  "public_event",
  "net_worth_swing",
  "debt_cleared",
  "health_crisis",
  "game_exit",
  "technical_dnf",
  "final_result",
]);

const GENERATOR_CONFIG = {
  featureLimit: 8,
  evidencePolicy: "same-day-structured-event-id-v1",
  mergePolicy: "same-agent-same-day-highest-priority-v1",
  orderPolicy: "priority-magnitude-day-id-v1",
  rules: [
    "status-exit",
    "debt-cleared",
    "first-health-below-30",
    "public-event",
    "largest-daily-net-worth-swing-per-agent",
  ],
} as const;

export const PROGRAMMATIC_HIGHLIGHT_CONFIG_HASH = integrityHash(GENERATOR_CONFIG);

const GOLD1_CURATED_SOURCE = {
  matchId: "arena-completion-assisted-v1-prompt-v2-run-001-attempt-003",
  replayHash: "sha256:cb2a3e476ebc6761fbcb1d2e3be9f886b40ac50a5c39bd00ebb53bccffaaa225",
  factLayerHash: "sha256:f0a9aacd3f3819e975b2f2cf9ff9f6af568598045569a866d63d415f95e8bb26",
} as const;

const GOLD1_CURATED_HIGHLIGHTS = [
  {
    id: "g1-04-qwen-comeback",
    day: 21,
    kind: "net_worth_swing",
    title: "Qwen 逆袭登顶",
    summary: "Qwen 卖出 100 份进口香烟，单日净资产增加 30,957 元，并反超至第一。",
    agentIds: ["competitor-4"],
    evidenceEventIds: [
      "event_372e2c2bf5f05c9f",
      "event_fcd5066552a38f52",
      "event_752e92a866337611",
    ],
    priority: 92,
    featured: true,
  },
  {
    id: "g1-08-altman-gift",
    day: 24,
    kind: "net_worth_swing",
    title: "获赠假酒，现场变现还债",
    summary: "Altman 获赠 4 瓶假白酒，当天卖出 13,976 元并全部用于还债，单日净资产增加 11,292 元。",
    agentIds: ["competitor-1"],
    evidenceEventIds: [
      "event_d8bdad9ca04c7ece",
      "event_e831e9687e4aa7ed",
      "event_467e7ea381dc9410",
    ],
    priority: 94,
    featured: true,
  },
  {
    id: "g1-14-deepseek-gamble",
    day: 32,
    kind: "net_worth_swing",
    title: "梭哈假白酒，反超登顶",
    summary: "DeepSeek 第 30 天投入 9,180 元买入 4 瓶假白酒，占当时现金 87%；第 32 天以 94,584 元卖出，单日净资产增加 94,373 元并反超至第一。",
    agentIds: ["competitor-3"],
    evidenceEventIds: [
      "event_651292f85e7f672a",
      "global_147a05a1fe2179a1",
      "event_1df455811be80c40",
      "event_2b4e9edc8eab885d",
    ],
    priority: 100,
    featured: true,
  },
  {
    id: "g1-18-claude-exit",
    day: 36,
    kind: "game_exit",
    title: "Claude 遗憾退场",
    summary: "Claude 的健康由 2 降至 0，成为本场首位游戏内退场者。",
    agentIds: ["competitor-2"],
    evidenceEventIds: ["event_db117fc6ccb0fc1f"],
    priority: 98,
    featured: true,
  },
  {
    id: "g1-20-final-podium",
    day: 40,
    kind: "final_result",
    title: "终局揭晓",
    summary: "统一结算后，DeepSeek 以 97,052 元夺冠，Qwen 以 34,085 元获得第二，OpenAI 以 -54,260 元获得第三。",
    agentIds: ["competitor-3", "competitor-4", "competitor-1"],
    evidenceEventIds: [
      "event_eab8ec98cc567fe7",
      "event_4f0358c0b401dcb2",
      "event_b4da5df698de5aca",
      "event_59d8bd382bc61b87",
      "event_4ceb7b5b2bdfbf46",
      "event_fb792a368fc9d595",
    ],
    priority: 110,
    featured: true,
  },
] as const satisfies readonly ReplayHighlight[];

const CURATED_HIGHLIGHT_CONFIG = {
  source: GOLD1_CURATED_SOURCE,
  evidencePolicy: "same-or-earlier-day-structured-event-id-v1",
  orderPolicy: "explicit-user-allowlist-v1",
  highlights: GOLD1_CURATED_HIGHLIGHTS,
} as const;

export const CURATED_HIGHLIGHT_CONFIG_HASH = integrityHash(CURATED_HIGHLIGHT_CONFIG);

export type ReplayEnrichmentSource =
  | { status: "ready"; enrichment: ReplayEnrichmentArtifact }
  | { status: "missing"; message: string }
  | { status: "error"; message: string };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotFor(replay: ReplayArtifact, day: number, agentId: AgentId): AgentSnapshot | undefined {
  return replay.days[day - 1]?.agents.find(snapshot => snapshot.agentId === agentId);
}

function evidence(snapshot: AgentSnapshot): string[] {
  return [...new Set(snapshot.evidenceEventIds.filter(Boolean))].sort();
}

function compactId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 72) || "fact";
}

function candidate(
  values: Omit<HighlightCandidate, "evidenceEventIds"> & { evidenceEventIds: string[] },
): HighlightCandidate | null {
  const evidenceEventIds = [...new Set(values.evidenceEventIds.filter(Boolean))].sort();
  return evidenceEventIds.length ? { ...values, evidenceEventIds } : null;
}

function mergeSameAgentDay(candidates: HighlightCandidate[]): HighlightCandidate[] {
  const grouped = new Map<string, HighlightCandidate>();
  const publicCandidates: HighlightCandidate[] = [];
  for (const item of candidates) {
    if (item.agentIds.length !== 1) {
      publicCandidates.push(item);
      continue;
    }
    const key = `${item.day}\0${item.agentIds[0]}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, item);
      continue;
    }
    const preferred = compareCandidates(item, current) < 0 ? item : current;
    grouped.set(key, {
      ...preferred,
      id: `highlight-${item.day}-${compactId(item.agentIds[0])}-${preferred.kind}`,
      evidenceEventIds: [...new Set([...current.evidenceEventIds, ...item.evidenceEventIds])].sort(),
      magnitude: Math.max(current.magnitude, item.magnitude),
    });
  }
  return [...grouped.values(), ...publicCandidates];
}

function compareCandidates(left: HighlightCandidate, right: HighlightCandidate): number {
  return right.priority - left.priority
    || right.magnitude - left.magnitude
    || left.day - right.day
    || left.id.localeCompare(right.id, "en");
}

function profileLabel(replay: ReplayArtifact, agentId: AgentId): string {
  return replay.agentProfiles.find(profile => profile.id === agentId)?.label ?? agentId;
}

function buildCandidates(replay: ReplayArtifact): HighlightCandidate[] {
  const candidates: HighlightCandidate[] = [];
  const firstHealthCrisis = new Set<AgentId>();
  const largestSwing = new Map<AgentId, HighlightCandidate>();

  for (const day of replay.days) {
    for (const publicEvent of day.publicEvents) {
      const item = candidate({
        id: `highlight-${day.day}-public-${compactId(publicEvent.id)}`,
        day: day.day,
        kind: "public_event",
        title: publicEvent.title,
        summary: publicEvent.summary,
        agentIds: [],
        evidenceEventIds: [publicEvent.id],
        priority: 80,
        magnitude: 0,
      });
      if (item) candidates.push(item);
    }

    for (const current of day.agents) {
      const previous = day.day > 1 ? snapshotFor(replay, day.day - 1, current.agentId) : undefined;
      const currentEvidence = evidence(current);
      const label = profileLabel(replay, current.agentId);

      if (previous?.status === "running" && current.status !== "running") {
        const technical = TECHNICAL_DNF.has(current.status);
        const item = candidate({
          id: `highlight-${day.day}-${compactId(current.agentId)}-${technical ? "technical-dnf" : "game-exit"}`,
          day: day.day,
          kind: technical ? "technical_dnf" : "game_exit",
          title: technical ? "技术退出" : "比赛状态退出",
          summary: technical
            ? `${label} 因技术状态 ${current.status} 退出，保留舞台占位且不计正式名次。`
            : `${label} 的比赛状态由 running 变为 ${current.status}。`,
          agentIds: [current.agentId],
          evidenceEventIds: currentEvidence,
          priority: technical ? 100 : 95,
          magnitude: 0,
        });
        if (item) candidates.push(item);
      }

      if (previous && previous.debt > 0 && current.debt === 0) {
        const item = candidate({
          id: `highlight-${day.day}-${compactId(current.agentId)}-debt-cleared`,
          day: day.day,
          kind: "debt_cleared",
          title: "债务清零",
          summary: `${label} 将债务从 ${previous.debt.toLocaleString("zh-CN")} 元降至 0 元。`,
          agentIds: [current.agentId],
          evidenceEventIds: currentEvidence,
          priority: 90,
          magnitude: previous.debt,
        });
        if (item) candidates.push(item);
      }

      if (!firstHealthCrisis.has(current.agentId) && current.health < 30) {
        firstHealthCrisis.add(current.agentId);
        if (previous && previous.health >= 30) {
          const item = candidate({
            id: `highlight-${day.day}-${compactId(current.agentId)}-health-crisis`,
            day: day.day,
            kind: "health_crisis",
            title: "健康首次跌破 30",
            summary: `${label} 的健康由 ${previous.health} 降至 ${current.health}。`,
            agentIds: [current.agentId],
            evidenceEventIds: currentEvidence,
            priority: 85,
            magnitude: previous.health - current.health,
          });
          if (item) candidates.push(item);
        }
      }

      if (previous) {
        const delta = current.netWorth - previous.netWorth;
        const magnitude = Math.abs(delta);
        const item = candidate({
          id: `highlight-${day.day}-${compactId(current.agentId)}-net-worth-swing`,
          day: day.day,
          kind: "net_worth_swing",
          title: "最大单日净资产变化",
          summary: `${label} 单日净资产${delta >= 0 ? "增加" : "减少"} ${Math.abs(delta).toLocaleString("zh-CN")} 元。`,
          agentIds: [current.agentId],
          evidenceEventIds: currentEvidence,
          priority: 70,
          magnitude,
        });
        const existing = largestSwing.get(current.agentId);
        if (item && (!existing || compareCandidates(item, existing) < 0)) {
          largestSwing.set(current.agentId, item);
        }
      }
    }
  }

  candidates.push(...largestSwing.values());
  return mergeSameAgentDay(candidates).sort(compareCandidates);
}

export function generateReplayEnrichment(replay: ReplayArtifact): ReplayEnrichmentArtifact {
  const ranked = buildCandidates(replay);
  const body = {
    schemaVersion: "arena-replay-enrichment-v1" as const,
    sourceReplayHash: replay.replayHash,
    sourceFactHash: replay.factLayerHash,
    generator: {
      id: "programmatic-highlights" as const,
      version: "1.0.0" as const,
      configHash: PROGRAMMATIC_HIGHLIGHT_CONFIG_HASH,
    },
    highlights: ranked.map(({ magnitude: _magnitude, ...item }, index) => ({
      ...item,
      featured: index < GENERATOR_CONFIG.featureLimit,
    })),
  };
  return { ...body, enrichmentHash: integrityHash(body) };
}

export function generateCuratedReplayEnrichment(replay: ReplayArtifact): ReplayEnrichmentArtifact {
  if (replay.matchId !== GOLD1_CURATED_SOURCE.matchId
    || replay.replayHash !== GOLD1_CURATED_SOURCE.replayHash
    || replay.factLayerHash !== GOLD1_CURATED_SOURCE.factLayerHash) {
    throw new Error("人工精选高光仅适用于已核验的 Gold1 Replay");
  }
  const body = {
    schemaVersion: "arena-replay-enrichment-v1" as const,
    sourceReplayHash: replay.replayHash,
    sourceFactHash: replay.factLayerHash,
    generator: {
      id: "curated-highlights" as const,
      version: "1.0.0" as const,
      configHash: CURATED_HIGHLIGHT_CONFIG_HASH,
    },
    highlights: GOLD1_CURATED_HIGHLIGHTS.map(highlight => ({
      ...highlight,
      agentIds: [...highlight.agentIds],
      evidenceEventIds: [...highlight.evidenceEventIds],
    })),
  };
  return { ...body, enrichmentHash: integrityHash(body) };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} 必须是字符串数组`);
  }
  return value as string[];
}

export function validateReplayEnrichment(
  rawValue: unknown,
  replay: ReplayArtifact,
): ReplayEnrichmentArtifact {
  if (!isObject(rawValue)) throw new Error("Enrichment 顶层必须是对象");
  if (rawValue.schemaVersion !== "arena-replay-enrichment-v1") throw new Error("Enrichment schemaVersion 无效");
  if (rawValue.sourceReplayHash !== replay.replayHash) throw new Error("Enrichment sourceReplayHash 与 Replay 不一致");
  if (rawValue.sourceFactHash !== replay.factLayerHash) throw new Error("Enrichment sourceFactHash 与事实层不一致");
  const generator = rawValue.generator;
  if (!isObject(generator)) throw new Error("Enrichment generator 无效");
  const generatorId = generator.id;
  if (generatorId !== "programmatic-highlights" && generatorId !== "curated-highlights") {
    throw new Error("Enrichment generator id 无效");
  }
  const expectedConfigHash = generatorId === "programmatic-highlights"
    ? PROGRAMMATIC_HIGHLIGHT_CONFIG_HASH
    : CURATED_HIGHLIGHT_CONFIG_HASH;
  if (generator.version !== "1.0.0" || generator.configHash !== expectedConfigHash) {
    throw new Error("Enrichment generator 或 configHash 无效");
  }
  if (!Array.isArray(rawValue.highlights)) throw new Error("Enrichment highlights 必须是数组");
  const knownAgents = new Set(replay.agentProfiles.map(profile => profile.id));
  const evidenceByDay = new Map(replay.days.map(day => [
    day.day,
    new Set([
      ...day.actions.map(action => action.id),
      ...day.publicEvents.map(event => event.id),
      ...day.agents.flatMap(snapshot => snapshot.evidenceEventIds),
    ]),
  ]));
  const evidenceDay = new Map<string, number>();
  for (const [day, eventIds] of evidenceByDay) {
    for (const eventId of eventIds) evidenceDay.set(eventId, day);
  }
  const highlights: ReplayHighlight[] = rawValue.highlights.map((value, index) => {
    if (!isObject(value)) throw new Error(`highlights[${index}] 必须是对象`);
    const id = requireString(value.id, `highlights[${index}].id`);
    const day = value.day;
    const priority = value.priority;
    const kind = value.kind;
    if (!Number.isSafeInteger(day) || (day as number) < 1 || (day as number) > replay.totalDays) {
      throw new Error(`highlights[${index}].day 越界`);
    }
    if (!Number.isSafeInteger(priority)) throw new Error(`highlights[${index}].priority 必须是整数`);
    if (!HIGHLIGHT_KINDS.has(kind as ReplayHighlightKind)) throw new Error(`highlights[${index}].kind 无效`);
    if (typeof value.featured !== "boolean") throw new Error(`highlights[${index}].featured 必须是布尔值`);
    const agentIds = requireStringArray(value.agentIds, `highlights[${index}].agentIds`);
    if (agentIds.some(agentId => !knownAgents.has(agentId))) throw new Error(`highlights[${index}] 引用未知 Agent`);
    const evidenceEventIds = requireStringArray(value.evidenceEventIds, `highlights[${index}].evidenceEventIds`);
    const highlightDay = day as number;
    if (!evidenceEventIds.length) throw new Error(`highlights[${index}] 缺少有效 evidenceEventIds`);
    if (generatorId === "programmatic-highlights") {
      if (evidenceEventIds.some(eventId => !evidenceByDay.get(highlightDay)?.has(eventId))) {
        throw new Error(`highlights[${index}] 缺少同日有效 evidenceEventIds`);
      }
    } else {
      const sourceDays = evidenceEventIds.map(eventId => evidenceDay.get(eventId));
      if (sourceDays.some(sourceDay => sourceDay === undefined || sourceDay > highlightDay)
        || !sourceDays.some(sourceDay => sourceDay === highlightDay)) {
        throw new Error(`highlights[${index}] 必须引用同日或更早证据，且至少包含一个同日事件`);
      }
    }
    return {
      id,
      day: day as number,
      kind: kind as ReplayHighlightKind,
      title: requireString(value.title, `highlights[${index}].title`),
      summary: requireString(value.summary, `highlights[${index}].summary`),
      agentIds,
      evidenceEventIds,
      priority: priority as number,
      featured: value.featured,
    };
  });
  if (highlights.filter(item => item.featured).length > GENERATOR_CONFIG.featureLimit) {
    throw new Error("Enrichment featured 高光不得超过 8 条");
  }
  const enrichmentHash = requireString(rawValue.enrichmentHash, "Enrichment.enrichmentHash");
  const body = { ...rawValue };
  delete body.enrichmentHash;
  if (integrityHash(body) !== enrichmentHash) throw new Error("Enrichment 内容与 enrichmentHash 不一致");

  const validated: ReplayEnrichmentArtifact = {
    schemaVersion: "arena-replay-enrichment-v1",
    sourceReplayHash: replay.replayHash,
    sourceFactHash: replay.factLayerHash,
    generator: {
      id: generatorId as ReplayEnrichmentGeneratorId,
      version: "1.0.0",
      configHash: expectedConfigHash,
    },
    highlights,
    enrichmentHash,
  };
  const expected = generatorId === "programmatic-highlights"
    ? generateReplayEnrichment(replay)
    : generateCuratedReplayEnrichment(replay);
  if (integrityHash(validated) !== integrityHash(expected)) {
    throw new Error(generatorId === "programmatic-highlights"
      ? "Enrichment 与确定性程序高光结果不一致"
      : "Enrichment 与 Gold1 人工精选白名单不一致");
  }
  return validated;
}

export function loadReplayEnrichmentSource(replay: ReplayArtifact): ReplayEnrichmentSource {
  if (typeof document === "undefined") {
    return { status: "missing", message: "当前环境没有 DOM，程序高光未加载" };
  }
  const element = document.getElementById("arena-replay-enrichment-data");
  if (!element?.textContent?.trim()) {
    element?.remove();
    return { status: "missing", message: "未提供程序高光，事实回放仍可正常使用" };
  }
  const source = element.textContent;
  element.remove();
  try {
    return { status: "ready", enrichment: validateReplayEnrichment(JSON.parse(source) as unknown, replay) };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Enrichment 解析失败",
    };
  }
}
