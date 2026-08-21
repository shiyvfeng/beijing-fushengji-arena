# Direct-only Arena 真实验收记录（2026-08-21）

## 结论

本次已经跑通一条真实 Direct-only 最小闭环：四组独立配置完成四请求 Probe，随后四个模型均在完整比赛中实际收到请求，并生成可校验的 `replay.json`、`episode-traces.json`、`run-report.json` 和单文件 `replay.html`。

这是一场 `controlled-exhibition` 受控展示赛，不是纯模型能力基准。四者使用同一中性 Prompt、无身份观察、公共 seed、动作预算、超时和输出上限，但个人随机事件仍按槽位隔离。Kimi 在 Day 1 发生技术超时并成为 DNF；该故障没有中断另外三个 Agent 的运行和结算，因此 DNF 隔离边界通过。

## 比赛审计基线

| 字段 | 本次值 |
| --- | --- |
| Match ID | `arena-direct-20260820-001` |
| Seed | `20260820` |
| 公平性类别 | `controlled-exhibition` |
| 决策策略 | `neutral-v1` |
| 策略 hash | `sha256:871df5282bda5db6e46bf672fc6becbb63fbef64b2d60234ca5327be8c9ddea2` |
| 模型观察 | `identity-free-v1` |
| 公共随机 | `shared-seed` |
| 个人随机 | `slot-isolated` |
| 单 Agent 动作上限 | `160` |
| 单次决策超时 | `60000 ms` |
| 单次输出上限 | `4096 tokens` |
| 自动重试 | `0` |

`matchId` 是运行时显式配置的稳定标识，不是产物生成时间戳；本页记录的实际验收完成日期为 2026-08-21。

DeepSeek 本次显式使用 `providerThinkingMode: disabled`，适配器发送 `thinking: { type: "disabled" }`。该修复避免短 `GameAction` 请求默认进入长时间思考；thinking 模式只进入审计，不进入模型决策 Prompt。

## 四请求 Provider Probe

Probe 并行尝试四个槽位，每家恰好一次请求、零重试，不生成比赛产物。四家全部通过后才另行启动完整比赛。下表数字来自本次 Probe 的标准输出记录；正式比赛数据则以随后生成的 Replay 和报告为准。

| 槽位 | Provider / model | Adapter | Thinking | 合法动作 | Input / Output / Total Token | 延迟 | 结果 |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| A | OpenAI / `gpt-5.6-sol` | `openai-responses-v2` | — | `move(0)` | 5884 / 134 / 6018 | 4318.416 ms | 通过 |
| B | Anthropic / `claude-opus-5` | `anthropic-messages-v2` | — | `move(0)` | 1258 / 9 / 1267 | 2927.879 ms | 通过 |
| C | DeepSeek / `deepseek-v4-pro` | `openai-chat-completions-v3` | `disabled` | `move(13)` | 1367 / 17 / 1384 | 1118.495 ms | 通过 |
| D | Kimi / `kimi-k3` | `openai-chat-completions-v3` | `default` | `move(5)` | 1385 / 398 / 1783 | 17512.404 ms | 通过 |

Probe 结论：`requestCount = 4`，四个 Provider 均返回可解析且能在独立初始环境执行的 `GameAction`。Probe 通过只证明这四次请求成功，不承诺后续每次请求都不会超时；完整比赛中的 Kimi DNF 正好验证了这一区别。

## 完整比赛结果

| 槽位 | Provider / model | 状态 | 退出日 | 正式名次 | 终局净资产 | 请求成功/总数 | 有效/无效动作 | Total Token |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | OpenAI / `gpt-5.6-sol` | `completed` | 40 | 1 | 77859 | 98/98 | 98/0 | 613135 |
| B | Anthropic / `claude-opus-5` | `completed` | 40 | 2 | 5375 | 61/61 | 61/0 | 85441 |
| C | DeepSeek / `deepseek-v4-pro` | `dead`，游戏内失败 | 35 | 3 | -132411 | 69/69 | 61/8 | 102716 |
| D | Kimi / `kimi-k3` | `model_timeout`，技术 DNF | 1 | — | 964 | 2/3 | 2/0 | 4183 |

全场累计：231 次请求、230 次成功、1 次失败且为超时；222 个有效动作、8 个无效动作；1 个技术 DNF；Input 774504、Output 30971、Total 805475 Token，另有 1 个超时请求没有 usage。费用按契约固定为 `unavailable`，未做价格推算。

Day 40 的运气审计按个人随机事件次数得出：`agent-cash`（Kimi）为最幸运，`agent-value`（Anthropic）为最倒霉。该标签只是确定性的事件计数；Kimi 因 Day 1 退出而暴露时间很短，因此不应把“最幸运”解释为模型表现或完整 40 天体验优于其他 Agent。

## 本地产物与确定性

产物目录为 `dist/arena-direct/run-001/`，该目录被 Git 忽略，只是当前工作区的本地验收证据。

| 文件 | 验收用途 |
| --- | --- |
| `replay.json` | `arena-schema-v2` 事实 Replay；canonical `replayHash` 为 `sha256:ea04bda1a23b09784cc14024b6978871c5b04cc10351d4a69e31ad08f622c73e` |
| `episode-traces.json` | 四个隔离 Episode 的完整动作和状态证据 |
| `run-report.json` | 请求、动作、超时、DNF、Token、usage 和延迟汇总 |
| `replay.html` | 可断网打开的单文件事实页面；文件 SHA-256 为 `2c7dd24a01099e9bebe06389c4e9f3a4832af9348479dac367d11e8c1eaeb022` |

同一 Replay 在相同源码与锁文件下重复构建两次，得到字节一致的 HTML SHA-256。静态检查未发现 `fetch`、XHR、WebSocket、远程脚本、远程样式、样例 Replay、模拟采访或模拟排名；JSON 与 HTML 的凭据扫描未发现 Key。

正式产物有意不保存 Provider 原始请求/响应。协议诊断时生成的脱敏交换记录位于本地 `dist/arena-diagnostics/`，被 Git 忽略，不属于 Replay 契约，也不应提交或公开。

## 自动化与浏览器验收

本次实现验收通过：

- Core 测试 84/84，Web 测试 11/11；TypeScript build/typecheck 通过；
- Day 1、Day 39 不显示终局名次或最终运气标签，Day 40 名次与核心 `finalRanking` 一致，技术 DNF 没有正式名次；
- 使用 Computer Use 从 Finder 在 Google Chrome 直接打开 `file://` 的真实 `replay.html`，检查 Day 1/39/40、Agent C 详情弹窗和主要页面布局，均可用；
- 使用仅绑定 `127.0.0.1:4173` 的临时静态服务，在内置浏览器和 Chrome 插件中打开同一 HTML，复核 Day 1/39/40、排名、DNF、运气审计和 Agent C 弹窗；两处控制台均为 0 error、0 warning；
- 临时服务只出现浏览器自动请求 `/favicon.ico` 的一次 404，不影响页面，也不是远程依赖；验收后服务已停止。

非阻塞视觉备注：Replay/fact hash 的字号和对比度偏弱，但内容可读，不影响事实或交互验收。

## 已知限制

本次 `run-report.json` 在旧实现下生成，暴露了一个随后修复的超时延迟快照竞态：Kimi 的 `latency.samples` 已计入第 3 次超时请求，但当前报告中的 `totalMs`、`minimumMs`、`maximumMs` 和 `averageMs` 只覆盖前两次已结算请求，未纳入该次 60 秒超时耗时；全场延迟汇总也继承这一限制。

修复后的 Runner 会把仍在 pending 的请求已耗时计入快照，并已用永不返回的 Fake Provider 覆盖测试。为了保持事实产物不可篡改，现有 `run-report.json` 没有回填，也没有为此再次付费运行完整比赛。因此，本次请求数、成功/失败、超时、动作、DNF、Token 与 usage 缺失数可以验收，延迟统计只能视为已知不完整；若要验收修复后的真实延迟报告，必须使用新输出目录重新运行一场比赛。

本次没有 commit、push、部署、发布或公网托管。
