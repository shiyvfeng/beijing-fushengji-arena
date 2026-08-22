# `run-002` 五模型真实比赛工程验收记录

## 1. 验收结论

- `arena-direct-v22-run-002` 已完成真实五 Provider Probe、正式比赛、五 Trace、Replay v3、Report v4、单文件 HTML 和正式双视口浏览器验收。
- 工程证据链完整且所有故障均有结构化归属，**工程侧建议作为新版真实金样候选计入 1/3**。
- 本场五位选手均为技术 DNF，没有游戏内死亡、破产或正式名次。根据已确认口径，技术 DNF 本身不是自动重跑或拒收条件。
- 最终产品验收与正式金样计数由产品负责人确认；确认前项目台账仍记为 `0/3（工程候选 1/3）`。
- 原始交换诊断关闭，因此不能从产物中进一步解释上游响应正文；以下故障类别、HTTP 状态和归属以事实账本为准，不做超出证据的推断。

## 2. 固定输入与基线

| 项目 | 值 |
| --- | --- |
| 输出目录 | `dist/arena-direct/run-002` |
| Match ID | `arena-direct-v22-run-002` |
| Seed | `2026082202` |
| Rotation | `cyclic-v1 / 0` |
| Match Runner 基线 | `98e9d1e9e5d2023ffcb477eafa7b450f38d0d72f` |
| Day 0 DNF 浏览器验收修复 | `14bc880afda9f348a8979e80ae3d2a7b4c63dea2` |
| 最大动作数 | 每 Agent 160 |
| 单次决策上限 | `120000 ms` |
| 默认总墙钟 | 每 Agent `19200000 ms` |
| 单次输出上限 | 4096 Token |
| 自动重试 | 0 |
| 原始交换诊断 | 关闭 |

五组配置均使用显式最高 reasoning effort：OpenAI、Anthropic、DeepSeek、Kimi 为 `max`，Qwen 为 `xhigh`；DeepSeek 另显式使用 `thinking=enabled`。

## 3. Provider Probe

Probe 创建时间为 `2026-08-22T08:17:46.295Z`，五项全部通过，总 Token 为 15551。

| Provider / model | Effort | 延迟 | Token |
| --- | --- | ---: | ---: |
| OpenAI / `gpt-5.6-sol` | `max` | 75789.102 ms | 6591 |
| Anthropic / `claude-opus-5` | `max` | 7038.023 ms | 2355 |
| DeepSeek / `deepseek-v4-pro` | `enabled + max` | 38755.113 ms | 3246 |
| Qwen / `qwen3.8-max` | `xhigh` | 4649.378 ms | 1512 |
| Kimi / `kimi-k3` | `max` | 23059.181 ms | 1847 |

- 配置指纹：`sha256:d18a73532dce4d1d0e7770f9b073092f5234c55e11560df35213206528870dee`
- Probe 摘要 hash：`sha256:3f1c8dd4c5b13cf695e10928ea0d07b2271a6e98abdc8e2bba1d7bdd22cfdb7a`

## 4. 正式比赛事实

全场共发起 11 次请求，6 次成功、5 次失败；产生 6 个有效动作、0 个非法动作。输入/输出/合计 Token 为 14853/2317/17170，其中 5 个失败请求无 usage。所有请求均有 action event 或 technical-termination event 引用。

| Provider / model | 退出事实 | 有效动作 | 请求成功/总数 | 故障类别 | 归属 | 计入模型失败 | Token | 终止净值 |
| --- | --- | ---: | ---: | --- | --- | --- | ---: | ---: |
| OpenAI / `gpt-5.6-sol` | Day 0 `runtime_error` | 0 | 0/1 | `invalid_response` | `protocol` | 否 | 0 | -3000 |
| Anthropic / `claude-opus-5` | Day 3 `runtime_error` | 4 | 4/5 | `http_error`，HTTP 500 | `provider` | 否 | 13214 | 2567 |
| DeepSeek / `deepseek-v4-pro` | Day 1 `runtime_error` | 1 | 1/2 | `incomplete` | `model` | 是 | 2446 | -3500 |
| Qwen / `qwen3.8-max` | Day 1 `model_timeout` | 1 | 1/2 | `timeout`，120002.616 ms | `undetermined` | 否 | 1510 | -3500 |
| Kimi / `kimi-k3` | Day 0 `runtime_error` | 0 | 0/1 | `http_error`，HTTP 429 | `provider` | 否 | 0 | -3000 |

Anthropic 的四个有效动作依次为 `move(0)`、`move(1)`、`buy(itemId=5, quantity=23)`、`move(2)`；DeepSeek 与 Qwen 各完成一次 `move(0)`。五位选手全部技术 DNF，因此 `finalRanking=[]`，页面没有伪造名次。

## 5. 产物、hash 与安全核验

内部事实 hash：

- Replay hash：`sha256:dc0f91add9211b0983234fdc0d4fb28c2d1488adecb3dffc5ae2d720bab54196`
- Fact hash：`sha256:631f2a429b514b016079c78a67c68956767b438d68905848f8b95016ac134e4c`
- HTML SHA-256：`89535c12a530a84539340990d2211c90cbdf8221f783cead7a0ab5757cfa0fd9`

文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `probe-summary.json` | `86be7f4c5029e09b60ac45713b26a9d5c1398516e9ea0709cb672e733c8c4023` |
| `episode-traces.json` | `644ecb9cde5bf9effaf0d2c73623eb7c68b558ac02a6074cd007fb64fb148f3b` |
| `replay.json` | `8fa331913932a757486a14d22fee6002a45d09080741dfa05eb9892a135c23af` |
| `run-report.json` | `c76e0a31d15db4fa83fce7a0e2ebdf258e426dee2f08f6b3bdb72d32d510580a` |
| `replay.html` | `89535c12a530a84539340990d2211c90cbdf8221f783cead7a0ab5757cfa0fd9` |
| `browser-acceptance.json` | `8afe84bf22eb08ac3c744c97dedc45664b255411ac6e033f77b45bc427f97576` |

已验证：

- Probe 摘要、五个 Trace 和 Replay 自身 hash 全部匹配；Replay 的 `sourceTraceHashes` 与五 Trace 一一对应；
- Report 引用的 Replay/Probe hash、浏览器报告引用的 Replay/fact/HTML hash 全部一致；
- 40 天事实切片完整，五个 `Provider + model` 唯一，请求与 action/termination event 一一对账；
- Probe、Trace、Replay、Report、HTML、浏览器报告的敏感信息扫描均为 0。

## 6. 浏览器验收

首次正式运行通过 12/14；两种视口都因验收工具尝试跳转到不存在的 Day 0 而失败。真实 Replay 合法记录了两名选手在首个动作前终止，而页面事实范围按契约为 Day 1～40。修复只将 Day 0 DNF 映射到 Day 1 可见切片，同时继续核对“第 0 天退出”和后续无动作；未修改 Runner、Trace、Replay、Report 或 HTML。

修复后结果：

- 固定 Fixture：14/14；
- `run-002` 正式 Replay：14/14；
- Node `v24.19.0`、Playwright `1.62.1`、Chromium `151.0.7922.34`；
- 1366×768 与 1920×1080 各 7/7；
- 确定性重复构建为 `true`，现有 HTML hash 与两次重建一致；
- Day 1/39/40、防剧透、五 DNF、空排名、失败关闭、离线、控制台、键盘与焦点均通过。

正式报告：`dist/arena-direct/run-002/browser-acceptance.json`。

## 7. 待产品负责人确认

请确认是否接受以下判断：**本场虽然全员技术 DNF，但真实请求、故障归属、事实产物、hash、安全扫描和正式浏览器报告均完整，符合“不以零 DNF 或全员 Day 40 为门槛”的既定规则，因此计为新版真实金样 1/3，不为改善结果重跑。**
