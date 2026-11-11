import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AssetSlot } from "./AssetSlot";
import { FullscreenControl } from "./FullscreenControl";
import type { AssetId } from "./asset-manifest";
import { audioManifest, type AudioAssetId } from "./audio-manifest";
import {
  loadReplayEnrichmentSource,
  type ReplayEnrichmentSource,
} from "./enrichment.ts";
import type { ReplayHighlight, ReplayHighlightKind } from "./enrichment-types.ts";
import { loadReplaySource, type ReplaySource } from "./replay-adapter.ts";
import { createVisibleReplaySlice, type VisibleReplaySlice } from "./replay-state.ts";
import { publicEventAsset } from "./public-event-assets.ts";
import type {
  AgentId,
  AgentProfile,
  AgentSnapshot,
  AssistanceReason,
  PublicEpisodeStatus,
  ReplayArtifact,
  ReplayDay,
} from "./replay-types.ts";

const GOLD1_MATCH_ID = "arena-completion-assisted-v1-prompt-v2-run-001-attempt-003";

const AGENT_COLORS = ["#8db0bf", "#d98255", "#54b5a7", "#d3ae55", "#9c7bc8"] as const;
const MODEL_PET_ASSETS = [
  "model.pet.gpt-5.6-sol",
  "model.pet.anthropic",
  "model.pet.qwen",
  "model.pet.kimi",
  "model.pet.deepseek",
] as const satisfies readonly AssetId[];
type ModelPetAssetId = (typeof MODEL_PET_ASSETS)[number];
const MODEL_PET_STAGE_IDLE_ASSETS = {
  "model.pet.gpt-5.6-sol": "model.pet.stage.gpt-5.6-sol.idle",
  "model.pet.anthropic": "model.pet.stage.anthropic.idle",
  "model.pet.qwen": "model.pet.stage.qwen.idle",
  "model.pet.kimi": "model.pet.stage.kimi.idle",
  "model.pet.deepseek": "model.pet.stage.deepseek.idle",
} as const satisfies Record<ModelPetAssetId, AssetId>;
const MODEL_PET_AVATAR_ASSETS = {
  "model.pet.gpt-5.6-sol": "model.avatar.gpt-5.6-sol",
  "model.pet.anthropic": "model.avatar.anthropic",
  "model.pet.qwen": "model.avatar.qwen",
  "model.pet.kimi": "model.pet.kimi",
  "model.pet.deepseek": "model.avatar.deepseek",
} as const satisfies Record<ModelPetAssetId, AssetId>;
const TECHNICAL_DNF = new Set<PublicEpisodeStatus>([
  "model_timeout", "tool_limit", "loop_terminated", "runtime_error",
]);
const STATUS_LABEL: Record<PublicEpisodeStatus, string> = {
  running: "比赛中",
  completed: "完赛",
  dead: "健康归零",
  bankrupt: "破产",
  model_timeout: "模型超时",
  tool_limit: "动作预算耗尽",
  loop_terminated: "无效动作循环",
  runtime_error: "Provider 运行错误",
};
const FAILURE_LABEL = {
  timeout: "请求超时",
  total_wall_clock: "总墙钟耗尽",
  context_limit: "模型上下文超限",
  action_budget: "动作预算耗尽",
  invalid_action_loop: "连续无效动作",
  transport_error: "网络传输错误",
  http_error: "Provider HTTP 错误",
  invalid_response: "响应协议无效",
  invalid_action: "模型动作无效",
  refusal: "模型拒绝响应",
  incomplete: "响应未完成",
  driver_error: "驱动错误",
} as const;
const HIGHLIGHT_LABEL: Record<ReplayHighlightKind, string> = {
  public_event: "公共事件",
  net_worth_swing: "净资产变化",
  debt_cleared: "债务清零",
  health_crisis: "健康危机",
  game_exit: "比赛退出",
  technical_dnf: "技术 DNF",
  final_result: "终局排名",
};
const ASSISTANCE_LABEL: Record<AssistanceReason, string> = {
  transient_retries_exhausted: "瞬态故障重试耗尽",
  repair_retries_exhausted: "输出修复重试耗尽",
  non_retryable_failure: "Provider 永久错误",
  circuit_open: "瞬态熔断跳过",
  provider_time_budget_exhausted: "Provider 时间预算耗尽",
};

function agentStyle(replay: ReplayArtifact, agentId: AgentId): CSSProperties {
  const profile = profileFor(replay, agentId);
  return { "--agent-color": AGENT_COLORS[profile.visualIndex] } as CSSProperties;
}

function modelPetAsset(profile: AgentProfile): ModelPetAssetId {
  const identity = `${profile.provider} ${profile.model}`.toLowerCase();
  if (/deepseek/u.test(identity)) return "model.pet.deepseek";
  if (/moonshot|kimi/u.test(identity)) return "model.pet.kimi";
  if (/qwen|alibaba|dashscope/u.test(identity)) return "model.pet.qwen";
  if (/anthropic|claude/u.test(identity)) return "model.pet.anthropic";
  if (/openai|gpt/u.test(identity)) return "model.pet.gpt-5.6-sol";
  return MODEL_PET_ASSETS[profile.visualIndex] ?? MODEL_PET_ASSETS[0];
}

function modelPetStageIdleAsset(profile: AgentProfile): AssetId {
  return MODEL_PET_STAGE_IDLE_ASSETS[modelPetAsset(profile)];
}

function modelPetAvatarAsset(profile: AgentProfile): AssetId {
  return MODEL_PET_AVATAR_ASSETS[modelPetAsset(profile)];
}

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function profileFor(replay: ReplayArtifact, agentId: AgentId): AgentProfile {
  const profile = replay.agentProfiles.find(agent => agent.id === agentId);
  if (!profile) throw new Error(`找不到 Agent ${agentId}`);
  return profile;
}

function rankDelta(value: number | null): string {
  if (value === null) return "—";
  if (value > 0) return `↑${value}`;
  if (value < 0) return `↓${Math.abs(value)}`;
  return "持平";
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>, dialog: HTMLElement | null): void {
  if (event.key !== "Tab") return;
  const focusable = [...(dialog?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) ?? [])].filter(element => !element.hidden);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1)!;
  const active = document.activeElement;
  if (focusable.length === 1 || (!event.shiftKey && active === last) || (event.shiftKey && active === first)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

function Header({
  replay,
  day,
  isPlaying,
  musicState,
  playButtonRef,
  onChange,
  onTogglePlay,
  onToggleMusic,
}: {
  replay: ReplayArtifact;
  day: number;
  isPlaying: boolean;
  musicState: "off" | "playing" | "error";
  playButtonRef: React.RefObject<HTMLButtonElement | null>;
  onChange: (day: number) => void;
  onTogglePlay: () => void;
  onToggleMusic: () => void;
}) {
  const [value, setValue] = useState(String(day));
  useEffect(() => setValue(String(day)), [day]);
  const target = Number(value);
  const targetIsValid = Number.isSafeInteger(target) && target >= 1 && target <= replay.totalDays;
  const submitLabel = targetIsValid ? `${target > day ? "揭示至" : "跳转至"}第 ${target} 天` : "跳转";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (targetIsValid) onChange(target);
  };
  const playLabel = isPlaying ? "暂停回放" : "播放回放";
  return (
    <header className={replay.matchId === GOLD1_MATCH_ID ? "topbar topbar--compact" : "topbar"}>
      <div className="brand-block">
        <p className="eyebrow">五模型事实回放</p>
        <div className="brand-title-line">
          <h1>北京浮生记：AI 发财生存赛</h1>
        </div>
        {replay.matchId !== GOLD1_MATCH_ID && (
          <div className="match-meta">
            <h2 className="match-title">{replay.title}</h2>
            <span>{replay.matchId}</span>
            <span>seed {replay.seed}</span>
          </div>
        )}
      </div>
      <div className="match-status" aria-live="polite">
        <span>{replay.competitionAudit?.runTrack === "completion-assisted-v1"
          ? "五模型 · Completion-Assisted 事实层"
          : replay.executionMode === "direct" ? "五模型 · Direct 事实层" : "内部 Scripted 回归"}</span>
        <strong>第 <em>{day}</em>/{replay.totalDays} 天</strong>
      </div>
      <div className="transport-buttons" aria-label="回放播放控制">
        {(replay.matchId === GOLD1_MATCH_ID || document.getElementById("arena-session-data")) && (
          <a className="home-return-control" href="./index.html">返回首页</a>
        )}
        <button type="button" disabled={day === 1} onClick={() => onChange(day - 1)}>前一天</button>
        <button
          ref={playButtonRef}
          type="button"
          className="primary-control"
          aria-label={playLabel}
          aria-pressed={isPlaying}
          disabled={day === replay.totalDays && !isPlaying}
          onClick={onTogglePlay}
        >{isPlaying ? "暂停" : day === replay.totalDays ? "已结束" : "播放"}<small>回放</small></button>
        <button type="button" disabled={day === replay.totalDays} onClick={() => onChange(day + 1)}>后一天</button>
        {!document.getElementById("arena-session-data") && <button
          type="button"
          aria-label="背景音乐开关"
          aria-pressed={musicState === "playing"}
          disabled={musicState === "error"}
          onClick={onToggleMusic}
        >{musicState === "playing" ? "音乐：开" : musicState === "error" ? "音乐不可用" : "音乐：关"}</button>}
        <FullscreenControl />
        <form className="jump-form" onSubmit={submit}>
          <input aria-label="跳转到第几天" type="number" min="1" max={replay.totalDays} value={value} onChange={event => setValue(event.target.value)} />
          <button type="submit" disabled={!targetIsValid} title={submitLabel}>跳转</button>
        </form>
      </div>
    </header>
  );
}

function PricesPanel({ day }: { day: ReplayDay }) {
  return (
    <section className="panel prices-panel" aria-labelledby="prices-title">
      <div className="panel-title">
        <div><p>公共参考价</p><h2 id="prices-title">今日物价</h2></div>
        <span>第 {day.day} 天</span>
      </div>
      <table className="price-table">
        <thead><tr><th scope="col">商品</th><th scope="col">现价</th><th scope="col">涨跌</th></tr></thead>
        <tbody>{day.prices.map(quote => (
          <tr key={quote.itemId}>
            <th scope="row">{quote.commodity}</th>
            <td>{money(quote.price)}</td>
            <td className={quote.changePercent > 0 ? "up" : quote.changePercent < 0 ? "down" : ""}>
              {quote.changePercent > 0 ? "+" : ""}{quote.changePercent.toFixed(1)}%
            </td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function PublicEventsPanel({ day }: { day: ReplayDay }) {
  const first = day.publicEvents[0];
  return (
    <section className={`panel events-panel ${first ? "" : "events-panel--empty"}`} aria-labelledby="events-title">
      <div className={`panel-title ${first ? "panel-title--alert" : ""}`}>
        <div><p>共享外生事实</p><h2 id="events-title">公共事件</h2></div>
        <span>{first ? `第 ${day.day} 天发生` : "本日无新增"}</span>
      </div>
      {first ? (
        <>
          <AssetSlot assetId={publicEventAsset(first)} className="event-art" fallback={<span>事件图片不可用，保留事实文字。</span>} />
          <div className="event-lead"><b>{first.title}</b><span>{first.summary}</span></div>
          {day.publicEvents.length > 1 && <ul>{day.publicEvents.slice(1).map(event => <li key={event.id}><b>{event.title}</b><span>{event.summary}</span></li>)}</ul>}
        </>
      ) : (
        <>
          <AssetSlot
            assetId="event.calm-park"
            className="event-art"
            fallback={<span>公园占位图不可用；仍保留本日无新增公共事件的事实。</span>}
          />
          <p className="empty-fact">本日没有新增公共事件。</p>
        </>
      )}
    </section>
  );
}

function SharedStage({ replay, day }: { replay: ReplayArtifact; day: ReplayDay }) {
  return (
    <section className="shared-stage" aria-labelledby="stage-title">
      <header className="stage-heading">
        <div><p>共享舞台 · 事实动作</p><h2 id="stage-title">五模型同场</h2></div>
        <span>动作卡是事实记录，不是模型发言或思维过程</span>
      </header>
      <AssetSlot
        assetId="arena.stage.zhongguancun.2000s"
        className="stage-art"
        loading="eager"
        fallback={<span>共享舞台图片不可用；五个事实槽位仍保留。</span>}
      />
      <div className="stage-action-grid">
        {replay.agentProfiles.map(profile => {
          const snapshot = day.agents.find(agent => agent.agentId === profile.id)!;
          const actions = day.actions.filter(action => action.agentId === profile.id);
          return (
            <section
              key={profile.id}
              className={`stage-slot ${TECHNICAL_DNF.has(snapshot.status) ? "stage-slot--dnf" : ""}`}
              style={agentStyle(replay, profile.id)}
              aria-label={`${profile.label} 舞台事实`}
            >
              <div className="action-bubble">
                <small>事实动作</small>
                {actions.length ? actions.slice(0, 2).map(action => <span key={action.id}>{action.summary}</span>) : (
                  <span>{snapshot.status === "running" ? "本日无可执行动作记录" : `第 ${snapshot.exitDay} 天后无动作`}</span>
                )}
              </div>
              <AssetSlot
                assetId={modelPetStageIdleAsset(profile)}
                className="stage-character stage-character--idle"
                loading="eager"
                fallback={<span aria-hidden="true" />}
              />
              <div className="stage-identity">
                <b>{profile.label}</b>
                <span>{TECHNICAL_DNF.has(snapshot.status) ? "DNF · " : ""}{STATUS_LABEL[snapshot.status]}</span>
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function AgentStatusCard({
  replay,
  snapshot,
  day,
  onOpen,
}: {
  replay: ReplayArtifact;
  snapshot: AgentSnapshot;
  day: number;
  onOpen: (agentId: AgentId) => void;
}) {
  const profile = profileFor(replay, snapshot.agentId);
  const isDnf = TECHNICAL_DNF.has(snapshot.status);
  return (
    <article
      className={`agent-card ${snapshot.status !== "running" && day < 40 ? "exited" : ""} ${isDnf ? "dnf" : ""}`}
      style={agentStyle(replay, snapshot.agentId)}
    >
      <span className="rank-mark">{isDnf ? "DNF" : snapshot.provisionalRank === null ? "—" : `#${snapshot.provisionalRank}`}</span>
      <AssetSlot assetId={modelPetAvatarAsset(profile)} className="agent-avatar" fallback={<span aria-hidden="true" />} />
      <span className="agent-identity"><b>{profile.label}</b><small>{STATUS_LABEL[snapshot.status]} · 名次 {rankDelta(snapshot.rankChange)}</small></span>
      <span className="worth"><small>净资产</small><b>{money(snapshot.netWorth)}</b></span>
      <span className="compact-metrics"><i><small>现金</small>{money(snapshot.cash)}</i><i><small>债务</small>{money(snapshot.debt)}</i><i><small>健康</small>{snapshot.health}</i></span>
      {snapshot.status !== "running" && day < 40 && (
        <span className="exit-line">第 {snapshot.exitDay} 天退出{snapshot.technicalFailure ? ` · ${FAILURE_LABEL[snapshot.technicalFailure.category]}` : ""}</span>
      )}
      <button type="button" className="agent-card-trigger" onClick={() => onOpen(snapshot.agentId)} aria-label={`查看 ${profile.label} 详情`} />
    </article>
  );
}

function StandingsPanel({ replay, day, onOpen }: { replay: ReplayArtifact; day: ReplayDay; onOpen: (agentId: AgentId) => void }) {
  const sorted = [...day.agents].sort((left, right) => {
    if (left.provisionalRank === null && right.provisionalRank === null) return left.agentId.localeCompare(right.agentId);
    if (left.provisionalRank === null) return 1;
    if (right.provisionalRank === null) return -1;
    return left.provisionalRank - right.provisionalRank;
  });
  return (
    <section className="panel standings-panel" aria-labelledby="standings-title">
      <div className="panel-title">
        <div><p>{day.day === 40 ? "核心统一结算" : "按净资产排序"}</p><h2 id="standings-title">{day.day === 40 ? "正式排名" : "实时排名"}</h2></div>
        <span>{day.day === 40 ? "最终结果" : `第 ${day.day} 天`}</span>
      </div>
      <div className="agent-list">
        {sorted.map(snapshot => <AgentStatusCard key={snapshot.agentId} replay={replay} snapshot={snapshot} day={day.day} onOpen={onOpen} />)}
      </div>
      {day.day < 40 && <p className="panel-note">按当日公开参考价暂定；技术 DNF 保留占位且无正式名次。</p>}
    </section>
  );
}

function TimelinePanel({
  replay,
  slice,
  highlights,
  enrichment,
  onChange,
  onOpenHighlight,
}: {
  replay: ReplayArtifact;
  slice: VisibleReplaySlice;
  highlights: ReplayHighlight[];
  enrichment: ReplayEnrichmentSource;
  onChange: (day: number) => void;
  onOpenHighlight: (highlight: ReplayHighlight) => void;
}) {
  const curated = enrichment.status === "ready"
    && enrichment.enrichment.generator.id === "curated-highlights";
  const visible = highlights
    .filter(highlight => highlight.day <= slice.visibleThroughDay)
    .sort((a, b) => a.day - b.day || b.priority - a.priority);
  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-title">
        <div><p>已揭示事实进度</p><h2 id="timeline-title">比赛时间线</h2></div>
        <strong>第 {slice.visibleThroughDay}/{replay.totalDays} 天</strong>
      </div>
      <div className="timeline-control">
        <div className="timeline-slider-shell">
          <input
            className="timeline-range"
            type="range"
            aria-label="回放日期"
            aria-valuetext={`第 ${slice.visibleThroughDay} 天`}
            min="1"
            max={replay.totalDays}
            value={slice.visibleThroughDay}
            onChange={event => onChange(Number(event.target.value))}
            style={{ "--reveal-progress": `${((slice.visibleThroughDay - 1) / (replay.totalDays - 1)) * 100}%` } as CSSProperties}
          />
          <div className="timeline-markers" aria-hidden="true">
            {visible.map(highlight => <i key={highlight.id} className={highlight.featured ? "featured" : ""} style={{ left: `${((highlight.day - 1) / (replay.totalDays - 1)) * 100}%` }} />)}
          </div>
        </div>
        <div className="timeline-days" aria-hidden="true"><span>1</span><span>10</span><span>20</span><span>30</span><span>40</span></div>
      </div>
      <div className="timeline-reveal-row">
        <p className={`enrichment-state enrichment-state--${enrichment.status}`}>
          <b>{curated ? "精选高光" : "程序高光"}</b>
          <span>{enrichment.status === "ready"
            ? `${enrichment.enrichment.highlights.length} 条 · ${curated ? "人工白名单 · " : ""}hash 已核验`
            : enrichment.message}</span>
        </p>
        <div className="highlight-list">
          {visible.length ? visible.slice(-3).map(highlight => (
          <button key={highlight.id} type="button" onClick={() => onOpenHighlight(highlight)}>
            <span>第 {highlight.day} 天</span><b>{highlight.title}</b>
          </button>
          )) : <span>尚无已揭示{curated ? "精选" : "程序"}高光</span>}
        </div>
      </div>
    </section>
  );
}

function ActionsPanel({ replay, day }: { replay: ReplayArtifact; day: ReplayDay }) {
  return (
    <section className="panel actions-panel" aria-labelledby="actions-title">
      <div className="panel-title"><div><p>摘要与完整序列</p><h2 id="actions-title">今日动作</h2></div><span>第 {day.day} 天</span></div>
      <div className="action-rows">
        {replay.agentProfiles.map(profile => {
          const actions = day.actions.filter(action => action.agentId === profile.id);
          const snapshot = day.agents.find(agent => agent.agentId === profile.id)!;
          const latest = actions.at(-1);
          const emptyMessage = snapshot.status === "running" ? "本日没有可执行动作记录。" : `已于第 ${snapshot.exitDay} 天退出，无后续动作。`;
          return (
            <section key={profile.id} className="action-row" style={agentStyle(replay, profile.id)} aria-label={`${profile.label} 当日动作`}>
              <details>
                <summary>
                  <span className="action-identity"><b>{profile.label}</b><small>{actions.length} 个动作</small></span>
                  <span className="action-latest"><small>最新动作</small><b>{latest?.summary ?? "无新增动作"}</b></span>
                  <span className={`action-result ${latest && !latest.success ? "invalid" : ""}`}><small>结果</small><b>{latest?.result ?? emptyMessage}</b></span>
                  <span className="action-place"><small>地点</small><b>{latest?.location ?? snapshot.location}</b></span>
                </summary>
                <div className="action-sequence">
                  {actions.length ? <ol>{actions.map((action, index) => (
                    <li key={action.id} className={`${action.success ? "" : "invalid"} ${action.assisted ? "assisted" : ""}`.trim()}>
                      <span>{index + 1}</span><div><b>{action.summary}</b><small>{action.assistanceReason ? `${ASSISTANCE_LABEL[action.assistanceReason]} · ` : ""}{action.result}{action.code ? ` · ${action.code}` : ""}</small></div><i>{action.location}</i>
                    </li>
                  ))}</ol> : <p>{emptyMessage}</p>}
                </div>
              </details>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function NetWorthChart({ replay, slice }: { replay: ReplayArtifact; slice: VisibleReplaySlice }) {
  const width = 900;
  const height = 190;
  const inset = { left: 54, right: 16, top: 16, bottom: 28 };
  const values = slice.days.flatMap(day => day.agents.map(agent => agent.netWorth));
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(1, ...values);
  const range = Math.max(1, maximum - minimum);
  const x = (day: number) => inset.left + ((day - 1) / 39) * (width - inset.left - inset.right);
  const y = (value: number) => inset.top + (1 - ((value - minimum) / range)) * (height - inset.top - inset.bottom);
  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="panel-title"><div><p>仅含已揭示事实</p><h2 id="chart-title">净资产曲线</h2></div><span>截至第 {slice.visibleThroughDay} 天</span></div>
      <ul className="chart-legend" aria-label="五模型当前净资产">
        {replay.agentProfiles.map(profile => {
          const snapshot = slice.latestDay.agents.find(agent => agent.agentId === profile.id)!;
          return <li key={profile.id} style={agentStyle(replay, profile.id)}><i aria-hidden="true" /><span>{profile.label}</span><b>{money(snapshot.netWorth)}</b></li>;
        })}
      </ul>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`第 1 天到第 ${slice.visibleThroughDay} 天净资产轨迹`}>
        {[0, 0.5, 1].map(ratio => {
          const lineY = inset.top + ratio * (height - inset.top - inset.bottom);
          const value = maximum - ratio * range;
          return <g key={ratio}><line x1={inset.left} x2={width - inset.right} y1={lineY} y2={lineY} /><text x={inset.left - 7} y={lineY + 4} textAnchor="end">{Math.round(value / 1000)}K</text></g>;
        })}
        {[1, 10, 20, 30, 40].map(tick => <text key={tick} x={x(tick)} y={height - 6} textAnchor="middle">{tick}</text>)}
        {replay.agentProfiles.map(profile => {
          const path = slice.days.map((day, index) => {
            const value = day.agents.find(agent => agent.agentId === profile.id)?.netWorth ?? 0;
            return `${index ? "L" : "M"} ${x(day.day).toFixed(2)} ${y(value).toFixed(2)}`;
          }).join(" ");
          return <path key={profile.id} d={path} stroke={AGENT_COLORS[profile.visualIndex]} />;
        })}
        <line className="cursor" x1={x(slice.visibleThroughDay)} x2={x(slice.visibleThroughDay)} y1={inset.top} y2={height - inset.bottom} />
      </svg>
    </section>
  );
}

function Finale({ replay, slice }: { replay: ReplayArtifact; slice: VisibleReplaySlice }) {
  if (!slice.finalResults || !slice.personalRandomEventAudit) return null;
  return (
    <section className="panel finale-panel" aria-labelledby="finale-title">
      <div className="panel-title"><div><p>核心正式结果</p><h2 id="finale-title">第 40 天统一结算</h2></div><span>防剧透已解除</span></div>
      <div className="final-table" role="table" aria-label="正式排名">
        {slice.finalResults.map(result => {
          const profile = profileFor(replay, result.agentId);
          return (
            <div role="row" key={result.agentId} className={result.rank === null ? "dnf" : ""} style={agentStyle(replay, result.agentId)}>
              <b role="cell">{result.rank === null ? "DNF" : `#${result.rank}`}</b><span role="cell">{profile.label}</span><strong role="cell">{money(result.finalNetWorth)}</strong><i role="cell">{STATUS_LABEL[result.status]}{result.technicalFailure ? ` · ${FAILURE_LABEL[result.technicalFailure.category]}` : ""}</i>
            </div>
          );
        })}
      </div>
      <div className="personal-event-audit">
        <header><b>个人随机事件原始计数</b><span>只陈列事实，不作奖项或运气结论。</span></header>
        {slice.personalRandomEventAudit.agents.map(entry => (
          <div key={entry.agentId} style={agentStyle(replay, entry.agentId)}>
            <b>{profileFor(replay, entry.agentId).label}</b><span>负面 {entry.adverseEvents}</span><span>正面 {entry.favorableEvents}</span><small>现金 {entry.adverseCashEvents} · 债务 {entry.adverseDebtEvents} · 健康 {entry.adverseHealthEvents} · 库存 {entry.favorableInventoryEvents}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function AgentModal({ replay, slice, agentId, onClose }: { replay: ReplayArtifact; slice: VisibleReplaySlice; agentId: AgentId; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const profile = profileFor(replay, agentId);
  const snapshot = slice.latestDay.agents.find(agent => agent.agentId === agentId)!;
  const reliability = slice.visibleThroughDay === replay.totalDays
    ? replay.reliabilityAudit?.agents.find(agent => agent.agentId === agentId)
    : undefined;
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div className="modal-backdrop" onMouseDown={event => {
      if (event.currentTarget === event.target) {
        event.preventDefault();
        onClose();
      }
    }}>
      <section ref={dialogRef} className="agent-modal" role="dialog" aria-modal="true" aria-labelledby="agent-modal-title" style={agentStyle(replay, agentId)} onKeyDown={event => trapDialogFocus(event, dialogRef.current)}>
        <header><div><p>数据截至第 {slice.visibleThroughDay} 天</p><h2 id="agent-modal-title">{profile.label}</h2></div><button ref={closeRef} type="button" onClick={onClose}>关闭</button></header>
        <div className="modal-metrics">
          <div><span>现金</span><b>{money(snapshot.cash)}</b></div><div><span>存款</span><b>{money(snapshot.bank)}</b></div><div><span>债务</span><b>{money(snapshot.debt)}</b></div><div><span>健康</span><b>{snapshot.health}</b></div><div><span>净资产</span><b>{money(snapshot.netWorth)}</b></div><div><span>地点</span><b>{snapshot.location}</b></div>
        </div>
        {snapshot.technicalFailure && <p className="failure-notice">技术 DNF：{FAILURE_LABEL[snapshot.technicalFailure.category]} · 第 {snapshot.exitDay} 天退出 · 阶段 {snapshot.technicalFailure.phase}</p>}
        {reliability && <section className="reliability-card" aria-label="可靠性评分卡">
          <h3>Completion-Assisted 可靠性评分卡</h3>
          <div><span>自主推进</span><b>{reliability.autonomousDays}/{reliability.advancedDays} 天 · {reliability.autonomousDayRate}%</b></div>
          <div><span>首次请求成功</span><b>{reliability.firstAttemptSuccessRate}%</b></div>
          <div><span>有效计划选择</span><b>{reliability.validSelectionRate}%</b></div>
          <div><span>Provider 请求成功</span><b>{reliability.providerRequestSuccessRate}%</b></div>
          <div><span>重试 / 辅助</span><b>{reliability.retryCount} / {reliability.assistedDays}</b></div>
          <div><span>熔断 / 预算耗尽日</span><b>{reliability.circuitSkippedDays} / {reliability.providerBudgetExhaustedDays}</b></div>
        </section>}
        <div className="modal-columns">
          <section><h3>当前库存</h3>{snapshot.inventory.length ? <ul>{snapshot.inventory.map(line => <li key={line.itemId}><b>{line.name} × {line.quantity}</b><span>均价 {money(line.averageCost)} · 计值 {money(line.markedValue)}</span></li>)}</ul> : <p>无库存</p>}</section>
          <section><h3>最近 8 个已揭示日</h3><ol>{slice.days.slice(-8).map(day => {
            const item = day.agents.find(agent => agent.agentId === agentId)!;
            return <li key={day.day}><span>第 {day.day} 天</span><b>{money(item.netWorth)}</b><small>{item.location}</small></li>;
          })}</ol></section>
        </div>
      </section>
    </div>
  );
}

const CURATED_HIGHLIGHT_ASSETS = {
  "g1-04-qwen-comeback": "highlight.gold1.qwen-comeback",
  "g1-08-altman-gift": "highlight.gold1.altman-gift",
  "g1-14-deepseek-gamble": "highlight.gold1.deepseek-gamble",
  "g1-18-claude-exit": "highlight.gold1.dario-exit",
  "g1-20-final-podium": "highlight.gold1.podium",
} as const satisfies Partial<Record<string, AssetId>>;

const CURATED_HIGHLIGHT_VOICE_ASSETS = {
  "g1-14-deepseek-gamble": "highlight.gold1.voice.deepseek-gamble",
  "g1-18-claude-exit": "highlight.gold1.voice.dario-exit",
  "g1-20-final-podium": "highlight.gold1.voice.final-victory",
} as const satisfies Partial<Record<string, AudioAssetId>>;

function highlightAsset(highlight: ReplayHighlight): AssetId {
  const curated = CURATED_HIGHLIGHT_ASSETS[highlight.id as keyof typeof CURATED_HIGHLIGHT_ASSETS];
  if (curated) return curated;
  if (highlight.kind === "technical_dnf") return "event.technical-exit";
  if (highlight.kind === "health_crisis" || highlight.kind === "debt_cleared" || highlight.kind === "game_exit") return "event.health-debt-crisis";
  return "event.market.volatility";
}

function highlightVoiceAsset(highlight: ReplayHighlight): AudioAssetId | undefined {
  return CURATED_HIGHLIGHT_VOICE_ASSETS[highlight.id as keyof typeof CURATED_HIGHLIGHT_VOICE_ASSETS];
}

function HighlightModal({ replay, highlight, onClose }: { replay: ReplayArtifact; highlight: ReplayHighlight; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const participants = highlight.agentIds.map(agentId => profileFor(replay, agentId).label);
  return (
    <div className="modal-backdrop highlight-backdrop" onMouseDown={event => {
      if (event.currentTarget === event.target) {
        event.preventDefault();
        onClose();
      }
    }}>
      <section ref={dialogRef} className="highlight-modal" role="dialog" aria-modal="true" aria-labelledby="highlight-title" onKeyDown={event => trapDialogFocus(event, dialogRef.current)}>
        <AssetSlot assetId={highlightAsset(highlight)} className="highlight-art" fallback={<span>高光图片不可用，以下事实证据仍有效。</span>} loading="eager" />
        <div className="highlight-content">
          <p>{highlight.id.startsWith("g1-") ? "CURATED FACT HIGHLIGHT" : highlight.featured ? "FEATURED FACT HIGHLIGHT" : "FACT HIGHLIGHT"} · DAY {String(highlight.day).padStart(2, "0")}</p>
          <h2 id="highlight-title">{highlight.title}</h2>
          <span>{HIGHLIGHT_LABEL[highlight.kind]}{participants.length ? ` · ${participants.join("、")}` : " · 全场公共事实"}</span>
          <strong>{highlight.summary}</strong>
          <details><summary>证据事件 ID（{highlight.evidenceEventIds.length}）</summary><ul>{highlight.evidenceEventIds.map(id => <li key={id}><code>{id}</code></li>)}</ul></details>
          <small>自动播放已暂停。关闭后不会自行继续。</small>
          <button ref={closeRef} type="button" onClick={onClose}>关闭高光</button>
        </div>
      </section>
    </div>
  );
}

function exportVisibleFacts(replay: ReplayArtifact, slice: VisibleReplaySlice): void {
  const label = (agentId: AgentId) => profileFor(replay, agentId).label;
  const payload = {
    schemaVersion: replay.schemaVersion,
    matchId: replay.matchId,
    visibleThroughDay: slice.visibleThroughDay,
    replayHash: replay.replayHash,
    participants: replay.agentProfiles.map(profile => ({ provider: profile.provider, model: profile.model })),
    days: slice.days.map(day => ({
      ...day,
      agents: day.agents.map(({ agentId, ...agent }) => ({ participant: label(agentId), ...agent })),
      actions: day.actions.map(({ agentId, ...action }) => ({ participant: label(agentId), ...action })),
    })),
    ...(slice.finalResults ? {
      finalResults: slice.finalResults.map(({ agentId, ...result }) => ({ participant: label(agentId), ...result })),
      personalRandomEventAudit: {
        basis: slice.personalRandomEventAudit!.basis,
        revealDay: slice.personalRandomEventAudit!.revealDay,
        agents: slice.personalRandomEventAudit!.agents.map(({ agentId, ...entry }) => ({ participant: label(agentId), ...entry })),
      },
      ...(replay.reliabilityAudit ? {
        reliabilityAudit: {
          policyVersion: replay.reliabilityAudit.policyVersion,
          agents: replay.reliabilityAudit.agents.map(({ agentId, ...entry }) => ({
            participant: label(agentId),
            ...entry,
          })),
        },
      } : {}),
    } : {}),
  };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${replay.matchId}-day-${slice.visibleThroughDay}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function AuditFooter({ replay, slice }: { replay: ReplayArtifact; slice: VisibleReplaySlice }) {
  const audit = replay.competitionAudit;
  const reliability = slice.visibleThroughDay === replay.totalDays ? replay.reliabilityAudit : undefined;
  const reliabilityTotals = reliability ? {
    autonomousDays: reliability.agents.reduce((sum, item) => sum + item.autonomousDays, 0),
    assistedDays: reliability.agents.reduce((sum, item) => sum + item.assistedDays, 0),
    retries: reliability.agents.reduce((sum, item) => sum + item.retryCount, 0),
  } : undefined;
  return (
    <footer className="audit-footer" aria-label="回放审计区">
      <div className="audit-summary">
        <b>{audit?.runTrack === "completion-assisted-v1" ? "Completion-Assisted 可靠性" : audit ? "比赛公平性参数" : "内部确定性 Fixture"}</b>
        {audit ? (
          <span>
            {reliabilityTotals
              ? `自主 ${reliabilityTotals.autonomousDays} 天 · 辅助 ${reliabilityTotals.assistedDays} 天 · 重试 ${reliabilityTotals.retries} 次`
              : audit.runTrack === "completion-assisted-v1"
                ? `终局揭示可靠性评分卡 · ${audit.contextPolicyVersion} · ${audit.recoveryPolicyVersion} · 轮换 ${audit.slotRotation.rotationIndex}`
                : `${audit.contextPolicyVersion} · ${audit.recoveryPolicyVersion} · 公共随机同 seed · ${audit.slotRotation.version} / 轮换 ${audit.slotRotation.rotationIndex} · ${audit.maxActionsPerAgent} 动作 · ${audit.automaticRetries} 自动重试`}
          </span>
        ) : <span>未调用 Provider，不属于在线模型验收。</span>}
      </div>
      <div className="audit-hashes">
        <p data-replay-hash-marker="true"><span>回放哈希</span><code>{replay.replayHash}</code></p>
        <p data-fact-layer-hash-marker="true"><span>事实层哈希</span><code>{replay.factLayerHash}</code></p>
      </div>
      <div className="audit-actions">
        <span>{document.getElementById("arena-session-data") ? "事实与高光分层" : "事实与高光分层 · 私有离线 Demo"}</span>
        <button type="button" onClick={() => exportVisibleFacts(replay, slice)}>导出当前已揭示事实</button>
      </div>
    </footer>
  );
}

export function ReplayView({ replay, enrichment }: { replay: ReplayArtifact; enrichment: ReplayEnrichmentSource }) {
  const sessionView = Boolean(document.getElementById("arena-session-data"));
  const [day, setDay] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [musicState, setMusicState] = useState<"off" | "playing" | "error">("off");
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<ReplayHighlight | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const highlightVoiceRef = useRef<HTMLAudioElement>(null);
  const slice = useMemo(() => createVisibleReplaySlice(replay, day), [replay, day]);
  const highlights = enrichment.status === "ready" ? enrichment.enrichment.highlights : [];

  const stopHighlightVoice = () => {
    const voice = highlightVoiceRef.current;
    if (!voice) return;
    voice.pause();
    voice.currentTime = 0;
    delete voice.dataset.audioAssetId;
  };
  const playHighlightVoice = (highlight: ReplayHighlight) => {
    if (sessionView) return;
    stopHighlightVoice();
    const assetId = highlightVoiceAsset(highlight);
    const voice = highlightVoiceRef.current;
    if (!assetId || !voice) return;
    voice.src = audioManifest[assetId].src;
    voice.dataset.audioAssetId = assetId;
    voice.currentTime = 0;
    voice.volume = 1;
    void voice.play().catch(() => {
      // 浏览器可能因自动播放策略拒绝非点击触发的语音；不影响事实层与弹窗交互。
    });
  };

  const changeDay = (nextDay: number) => {
    setIsPlaying(false);
    stopHighlightVoice();
    setActiveHighlight(null);
    setDay(Math.max(1, Math.min(replay.totalDays, nextDay)));
  };
  const openAgent = (agentId: AgentId) => {
    setIsPlaying(false);
    stopHighlightVoice();
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedAgent(agentId);
  };
  const openHighlight = (highlight: ReplayHighlight) => {
    setIsPlaying(false);
    playHighlightVoice(highlight);
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : playButtonRef.current;
    setActiveHighlight(highlight);
  };
  const closeDialog = () => {
    stopHighlightVoice();
    setSelectedAgent(null);
    setActiveHighlight(null);
  };

  useEffect(() => {
    if (selectedAgent !== null || activeHighlight !== null || !returnFocusRef.current) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    target.focus();
  }, [selectedAgent, activeHighlight]);

  useEffect(() => {
    if (!isPlaying || activeHighlight || selectedAgent) return;
    if (day >= replay.totalDays) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const nextDay = Math.min(replay.totalDays, day + 1);
      setDay(nextDay);
      const featured = highlights.find(highlight => highlight.featured && highlight.day === nextDay);
      if (featured) {
        returnFocusRef.current = playButtonRef.current;
        setIsPlaying(false);
        playHighlightVoice(featured);
        setActiveHighlight(featured);
      } else if (nextDay === replay.totalDays) {
        setIsPlaying(false);
      }
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [activeHighlight, day, highlights, isPlaying, replay.totalDays, selectedAgent]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDialog();
        return;
      }
      if ((event.target as HTMLElement | null)?.matches("input, button, textarea, select, summary")) return;
      if (event.key === "ArrowLeft") changeDay(day - 1);
      if (event.key === "ArrowRight") changeDay(day + 1);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [day]);

  const toggleMusic = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (musicState === "playing") {
      audio.pause();
      setMusicState("off");
      return;
    }
    audio.volume = 0.25;
    audio.loop = true;
    try {
      await audio.play();
      setMusicState("playing");
    } catch {
      setMusicState("error");
    }
  };

  return (
    <div className="arena-shell">
      <Header
        replay={replay}
        day={day}
        isPlaying={isPlaying}
        musicState={musicState}
        playButtonRef={playButtonRef}
        onChange={changeDay}
        onTogglePlay={() => setIsPlaying(value => !value)}
        onToggleMusic={toggleMusic}
      />
      <main className="replay-grid">
        <div className="market-column"><PricesPanel day={slice.latestDay} /><PublicEventsPanel day={slice.latestDay} /></div>
        <SharedStage replay={replay} day={slice.latestDay} />
        <StandingsPanel replay={replay} day={slice.latestDay} onOpen={openAgent} />
        <TimelinePanel replay={replay} slice={slice} highlights={highlights} enrichment={enrichment} onChange={changeDay} onOpenHighlight={openHighlight} />
        <NetWorthChart replay={replay} slice={slice} />
        <ActionsPanel replay={replay} day={slice.latestDay} />
        <Finale replay={replay} slice={slice} />
      </main>
      <AuditFooter replay={replay} slice={slice} />
      {!sessionView && <audio ref={audioRef} src={audioManifest["demo.bgm.happy-times"].src} preload="none" onError={() => setMusicState("error")} />}
      {!sessionView && <audio ref={highlightVoiceRef} data-highlight-voice="true" preload="auto" />}
      {selectedAgent && <AgentModal replay={replay} slice={slice} agentId={selectedAgent} onClose={closeDialog} />}
      {activeHighlight && <HighlightModal replay={replay} highlight={activeHighlight} onClose={closeDialog} />}
    </div>
  );
}

function ReplayLoadError({ source }: { source: Extract<ReplaySource, { status: "error" }> }) {
  return (
    <main className="load-error"><p>REPLAY VALIDATION FAILED</p><h1>正式回放已停止展示</h1><span>{source.message}</span><small>页面不会回退到替代动作、排名或叙事数据。请用有效 replay.json 重新构建。</small></main>
  );
}

export function App() {
  const [sources] = useState(() => {
    const replay = loadReplaySource();
    if (replay.status === "error") {
      document.getElementById("arena-replay-enrichment-data")?.remove();
      return { replay, enrichment: null };
    }
    return { replay, enrichment: loadReplayEnrichmentSource(replay.replay) };
  });
  if (sources.replay.status === "error") return <ReplayLoadError source={sources.replay} />;
  return <ReplayView replay={sources.replay.replay} enrichment={sources.enrichment!} />;
}
