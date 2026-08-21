import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadReplaySource, type ReplaySource } from "./replay-adapter.ts";
import { createVisibleReplaySlice, type VisibleReplaySlice } from "./replay-state.ts";
import type {
  AgentId,
  AgentProfile,
  AgentSnapshot,
  PublicEpisodeStatus,
  ReplayArtifact,
  ReplayDay,
} from "./replay-types.ts";

const AGENT_COLORS: Record<AgentId, string> = {
  A: "#f4c35b",
  B: "#51d6bd",
  C: "#ff7a6f",
  D: "#82a7ff",
};
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
  action_budget: "动作预算耗尽",
  invalid_action_loop: "连续无效动作",
  transport_error: "网络传输错误",
  http_error: "Provider HTTP 错误",
  invalid_response: "响应或动作无效",
  refusal: "Provider 拒绝响应",
  incomplete: "响应未完成",
  driver_error: "驱动错误",
} as const;

function agentStyle(agentId: AgentId): CSSProperties {
  return { "--agent-color": AGENT_COLORS[agentId] } as CSSProperties;
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

function Header({ replay, day }: { replay: ReplayArtifact; day: number }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">DIRECT-ONLY ARENA · FACT REPLAY</p>
        <h1>{replay.title}</h1>
        <p className="match-meta">{replay.matchId} · seed {replay.seed} · 第 {day}/40 天</p>
      </div>
      <div className="hash-block" data-replay-hash-marker="true">
        <span>{replay.executionMode === "direct" ? "受控四模型展示赛" : "显式 Scripted 金样"}</span>
        <small>回放哈希</small>
        <code>{replay.replayHash}</code>
      </div>
    </header>
  );
}

function FairnessStrip({ replay }: { replay: ReplayArtifact }) {
  const audit = replay.competitionAudit;
  if (!audit) {
    return <section className="audit-strip"><b>Scripted 金样</b><span>未调用 Provider，不属于在线模型验收。</span></section>;
  }
  return (
    <section className="audit-strip" aria-label="比赛公平性审计">
      <b>{audit.decisionPolicyId}</b>
      <span>无身份观察：{audit.modelObservationVersion}</span>
      <span>公共随机：同 seed</span>
      <span>个人随机：槽位隔离</span>
      <span>预算：{audit.maxActionsPerAgent} 动作 / {audit.decisionTimeoutMs}ms / {audit.maxOutputTokensPerRequest} tokens / 0 重试</span>
    </section>
  );
}

function DayControls({
  replay,
  day,
  onChange,
}: {
  replay: ReplayArtifact;
  day: number;
  onChange: (day: number) => void;
}) {
  const [value, setValue] = useState(String(day));
  useEffect(() => setValue(String(day)), [day]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const target = Number(value);
    if (Number.isSafeInteger(target) && target >= 1 && target <= replay.totalDays) onChange(target);
  };
  return (
    <section className="day-controls" aria-label="回放日期控制">
      <button type="button" disabled={day === 1} onClick={() => onChange(day - 1)}>前一天</button>
      <label>
        <span>第 {day} 天</span>
        <input
          type="range"
          min="1"
          max={replay.totalDays}
          value={day}
          onChange={event => onChange(Number(event.target.value))}
        />
      </label>
      <button type="button" disabled={day === replay.totalDays} onClick={() => onChange(day + 1)}>下一天</button>
      <form onSubmit={submit}>
        <input aria-label="跳转日期" type="number" min="1" max="40" value={value} onChange={event => setValue(event.target.value)} />
        <button type="submit">跳转</button>
      </form>
    </section>
  );
}

function PricesPanel({ day }: { day: ReplayDay }) {
  return (
    <section className="panel prices-panel" aria-labelledby="prices-title">
      <div className="panel-title"><p>PUBLIC REFERENCE</p><h2 id="prices-title">公开参考价</h2></div>
      <div className="price-grid">
        {day.prices.map(quote => (
          <div key={quote.itemId}>
            <span>{quote.commodity}</span>
            <b>{money(quote.price)}</b>
            <small className={quote.changePercent > 0 ? "up" : quote.changePercent < 0 ? "down" : ""}>
              {quote.changePercent > 0 ? "+" : ""}{quote.changePercent.toFixed(1)}%
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}

function PublicEventsPanel({ day }: { day: ReplayDay }) {
  return (
    <section className="panel events-panel" aria-labelledby="events-title">
      <div className="panel-title"><p>SHARED EXOGENOUS FACTS</p><h2 id="events-title">公共事件</h2></div>
      {day.publicEvents.length ? (
        <ul>{day.publicEvents.map(event => <li key={event.id}><b>{event.title}</b><span>{event.summary}</span></li>)}</ul>
      ) : <p className="empty-fact">本日没有新增公共事件。</p>}
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
  const rank = snapshot.provisionalRank;
  return (
    <button
      type="button"
      className={`agent-card ${snapshot.status !== "running" && day < 40 ? "exited" : ""} ${isDnf ? "dnf" : ""}`}
      style={agentStyle(snapshot.agentId)}
      onClick={() => onOpen(snapshot.agentId)}
      aria-label={`查看 Agent ${snapshot.agentId} ${profile.name} 详情`}
    >
      <span className="rank-mark">{isDnf ? "DNF" : rank === null ? "—" : `#${rank}`}</span>
      <span className="agent-letter">{snapshot.agentId}</span>
      <span className="agent-identity">
        <b>{profile.name}</b>
        <small>{profile.provider} · {profile.model}</small>
        <small>{profile.adapterVersion}</small>
      </span>
      <span className="worth"><small>净资产</small><b>{money(snapshot.netWorth)}</b></span>
      <span className="rank-change"><small>名次变化</small><b>{rankDelta(snapshot.rankChange)}</b></span>
      <span className="compact-metrics">
        <i>现金 {money(snapshot.cash)}</i><i>存款 {money(snapshot.bank)}</i><i>债务 {money(snapshot.debt)}</i><i>健康 {snapshot.health}</i>
      </span>
      {snapshot.status !== "running" && day < 40 && (
        <span className="exit-line">{STATUS_LABEL[snapshot.status]} · 第 {snapshot.exitDay} 天退出{snapshot.technicalFailure ? ` · ${FAILURE_LABEL[snapshot.technicalFailure.category]}` : ""}</span>
      )}
    </button>
  );
}

function StandingsPanel({
  replay,
  day,
  onOpen,
}: {
  replay: ReplayArtifact;
  day: ReplayDay;
  onOpen: (agentId: AgentId) => void;
}) {
  const sorted = [...day.agents].sort((left, right) => {
    if (left.provisionalRank === null && right.provisionalRank === null) return left.agentId.localeCompare(right.agentId);
    if (left.provisionalRank === null) return 1;
    if (right.provisionalRank === null) return -1;
    return left.provisionalRank - right.provisionalRank;
  });
  return (
    <section className="panel standings-panel" aria-labelledby="standings-title">
      <div className="panel-title">
        <p>{day.day === 40 ? "CORE SETTLEMENT" : "PUBLIC MARK-TO-MARKET"}</p>
        <h2 id="standings-title">{day.day === 40 ? "第 40 天正式排名" : "公开参考价暂定排名"}</h2>
      </div>
      <div className="agent-list">
        {sorted.map(snapshot => <AgentStatusCard key={snapshot.agentId} replay={replay} snapshot={snapshot} day={day.day} onOpen={onOpen} />)}
      </div>
      {day.day < 40 && <p className="panel-note">暂定净资产按当日公开参考价计值；只比较仍在比赛中的 Agent，不等同于终局结算。</p>}
    </section>
  );
}

function ActionsPanel({ replay, day }: { replay: ReplayArtifact; day: ReplayDay }) {
  return (
    <section className="panel actions-panel" aria-labelledby="actions-title">
      <div className="panel-title"><p>COMPLETE DAILY SEQUENCE</p><h2 id="actions-title">当日完整动作与结果</h2></div>
      <div className="action-groups">
        {replay.agentProfiles.map(profile => {
          const actions = day.actions.filter(action => action.agentId === profile.id);
          const snapshot = day.agents.find(agent => agent.agentId === profile.id)!;
          return (
            <section key={profile.id} className="action-group" style={agentStyle(profile.id)} aria-label={`Agent ${profile.id} 当日动作`}>
              <header><b>{profile.id} · {profile.name}</b><span>{actions.length} 个动作</span></header>
              {actions.length ? (
                <ol>{actions.map((action, index) => (
                  <li key={action.id} className={action.success ? "" : "invalid"}>
                    <span>{index + 1}</span>
                    <div><b>{action.summary}</b><small>{action.result}{action.code ? ` · ${action.code}` : ""}</small></div>
                    <i>{action.location}</i>
                  </li>
                ))}</ol>
              ) : (
                <p>{snapshot.status === "running" ? "本日没有可执行动作记录。" : `已于第 ${snapshot.exitDay} 天退出，无后续动作。`}</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function NetWorthChart({ replay, slice }: { replay: ReplayArtifact; slice: VisibleReplaySlice }) {
  const width = 920;
  const height = 210;
  const inset = { left: 58, right: 18, top: 18, bottom: 30 };
  const values = slice.days.flatMap(day => day.agents.map(agent => agent.netWorth));
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(1, ...values);
  const range = Math.max(1, maximum - minimum);
  const x = (day: number) => inset.left + ((day - 1) / 39) * (width - inset.left - inset.right);
  const y = (value: number) => inset.top + (1 - ((value - minimum) / range)) * (height - inset.top - inset.bottom);
  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="panel-title"><p>VISIBLE FACTS ONLY</p><h2 id="chart-title">已揭示净资产轨迹</h2></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`第 1 天到第 ${slice.visibleThroughDay} 天净资产轨迹`}>
        {[0, 0.5, 1].map(ratio => {
          const lineY = inset.top + ratio * (height - inset.top - inset.bottom);
          const value = maximum - ratio * range;
          return <g key={ratio}><line x1={inset.left} x2={width - inset.right} y1={lineY} y2={lineY} /><text x={inset.left - 8} y={lineY + 4} textAnchor="end">{Math.round(value / 1000)}K</text></g>;
        })}
        {[1, 10, 20, 30, 40].map(tick => <text key={tick} x={x(tick)} y={height - 7} textAnchor="middle">{tick}</text>)}
        {replay.agentProfiles.map(profile => {
          const path = slice.days.map((day, index) => {
            const value = day.agents.find(agent => agent.agentId === profile.id)?.netWorth ?? 0;
            return `${index ? "L" : "M"} ${x(day.day).toFixed(2)} ${y(value).toFixed(2)}`;
          }).join(" ");
          return <path key={profile.id} d={path} stroke={AGENT_COLORS[profile.id]} />;
        })}
        <line className="cursor" x1={x(slice.visibleThroughDay)} x2={x(slice.visibleThroughDay)} y1={inset.top} y2={height - inset.bottom} />
      </svg>
    </section>
  );
}

function Finale({ replay, slice }: { replay: ReplayArtifact; slice: VisibleReplaySlice }) {
  if (!slice.finalResults || !slice.luckAudit) {
    return null;
  }
  return (
    <section className="panel finale-panel" aria-labelledby="finale-title">
      <div className="panel-title"><p>OFFICIAL CORE RESULT</p><h2 id="finale-title">第 40 天统一结算</h2></div>
      <div className="final-table" role="table" aria-label="正式排名">
        {slice.finalResults.map(result => {
          const profile = profileFor(replay, result.agentId);
          return (
            <div role="row" key={result.agentId} className={result.rank === null ? "dnf" : ""} style={agentStyle(result.agentId)}>
              <b role="cell">{result.rank === null ? "DNF" : `#${result.rank}`}</b>
              <span role="cell">{result.agentId} · {profile.name}<small>{profile.provider} · {profile.model}</small></span>
              <strong role="cell">{money(result.finalNetWorth)}</strong>
              <i role="cell">{STATUS_LABEL[result.status]}{result.technicalFailure ? ` · ${FAILURE_LABEL[result.technicalFailure.category]}` : ""}</i>
            </div>
          );
        })}
      </div>
      <div className="luck-audit">
        <header><b>个人随机事件审计</b><span>负面更少、再比较正面更多；反向为最倒霉，允许并列。</span></header>
        {slice.luckAudit.agents.map(entry => (
          <div key={entry.agentId} style={agentStyle(entry.agentId)}>
            <b>{entry.agentId}</b><span>负面 {entry.adverseEvents}</span><span>正面 {entry.favorableEvents}</span>
            <small>现金 {entry.adverseCashEvents} · 债务 {entry.adverseDebtEvents} · 健康 {entry.adverseHealthEvents} · 库存赠送 {entry.favorableInventoryEvents}</small>
          </div>
        ))}
        <p>最幸运：{slice.luckAudit.luckiestAgentIds.join(" / ")}　最倒霉：{slice.luckAudit.unluckiestAgentIds.join(" / ")}</p>
      </div>
    </section>
  );
}

function AgentModal({
  replay,
  slice,
  agentId,
  onClose,
}: {
  replay: ReplayArtifact;
  slice: VisibleReplaySlice;
  agentId: AgentId;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const profile = profileFor(replay, agentId);
  const snapshot = slice.latestDay.agents.find(agent => agent.agentId === agentId)!;
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="agent-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" style={agentStyle(agentId)}>
        <header>
          <span className="agent-letter">{agentId}</span>
          <div><p>数据截至第 {slice.visibleThroughDay} 天</p><h2 id="modal-title">{profile.name}</h2><small>{profile.provider} · {profile.model} · {profile.adapterVersion}</small></div>
          <button ref={closeRef} type="button" onClick={onClose}>关闭</button>
        </header>
        <div className="modal-metrics">
          <div><span>现金</span><b>{money(snapshot.cash)}</b></div><div><span>存款</span><b>{money(snapshot.bank)}</b></div>
          <div><span>债务</span><b>{money(snapshot.debt)}</b></div><div><span>健康</span><b>{snapshot.health}</b></div>
          <div><span>净资产</span><b>{money(snapshot.netWorth)}</b></div><div><span>地点</span><b>{snapshot.location}</b></div>
        </div>
        {snapshot.technicalFailure && (
          <p className="failure-notice">技术 DNF：{FAILURE_LABEL[snapshot.technicalFailure.category]} · 第 {snapshot.exitDay} 天退出 · 阶段 {snapshot.technicalFailure.phase}</p>
        )}
        <div className="modal-columns">
          <section><h3>当前库存</h3>{snapshot.inventory.length ? <ul>{snapshot.inventory.map(line => <li key={line.itemId}><b>{line.name} × {line.quantity}</b><span>均价 {money(line.averageCost)} · 参考价 {money(line.referencePrice)} · 计值 {money(line.markedValue)}</span></li>)}</ul> : <p>无库存</p>}</section>
          <section><h3>最近 8 个已揭示日</h3><ol>{slice.days.slice(-8).map(day => {
            const item = day.agents.find(agent => agent.agentId === agentId)!;
            return <li key={day.day}><span>第 {day.day} 天</span><b>{money(item.netWorth)}</b><small>{item.location}</small></li>;
          })}</ol></section>
        </div>
      </section>
    </div>
  );
}

function exportVisibleFacts(replay: ReplayArtifact, slice: VisibleReplaySlice): void {
  const payload = {
    schemaVersion: replay.schemaVersion,
    matchId: replay.matchId,
    visibleThroughDay: slice.visibleThroughDay,
    replayHash: replay.replayHash,
    days: slice.days,
    ...(slice.finalResults ? { finalResults: slice.finalResults, luckAudit: slice.luckAudit } : {}),
  };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${replay.matchId}-day-${slice.visibleThroughDay}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Dashboard({ replay }: { replay: ReplayArtifact }) {
  const [day, setDay] = useState(1);
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const slice = useMemo(() => createVisibleReplaySlice(replay, day), [replay, day]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedAgent(null);
      if ((event.target as HTMLElement | null)?.matches("input, button, textarea, select")) return;
      if (event.key === "ArrowLeft") setDay(value => Math.max(1, value - 1));
      if (event.key === "ArrowRight") setDay(value => Math.min(40, value + 1));
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  return (
    <div className="arena-shell">
      <Header replay={replay} day={day} />
      <FairnessStrip replay={replay} />
      <DayControls replay={replay} day={day} onChange={setDay} />
      <main>
        <div className="market-column"><PricesPanel day={slice.latestDay} /><PublicEventsPanel day={slice.latestDay} /></div>
        <StandingsPanel replay={replay} day={slice.latestDay} onOpen={setSelectedAgent} />
        <ActionsPanel replay={replay} day={slice.latestDay} />
        <NetWorthChart replay={replay} slice={slice} />
        <Finale replay={replay} slice={slice} />
      </main>
      <footer>
        <span>事实层哈希 <code>{replay.factLayerHash}</code></span>
        <button type="button" onClick={() => exportVisibleFacts(replay, slice)}>导出当前已揭示事实</button>
      </footer>
      {selectedAgent && <AgentModal replay={replay} slice={slice} agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />}
    </div>
  );
}

function ReplayLoadError({ source }: { source: Extract<ReplaySource, { status: "error" }> }) {
  return (
    <main className="load-error">
      <p>REPLAY VALIDATION FAILED</p>
      <h1>正式回放已停止展示</h1>
      <span>{source.message}</span>
      <small>页面不会回退到任何替代动作、排名或叙事数据。请用有效 replay.json 重新执行 arena:replay。</small>
    </main>
  );
}

export function App() {
  const [source] = useState<ReplaySource>(() => loadReplaySource());
  if (source.status === "error") return <ReplayLoadError source={source} />;
  return <Dashboard replay={source.replay} />;
}
