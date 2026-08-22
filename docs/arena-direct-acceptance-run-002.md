# `run-002` 旧策略诊断与新策略重置记录

## 当前结论

- 新版真实金样仍为 `0/3`；本文件记录的所有真实运行都发生在 `full-history-v1`、最高 reasoning effort、零重试的旧策略下，不能计入当前 `bounded-history-v1 + bounded-retry-v1` 金样。
- 标准目录 `dist/arena-direct/run-002` 当前只有旧策略 `probe-summary.json`，没有 Trace、Replay、Report、HTML 或正式浏览器报告。
- 两份旧完整产物保存在独立诊断目录；最近一次开启原始交换的比赛被产品负责人要求停止，没有生成正式比赛产物。
- 新策略要求重新执行 Probe v3 和十步 Stability Probe；未经再次授权，不发起任何付费 Stability 或正式比赛请求。

## 已保留的真实诊断证据

| 目录或证据 | 事实 | 当前用途 |
| --- | --- | --- |
| `dist/arena-direct/run-002-attempt-01-network-suspected` | 完整旧策略比赛与浏览器报告 | 网络稳定性疑问下的历史诊断，不计金样 |
| `dist/arena-direct/run-002-attempt-02-pre-live-diagnostics` | 128 请求、123 成功、5 失败、123 个有效动作、0 个环境非法动作；Replay v3、Report v4、浏览器 14/14 | 证明旧实现事实链与失败模式，不计金样 |
| `dist/arena-diagnostics/arena-direct-v22-run-002/match` | 中止运行留下 84 个已完成脱敏原始 exchange：Anthropic 70、OpenAI 3、DeepSeek 2、Qwen 2、Kimi 7 | 定位延迟、输出截断和网络故障，不是比赛产物 |
| `dist/arena-direct/run-002` | 仅旧策略 Probe 摘要 | 新策略指纹不匹配，必须重新 Probe |

旧完整比赛中五位选手最终均技术 DNF。OpenAI、Qwen、Kimi 出现单次 120 秒超时，DeepSeek 出现 `incomplete`，Anthropic 在推进到 Day 32 后超时。该场所有成功请求均能关联 action event，失败请求均能关联 technical termination；这些事实仍可用于工程诊断，但策略改版后不再具备金样可比性。

## 开启原始交换后的中止诊断

最近一次比赛按要求开启了 `ARENA_SAVE_RAW_EXCHANGES=true`，运行过慢后被人工停止。停止时没有写出 Trace、Replay、Report 或 HTML；已完成的脱敏 exchange 保留在诊断目录。

可确认的主要故障如下：

- DeepSeek 第 2 次请求 HTTP 200，但 `finish_reason=length`，4096 个输出 Token 全部为 reasoning，正文为空；这解释了 `incomplete`，不是动作解析器误判。
- OpenAI 第 3 次、Qwen 第 2 次、Kimi 第 7 次请求由本地 120 秒上限中止；原始记录只有 `transportError=true`，没有上游 HTTP 响应，不能把责任直接归给模型。
- Anthropic 已完成 70 次请求，输入上下文从约 1245 Token 增长到约 16307 Token，显示全历史策略会持续拉高延迟与费用。
- 该次已接受动作均符合环境契约；之前完整旧策略比赛同样记录 0 个环境非法动作。完成率低的主要事实是高强度思考、上下文增长、输出截断与瞬态请求失败的组合，而不是单一 `invalid_action` 原因。

## 已确认的新策略

| 项目 | 新契约 |
| --- | --- |
| 思考等级 | 五家统一为最低非关闭 `low`；DeepSeek 保持 `thinking=enabled` |
| 上下文 | `bounded-history-v1`：当前完整 Observation、最近 5 天摘要、最近 8 条完整动作、更早历史确定性聚合 |
| 逻辑决策预算 | 仍为 120 秒；单次尝试最多 60 秒 |
| 修复重试 | `invalid_response` / `invalid_action` 最多 2 次 |
| 瞬态重试 | timeout、transport、HTTP 408/429/5xx 最多 1 次 |
| 总尝试数 | 每个逻辑决策最多 3 次，重试不延长逻辑决策或总墙钟 |
| 不重试 | 鉴权、额度、`context_limit`、拒绝、输出截断和其他不可重试错误 |
| 稳定性门禁 | Probe 5/5 后，五家并行且各自顺序完成 10 个有效动作；全部通过才允许正式比赛 |
| 审计版本 | Probe v3、model-call v2、Replay v4、Report v5、Stability v1 |

所有失败请求、环境拒绝、重试尝试、恢复决策、Token、延迟、revision、故障类别和证据引用均进入事实账本，后续可作为可靠性评价输入。死亡或技术 DNF 仍按事实验收，不以全员 Day 40 或零 DNF 为重跑条件。

## 下一步

1. 新策略 Core 92/92、Web 11/11、typecheck 与 Node 24 双视口 Fixture 14/14 已通过；完成敏感信息/diff 检查并建立本地 Git 基线，不推送。
2. 对 `run-002` 固定参数执行脱敏 `--check-config`，确认五家均为 `low` 且 DeepSeek thinking 开启。
3. 再次取得产品负责人明确授权后，重新 Probe；Probe v3 通过后，再单独授权十步 Stability Probe。
4. Stability 通过后，才讨论是否授权正式 `run-002`；任何旧策略产物都不回填为新策略金样。
