import { useMemo, useState, type CSSProperties } from "react";
import benchDataSource from "./bench-data.generated.json";
import {
  CROSS_RUN_REVIEWS,
  STRATEGY_REVIEWS,
  STRATEGY_RUN_SUMMARIES,
  type StrategyRunId,
} from "./bench-strategy";

type ViewFilter = "all" | "gold-001" | "gold-002";

type GateState = "passed" | "failed" | "failed-waived" | "skipped-waived";

interface ModelCallSummary {
  requestIndex: number;
  status: string;
  latencyMs: number;
  totalTokens: number | null;
  usageMissing: boolean;
  attemptIndex: number;
}

interface AgentSummary {
  agentId: string;
  provider: string;
  model: string;
  providerReasoningEffort: string | null;
  providerThinkingMode: string | null;
  rank: number;
  finalNetWorth: number;
  tier: string;
  status: string;
  exitDay: number;
  requestCount: number;
  successfulRequests: number;
  failedRequests: number;
  timedOutRequests: number;
  retryAttempts: number;
  recoveredDecisions: number;
  validActions: number;
  invalidActions: number;
  dnf: boolean;
  errorCategories: Record<string, number>;
  tokens: {
    input: number;
    output: number;
    total: number;
    requestsWithoutUsage: number;
  };
  latency: {
    samples: number;
    totalMs: number;
    minimumMs: number;
    maximumMs: number;
    averageMs: number;
  };
  calls: ModelCallSummary[];
}

interface SampleSummary {
  id: "gold-001" | "gold-002";
  shortTitle: string;
  title: string;
  matchId: string;
  seed: number;
  runTrack: string;
  effortLabel: string;
  replayTarget: string;
  replayHash: string;
  limits: {
    decisionTimeoutMs: number;
    maxOutputTokensPerRequest: number;
    maxAttemptsPerDecision: number;
  };
  gates: {
    probe: { state: GateState; disposition: string | null };
    stability: { state: GateState; disposition: string | null };
  };
  cost: { status: string; reason: string };
  totals: {
    requestCount: number;
    successfulRequests: number;
    failedRequests: number;
    timedOutRequests: number;
    retryAttempts: number;
    recoveredDecisions: number;
    validActions: number;
    invalidActions: number;
    dnfAgents: number;
    modelFailureAgents: number;
    tokens: AgentSummary["tokens"];
    latency: AgentSummary["latency"];
    reliability: {
      advancedDays: number;
      autonomousDays: number;
      assistedDays: number;
      autonomousDayRate: number;
      firstAttemptSuccessDays: number;
      firstAttemptSuccessRate: number;
      validSelectionRate: number;
      providerRequestSuccessRate: number;
      providerWaitMs: number;
      retryCount: number;
    };
  };
  agents: AgentSummary[];
}

interface BenchData {
  schemaVersion: string;
  caveats: string[];
  samples: SampleSummary[];
}

const benchData = benchDataSource as BenchData;

const MODEL_COLORS: Record<string, string> = {
  openai: "#2b6f6b",
  anthropic: "#b05f3c",
  deepseek: "#345e9d",
  qwen: "#8a5f9e",
  kimi: "#b48226",
};

const filterOptions: Array<{ id: ViewFilter; label: string }> = [
  { id: "all", label: "双场对比" },
  { id: "gold-001", label: "只看 Gold 1" },
  { id: "gold-002", label: "只看 Gold 2" },
];

const integer = new Intl.NumberFormat("zh-CN");
const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat("zh-CN", { signDisplay: "always", maximumFractionDigits: 0 });

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(milliseconds >= 100_000 ? 0 : 1)}s`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function modelLabel(agent: AgentSummary): string {
  return `${agent.provider} / ${agent.model}`;
}

function stateLabel(state: string): string {
  if (state === "completed") return "完赛";
  if (state === "dead") return "游戏内出局";
  if (state === "passed") return "通过";
  if (state === "failed-waived") return "失败 · 已豁免";
  if (state === "skipped-waived") return "跳过 · 已豁免";
  if (state === "failed") return "失败";
  return state;
}

function gateTone(state: GateState): string {
  return state === "passed" ? "ok" : state.includes("waived") ? "warn" : "bad";
}

function scoreWidth(value: number, minimum: number, maximum: number): number {
  const span = maximum - minimum || 1;
  return Math.max(3, ((value - minimum) / span) * 100);
}

function latencyBand(milliseconds: number, status: string): string {
  if (status !== "succeeded") return "failed";
  if (milliseconds >= 120_000) return "critical";
  if (milliseconds >= 60_000) return "slow";
  if (milliseconds >= 20_000) return "medium";
  return "fast";
}

function SectionHeading({ id, eyebrow, title, note }: { id: string; eyebrow: string; title: string; note: string }) {
  return (
    <header className="bench-section-heading">
      <div>
        <p>{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      <span>{note}</span>
    </header>
  );
}

function RunCard({ sample }: { sample: SampleSummary }) {
  const reliability = sample.totals.reliability;
  const usageMissing = sample.totals.tokens.requestsWithoutUsage;
  return (
    <article className={`run-card run-card--${sample.id}`}>
      <div className="run-card__topline">
        <span className="run-card__index">{sample.shortTitle}</span>
        <span>{sample.effortLabel}</span>
      </div>
      <h3>{sample.title}</h3>
      <div className="run-card__metrics">
        <div>
          <span>请求成功率</span>
          <strong>{formatPercent(reliability.providerRequestSuccessRate)}</strong>
        </div>
        <div>
          <span>平均响应</span>
          <strong>{formatSeconds(sample.totals.latency.averageMs)}</strong>
        </div>
        <div>
          <span>Token</span>
          <strong>{compact.format(sample.totals.tokens.total)}{usageMissing > 0 ? "*" : ""}</strong>
        </div>
        <div>
          <span>重试 / 恢复</span>
          <strong>{sample.totals.retryAttempts} / {sample.totals.recoveredDecisions}</strong>
        </div>
      </div>
      <div className="run-card__gates" aria-label={`${sample.shortTitle} 赛前门禁`}>
        <span className={`status-chip status-chip--${gateTone(sample.gates.probe.state)}`}>
          Probe {stateLabel(sample.gates.probe.state)}
        </span>
        <span className={`status-chip status-chip--${gateTone(sample.gates.stability.state)}`}>
          Stability {stateLabel(sample.gates.stability.state)}
        </span>
        <span className="status-chip">成本不可用</span>
      </div>
      <dl className="run-card__meta">
        <div><dt>Seed</dt><dd>{sample.seed}</dd></div>
        <div><dt>决策时限</dt><dd>{sample.limits.decisionTimeoutMs / 1000}s</dd></div>
        <div><dt>自主推进</dt><dd>{reliability.autonomousDays}/{reliability.advancedDays} 天</dd></div>
      </dl>
      <a className="run-card__link" href={sample.replayTarget}>打开这场回放</a>
    </article>
  );
}

export function BenchPage() {
  const [filter, setFilter] = useState<ViewFilter>("all");
  const visibleSamples = useMemo(
    () => benchData.samples.filter(sample => filter === "all" || sample.id === filter),
    [filter],
  );
  const visibleAgents = visibleSamples.flatMap(sample => sample.agents.map(agent => ({ sample, agent })));
  const scoreValues = visibleAgents.map(({ agent }) => agent.finalNetWorth);
  const minimumScore = Math.min(...scoreValues, 0);
  const maximumScore = Math.max(...scoreValues, 0);
  const maxLatency = Math.max(...visibleAgents.map(({ agent }) => agent.latency.averageMs));
  const maxTokens = Math.max(...visibleAgents.map(({ agent }) => agent.tokens.total));

  return (
    <main className="bench-shell">
      <header className="bench-topbar">
        <a className="bench-brand" href="./index.html">北京浮生记 <span>Arena</span></a>
        <nav aria-label="Bench 页面导航">
          <a href="./replay.html">Gold 1 回放</a>
          <a href="./gold-002.html">Gold 2 回放</a>
          <a href="./rules.html">玩法</a>
        </nav>
      </header>

      <section className="bench-hero" aria-labelledby="bench-title">
        <div>
          <p className="bench-eyebrow">BENCH ANALYSIS · 2 GOLD RUNS</p>
          <h1 id="bench-title">不只看谁赢，<br />也看怎么跑完。</h1>
        </div>
        <p className="bench-hero__summary">
          终局净资产只回答“结果”。这里把每次模型请求的速度、失败、重试、恢复与 Token 一起纳入观察。
        </p>
      </section>

      <div className="bench-filter" role="tablist" aria-label="选择 Bench 数据范围">
        {filterOptions.map(option => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <section className="run-grid" aria-label="Gold 场次总览">
        {visibleSamples.map(sample => <RunCard key={sample.id} sample={sample} />)}
      </section>

      <section className="bench-section" aria-labelledby="score-title">
        <SectionHeading id="score-title" eyebrow="01 · RESULT" title="终局成绩" note="净资产排名与游戏内状态" />
        <div className="table-frame">
          <table className="score-table">
            <caption className="sr-only">Gold 1 与 Gold 2 的终局排名和净资产</caption>
            <thead>
              <tr>
                <th scope="col">场次</th>
                <th scope="col">排名</th>
                <th scope="col">Provider + Model</th>
                <th scope="col">终局净资产</th>
                <th scope="col">状态</th>
                <th scope="col">生存日</th>
              </tr>
            </thead>
            <tbody>
              {visibleSamples.flatMap(sample => [...sample.agents]
                .sort((left, right) => left.rank - right.rank)
                .map(agent => (
                  <tr key={`${sample.id}-${agent.agentId}`}>
                    <td><span className={`run-tag run-tag--${sample.id}`}>{sample.shortTitle}</span></td>
                    <td className="rank-cell">#{agent.rank}</td>
                    <th scope="row">
                      <span className="model-name">{modelLabel(agent)}</span>
                      <span className="effort-note">{agent.providerReasoningEffort ?? "default"} effort</span>
                    </th>
                    <td className="score-cell">
                      <span>{currency.format(agent.finalNetWorth)}</span>
                      <span className="score-track" aria-hidden="true">
                        <i
                          style={{
                            width: `${scoreWidth(agent.finalNetWorth, minimumScore, maximumScore)}%`,
                            backgroundColor: MODEL_COLORS[agent.provider] ?? "#4b6378",
                          }}
                        />
                      </span>
                    </td>
                    <td><span className={`result-state result-state--${agent.status}`}>{stateLabel(agent.status)}</span></td>
                    <td>Day {agent.exitDay}</td>
                  </tr>
                ))) }
            </tbody>
          </table>
        </div>
      </section>

      <section className="bench-section" aria-labelledby="strategy-title">
        <SectionHeading id="strategy-title" eyebrow="02 · STRATEGY" title="策略复盘" note="具体动作 → 策略判断 → 终局影响" />
        <div className="strategy-boundary">
          <strong>判读口径</strong>
          <span>自主买卖、还债、存款、治疗与移动作为策略证据；随机赠品单独标注，不把运气直接算成能力。</span>
        </div>
        <div className="strategy-overall" role="note" aria-label="模型层综合判断">
          <p>
            <strong>综合判断。</strong>
            <b>Claude Opus 5</b> 的裸调工具调用能力最强，<b>GPT-5.6 SOL</b> 同样很强，但 SOL 在两场中都没有形成清晰的经营策略；
            <b>Qwen</b> 在每场比赛中呈现出的整体策略感最强，不过 Gold 2 也说明策略感不等于风险控制稳定；
            <b>DeepSeek</b> 存在明显的过度思考——提示词 v1 无法跑完整场，提示词 v2 加入“需要完赛”的明确描述后才得以完成，但仍出现过连续 3 次输出超时。
          </p>
        </div>
        <div className="strategy-stack">
          {visibleSamples.map(sample => {
            const runId = sample.id as StrategyRunId;
            return (
              <article className={`strategy-run strategy-run--${sample.id}`} key={sample.id}>
                <header className="strategy-run__header">
                  <div>
                    <span className={`run-tag run-tag--${sample.id}`}>{sample.shortTitle}</span>
                    <strong>{sample.effortLabel}</strong>
                  </div>
                  <p>{STRATEGY_RUN_SUMMARIES[runId]}</p>
                </header>
                <div className="table-frame">
                  <table className="strategy-table">
                    <caption className="sr-only">{sample.shortTitle} 各模型的策略、动作证据与结果解读</caption>
                    <colgroup>
                      <col className="strategy-table__model" />
                      <col className="strategy-table__profile" />
                      <col className="strategy-table__evidence" />
                      <col className="strategy-table__assessment" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Provider + Model</th>
                        <th scope="col">策略画像</th>
                        <th scope="col">具体动作证据</th>
                        <th scope="col">结果解读</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...sample.agents]
                        .sort((left, right) => left.rank - right.rank)
                        .map(agent => {
                          const review = STRATEGY_REVIEWS[runId][agent.provider];
                          return (
                            <tr key={`${sample.id}-${agent.agentId}-strategy`}>
                              <th scope="row">
                                <span className="model-name">{modelLabel(agent)}</span>
                                <span className="effort-note">终局 #{agent.rank} · {currency.format(agent.finalNetWorth)}</span>
                              </th>
                              <td>
                                <span className={`strategy-profile strategy-profile--${review.tone}`}>{review.headline}</span>
                              </td>
                              <td>
                                <ul className="strategy-evidence">
                                  {review.evidence.map(item => (
                                    <li key={`${item.day}-${item.action}`}>
                                      <span>{item.day}</span>{item.action}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                              <td className="strategy-assessment">{review.assessment}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </article>
            );
          })}
        </div>

        {filter === "all" && (
          <aside className="cross-run" aria-labelledby="cross-run-title">
            <header>
              <p>两场不是两份独立成绩单</p>
              <h3 id="cross-run-title">跨场策略一致性</h3>
            </header>
            <div className="table-frame">
              <table className="cross-run-table">
                <caption className="sr-only">五个模型在 Gold 1 与 Gold 2 的策略对照</caption>
                <thead>
                  <tr>
                    <th scope="col">Provider + Model</th>
                    <th scope="col">Gold 1</th>
                    <th scope="col">Gold 2</th>
                    <th scope="col">跨场结论</th>
                  </tr>
                </thead>
                <tbody>
                  {CROSS_RUN_REVIEWS.map(review => (
                    <tr key={`${review.provider}-${review.model}-cross-run`}>
                      <th scope="row">{review.provider} / {review.model}</th>
                      <td>{review.gold1}</td>
                      <td>{review.gold2}</td>
                      <td><strong>{review.conclusion}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        )}
      </section>

      <section className="bench-section" aria-labelledby="speed-title">
        <SectionHeading id="speed-title" eyebrow="03 · SPEED" title="速度与尾延迟" note="每次 Provider 请求的 wall-clock" />
        <div className="chart-panel">
          <div className="bar-chart" role="img" aria-label="各模型平均响应时长横向条形图">
            {visibleAgents.map(({ sample, agent }) => (
              <div className="bar-row" key={`${sample.id}-${agent.agentId}`}>
                <div className="bar-row__label">
                  <span>{modelLabel(agent)}</span>
                  <small>{sample.shortTitle}</small>
                </div>
                <div className="bar-row__track">
                  <span
                    className="bar-row__fill"
                    style={{
                      width: `${Math.max(2, agent.latency.averageMs / maxLatency * 100)}%`,
                      backgroundColor: MODEL_COLORS[agent.provider] ?? "#4b6378",
                    }}
                  />
                </div>
                <strong>{formatSeconds(agent.latency.averageMs)}</strong>
                <small>max {formatSeconds(agent.latency.maximumMs)}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bench-section" aria-labelledby="token-title">
        <SectionHeading id="token-title" eyebrow="04 · TOKEN" title="Token 消耗" note="input + output；缺失 usage 不估算" />
        <div className="chart-panel">
          <div className="token-legend" aria-hidden="true"><span>Input</span><span>Output</span></div>
          <div className="bar-chart bar-chart--tokens" role="img" aria-label="各模型输入和输出 Token 堆叠条形图">
            {visibleAgents.map(({ sample, agent }) => {
              const inputWidth = agent.tokens.input / maxTokens * 100;
              const outputWidth = agent.tokens.output / maxTokens * 100;
              return (
                <div className="bar-row" key={`${sample.id}-${agent.agentId}`}>
                  <div className="bar-row__label">
                    <span>{modelLabel(agent)}</span>
                    <small>{sample.shortTitle}</small>
                  </div>
                  <div className="bar-row__track bar-row__track--stacked">
                    <span className="token-input" style={{ width: `${inputWidth}%` }} />
                    <span className="token-output" style={{ width: `${outputWidth}%` }} />
                  </div>
                  <strong>{compact.format(agent.tokens.total)}{agent.tokens.requestsWithoutUsage > 0 ? "*" : ""}</strong>
                  <small>{agent.tokens.requestsWithoutUsage > 0 ? `${agent.tokens.requestsWithoutUsage} 次缺失` : `${compact.format(agent.tokens.output)} 输出`}</small>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bench-section" aria-labelledby="stability-title">
        <SectionHeading id="stability-title" eyebrow="05 · RELIABILITY" title="稳定性明细" note="成功、失败、重试与恢复均保留" />
        <div className="table-frame">
          <table className="reliability-table">
            <caption className="sr-only">各模型运行稳定性指标</caption>
            <thead>
              <tr>
                <th scope="col">场次</th>
                <th scope="col">Provider + Model</th>
                <th scope="col">成功率</th>
                <th scope="col">请求</th>
                <th scope="col">失败</th>
                <th scope="col">超时</th>
                <th scope="col">重试</th>
                <th scope="col">恢复</th>
                <th scope="col">有效 / 无效动作</th>
                <th scope="col">技术 DNF</th>
              </tr>
            </thead>
            <tbody>
              {visibleAgents.map(({ sample, agent }) => {
                const successRate = agent.requestCount === 0 ? 0 : agent.successfulRequests / agent.requestCount * 100;
                return (
                  <tr key={`${sample.id}-${agent.agentId}`}>
                    <td><span className={`run-tag run-tag--${sample.id}`}>{sample.shortTitle}</span></td>
                    <th scope="row">{modelLabel(agent)}</th>
                    <td><strong className={successRate < 90 ? "metric-bad" : successRate < 100 ? "metric-warn" : "metric-ok"}>{formatPercent(successRate)}</strong></td>
                    <td>{agent.requestCount}</td>
                    <td>{agent.failedRequests}</td>
                    <td>{agent.timedOutRequests}</td>
                    <td>{agent.retryAttempts}</td>
                    <td>{agent.recoveredDecisions}</td>
                    <td>{agent.validActions} / {agent.invalidActions}</td>
                    <td>{agent.dnf ? "是" : "否"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bench-section" aria-labelledby="process-title">
        <SectionHeading id="process-title" eyebrow="06 · PROCESS" title="逐请求运行轨迹" note="每一格都是一次真实模型请求" />
        <div className="process-legend" aria-label="响应时长颜色图例">
          <span><i className="call-cell call-cell--fast" />&lt; 20s</span>
          <span><i className="call-cell call-cell--medium" />20–60s</span>
          <span><i className="call-cell call-cell--slow" />60–120s</span>
          <span><i className="call-cell call-cell--critical" />≥ 120s</span>
          <span><i className="call-cell call-cell--failed" />失败 / 超时</span>
        </div>
        <div className="process-panel">
          {visibleSamples.map(sample => (
            <article className="process-run" key={sample.id}>
              <header>
                <div>
                  <span className={`run-tag run-tag--${sample.id}`}>{sample.shortTitle}</span>
                  <strong>{sample.effortLabel}</strong>
                </div>
                <span>{sample.totals.requestCount} requests · {formatSeconds(sample.totals.latency.totalMs)} 累计等待</span>
              </header>
              {sample.agents.map(agent => (
                <div className="process-row" key={agent.agentId}>
                  <div className="process-row__label">
                    <span>{agent.provider}</span>
                    <small>{agent.model}</small>
                  </div>
                  <div
                    className="process-cells"
                    style={{ "--call-count": agent.calls.length } as CSSProperties}
                    aria-label={`${modelLabel(agent)} 的 ${agent.calls.length} 次请求轨迹`}
                  >
                    {agent.calls.map(call => {
                      const band = latencyBand(call.latencyMs, call.status);
                      const usage = call.usageMissing ? "usage 缺失" : call.totalTokens === null ? "Token 不可用" : `${integer.format(call.totalTokens)} Token`;
                      return (
                        <span
                          key={`${call.requestIndex}-${call.attemptIndex}`}
                          className={`call-cell call-cell--${band}`}
                          title={`请求 ${call.requestIndex} · ${formatSeconds(call.latencyMs)} · ${call.status} · ${usage}`}
                          aria-label={`请求 ${call.requestIndex}，${formatSeconds(call.latencyMs)}，${call.status}，${usage}`}
                        />
                      );
                    })}
                  </div>
                  <strong>{agent.failedRequests === 0 ? "全成功" : `${agent.failedRequests} 失败`}</strong>
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>

      <footer className="bench-footer">
        <div>
          <p>READING NOTES</p>
          <h2>看结果，也看证据边界。</h2>
        </div>
        <ul>
          {benchData.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}
        </ul>
        <a href="./index.html">返回首页</a>
      </footer>
    </main>
  );
}
