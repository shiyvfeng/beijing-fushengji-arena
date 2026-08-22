# `run-002` 诊断与门禁重置记录

## 当前结论

- 新版真实金样仍为 `0/3`。历史完整比赛使用 `full-history-v1`、最高 reasoning effort 和零重试；旧门禁使用 `bounded-history-v1 + bounded-retry-v1`，Probe 5/5 但 Stability 仅 3/5；两类证据都不能计入当前 `bounded-retry-v2` 金样。
- 标准目录 `dist/arena-direct/run-002` 当前已有 `bounded-retry-v2` 的新版 `probe-summary.json` 与 `stability-summary.json`，均为 5/5 且门禁绑定校验通过。目录中没有 Trace、Replay、Report、HTML 或正式浏览器报告。
- 两份旧完整产物保存在独立诊断目录；最近一次开启原始交换的比赛被产品负责人要求停止，没有生成正式比赛产物。
- v2 Probe 与十步 Stability 均经产品负责人分别明确授权并完成；正式比赛尚未授权、未启动。

## 已保留的真实诊断证据

| 目录或证据 | 事实 | 当前用途 |
| --- | --- | --- |
| `dist/arena-direct/run-002-attempt-01-network-suspected` | 完整旧策略比赛与浏览器报告 | 网络稳定性疑问下的历史诊断，不计金样 |
| `dist/arena-direct/run-002-attempt-02-pre-live-diagnostics` | 128 请求、123 成功、5 失败、123 个有效动作、0 个环境非法动作；Replay v3、Report v4、浏览器 14/14 | 证明旧实现事实链与失败模式，不计金样 |
| `dist/arena-diagnostics/arena-direct-v22-run-002/match` | 中止运行留下 84 个已完成脱敏原始 exchange：Anthropic 70、OpenAI 3、DeepSeek 2、Qwen 2、Kimi 7 | 定位延迟、输出截断和网络故障，不是比赛产物 |
| `dist/arena-direct/run-002` | v2 Probe 5/5；v2 Stability 5/5，52 次请求、50 个有效动作 | 两道门禁均通过，可在单独授权后启动正式比赛；当前仍无比赛产物 |

旧完整比赛中五位选手最终均技术 DNF。OpenAI、Qwen、Kimi 出现单次 120 秒超时，DeepSeek 出现 `incomplete`，Anthropic 在推进到 Day 32 后超时。该场所有成功请求均能关联 action event，失败请求均能关联 technical termination；这些事实仍可用于工程诊断，但策略改版后不再具备金样可比性。

## 开启原始交换后的中止诊断

最近一次比赛按要求开启了 `ARENA_SAVE_RAW_EXCHANGES=true`，运行过慢后被人工停止。停止时没有写出 Trace、Replay、Report 或 HTML；已完成的脱敏 exchange 保留在诊断目录。

可确认的主要故障如下：

- DeepSeek 第 2 次请求 HTTP 200，但 `finish_reason=length`，4096 个输出 Token 全部为 reasoning，正文为空；这解释了 `incomplete`，不是动作解析器误判。
- OpenAI 第 3 次、Qwen 第 2 次、Kimi 第 7 次请求由本地 120 秒上限中止；原始记录只有 `transportError=true`，没有上游 HTTP 响应，不能把责任直接归给模型。
- Anthropic 已完成 70 次请求，输入上下文从约 1245 Token 增长到约 16307 Token，显示全历史策略会持续拉高延迟与费用。
- 该次已接受动作均符合环境契约；之前完整旧策略比赛同样记录 0 个环境非法动作。完成率低的主要事实是高强度思考、上下文增长、输出截断与瞬态请求失败的组合，而不是单一 `invalid_action` 原因。

## 首轮十步 Stability 诊断

在固定 `arena-direct-v22-run-002`、seed `2026082202`、rotation `0`、五家 `low`、DeepSeek thinking 开启、120 秒逻辑预算和 4096 输出上限下，Probe v3 五家一次通过。经再次授权执行的 v1 Stability 结果如下：

| Provider | 有效动作 | 请求/失败 | 重试/恢复 | Token | 结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| OpenAI | 2/10 | 4/2 | 1/0 | 12826 | 第 3 个逻辑动作两次约 60 秒超时 |
| Anthropic | 10/10 | 10/0 | 0/0 | 31849 | 通过 |
| DeepSeek | 10/10 | 13/2 | 3/3 | 70581 | 通过；两次超时和一次环境无效动作均恢复 |
| Qwen | 1/10 | 4/2 | 2/0 | 报告 4834 | 两次契约错误后以现金不足的购买动作结束，`invalid_action_loop` |
| Kimi | 10/10 | 10/0 | 0/0 | 38791 | 通过 |

整体 3/5，摘要 `passed=false`，CLI 明确报告“未启动完整比赛”。摘要 hash 校验通过，41 次请求对应 41 份脱敏交换，本机五组凭据精确扫描为 0 泄漏。

Qwen 四次上游响应均为 HTTP 200：第 1 次成功移动；第 2、3 次最终 JSON 都是 `{"type":"buy","itemId":6,"quantity":0}`，违反正整数契约；第 4 次为 `{"type":"buy","itemId":4,"quantity":1}`，但现金 2000 元不足以支付 6771 元。三次 reasoning 均倾向移动到其他地点，但最终 JSON 与其结论不一致。v1 重试只提供笼统 `invalid_action`，未指出 `quantity` 错误；同时第 2、3 次原始 usage 合计 7098 Token，v1 账本却标记为 missing。两项问题均进入 v2 离线修复范围。

## 已确认的新策略

| 项目 | 新契约 |
| --- | --- |
| 思考等级 | 五家统一为最低非关闭 `low`；DeepSeek 保持 `thinking=enabled` |
| 上下文 | `bounded-history-v1`：当前完整 Observation、最近 5 天摘要、最近 8 条完整动作、更早历史确定性聚合 |
| 逻辑决策预算 | 仍为 120 秒；单次尝试最多 60 秒 |
| 修复重试 | `bounded-retry-v2`：`invalid_response` / `invalid_action` 最多 2 次，携带脱敏具体错误码与安全被拒动作摘要 |
| 瞬态重试 | timeout、transport、HTTP 408/429/5xx 最多 1 次 |
| 总尝试数 | 每个逻辑决策最多 3 次，重试不延长逻辑决策或总墙钟 |
| 不重试 | 鉴权、额度、`context_limit`、拒绝、输出截断和其他不可重试错误 |
| 稳定性门禁 | Probe 5/5 后，五家并行且各自顺序完成 10 个有效动作；全部通过才允许正式比赛 |
| 审计版本 | Probe v3、model-call v2、Replay v4、Report v5、Stability v1；三类 Adapter 版本因失败响应事实保留而提升 |

所有失败请求、环境拒绝、重试尝试、恢复决策、Token、延迟、revision、故障类别和证据引用均进入事实账本；HTTP 200 但动作无效时，只要上游 usage/revision 合法也必须保留，后续可作为可靠性评价输入。死亡或技术 DNF 仍按事实验收，不以全员 Day 40 或零 DNF 为重跑条件。

## `bounded-retry-v2` 五请求 Probe

2026-08-22 20:42（Asia/Shanghai），固定 `arena-direct-v22-run-002`、seed `2026082202`、rotation `0`、五家 `low`、DeepSeek thinking 开启、120 秒逻辑预算、60 秒尝试上限和 4096 输出上限，重新执行 Probe v3。五家均在第一次请求返回可执行的 `move(locationId=0)`：

| Provider | Model | 延迟 | Token | Adapter | 结果 |
| --- | --- | ---: | ---: | --- | --- |
| OpenAI | `gpt-5.6-sol` | 3369.870 ms | 1667 | `openai-responses-v4` | 通过 |
| Anthropic | `claude-opus-5` | 2684.634 ms | 1390 | `anthropic-messages-v4` | 通过 |
| DeepSeek | `deepseek-v4-pro` | 6972.211 ms | 1842 | `openai-chat-completions-v5` | 通过 |
| Qwen | `qwen3.8-max` | 6018.281 ms | 1790 | `openai-chat-completions-v5` | 通过 |
| Kimi | `kimi-k3` | 6230.757 ms | 1538 | `openai-chat-completions-v5` | 通过 |

摘要 `passed=true`，请求数恰为 5，总 Token 为 8227，usage 缺失 0，revision mismatch 0。`probeSummaryHash` 为 `sha256:0e72f21c573405cd0b6b8dc4f92128c9795335b651133147890b3e697cd07783`；结构/hash 校验和内置敏感信息扫描通过，对标准目录与 Probe 原始交换执行五组真实凭据精确扫描为 0 命中。旧 Stability 被当前指纹和 Probe hash 明确拒绝，不能用于启动比赛。

## `bounded-retry-v2` 十步 Stability

经再次单独授权，2026-08-22 20:54（Asia/Shanghai）完成与正式比赛同契约的十步 Stability：

| Provider | 有效动作 | 请求/失败 | 环境无效 | 重试/恢复 | Token | 平均延迟 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAI | 10/10 | 10/0 | 0 | 0/0 | 36918 | 3699.945 ms |
| Anthropic | 10/10 | 10/0 | 0 | 0/0 | 33248 | 4647.559 ms |
| DeepSeek | 10/10 | 11/1 | 0 | 1/1 | 59697 | 37094.507 ms |
| Qwen | 10/10 | 11/0 | 1 | 1/1 | 52707 | 22475.706 ms |
| Kimi | 10/10 | 10/0 | 0 | 0/0 | 39156 | 7573.707 ms |
| **合计** | **50/50** | **52/1** | **1** | **2/2** | **221726** | — |

DeepSeek 第 6 个逻辑动作首尝试在 60002.392 ms 超时，未取得上游 usage，因此唯一的 `usageMissingRequests=1` 与可观察事实一致；瞬态重试返回 `move(locationId=4)` 并恢复。Qwen 第 6 个逻辑动作首次尝试购买 `itemId=4, quantity=1`，因 `insufficient_cash` 被环境拒绝；v2 重试上下文携带该具体错误码和安全被拒动作摘要，随后改为购买 `itemId=7, quantity=1` 并成功。两次重试均未突破 120 秒逻辑预算。

摘要 `passed=true`；`stabilitySummaryHash` 为 `sha256:9b80b1768e2a78fc1744b22d6da8318022bd9ab2c74fc1b7db477380c4fb9872`。Probe/Stability 绑定、配置指纹、两份 hash、52 条请求账本与 52 份本轮原始交换均校验通过；内置扫描与五组真实凭据精确扫描为 0 命中。该结果证明 v2 两类恢复路径在本轮真实调用中均能让模型继续完成目标，但不代表正式 160 动作比赛必然无失败。

## 下一步

1. v2 离线基线、脱敏配置检查、五请求 Probe 和十步 Stability 均已完成；本地基线未推送。
2. 再次取得产品负责人明确授权后，才可启动正式 `run-002`；理论最多 2400 次请求，重试不延长单决策或总墙钟。
3. 正式比赛结束后核验 Trace、Replay v4、Report v5、HTML、hash、凭据和确定性重建，再执行 Node 24 双视口浏览器验收；旧比赛产物不回填为 v2 金样。
