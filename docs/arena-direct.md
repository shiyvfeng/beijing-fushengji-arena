# Direct Arena 运行说明

> 当前状态（2026-08-22）：五模型 Runner 已切换到最低非关闭思考、`bounded-history-v1`、`bounded-retry-v2` 和 Probe → 十步 Stability → Match 门禁；Replay/Report 为 v4/v5。最近一次真实 Probe 5/5，随后 Stability 仅 Anthropic、DeepSeek、Kimi 通过；OpenAI 连续超时，Qwen 连续输出不可执行动作。恢复与 Adapter 契约升级后，该轮门禁只作诊断，新版真实金样仍为 `0/3`。

## 五模型 Direct 契约

一场正式比赛必须恰好配置五个 Runner。A–E 只是在本地配置中定位条目，不是公开身份；进入比赛后的内部 ID 固定为 `competitor-1...5`，观众页只显示 `Provider + Model`。

Runner 在任何联网请求前执行以下门禁：

- `ARENA_AGENT_A...E` 五组必须连续、完整，且 driver 只能是 Direct；
- Provider 先归一化别名，model 去除首尾空白，再校验五个 `Provider + model` 组合互不重复；
- Direct Descriptor 禁止 `displayName`、`personaId` 和策略身份；
- slot 使用 `cyclic-v1`：`slot = (entryIndex + rotationIndex) % 5`，轮换索引只允许 `0..4`；
- 五者共享 scenario、seed、Prompt、上下文、采样、动作预算、单次超时、总墙钟和输出 Token 上限。

公共市场事实由同一 scenario、seed 和 day 决定；个人随机事件继续按 slot 隔离。轮换只改变个人随机 slot 映射，不改变公共市场事实。单场仍是受控展示，不足以单独证明普遍模型能力。

## `bounded-history-v1` 上下文

所有请求使用 `neutral-v1` 固定系统指令、`identity-free-v1` 当前 Observation 和 `bounded-history-v1` 用户上下文。每次请求固定包含：

1. 当前一次完整、无身份 Observation；
2. 最近 5 个游戏日的确定性摘要；
3. 最近 8 条完整 action、result、effects 和 state diff；
4. 更早历史的动作、成功/失败、结果码和事件聚合；
5. 重试时仅附本次失败类别、动作错误码和被拒动作。

摘要由 Runner 纯函数生成，不调用模型；旧 Observation、Provider/model/slot、其他参赛者、前轮结果、Replay Enrichment、采访、排名和审计 ID 均不得进入决策上下文。五家共享完全相同的字段、窗口和序列化逻辑，不按模型上下文窗口差异化裁剪。

上下文采用固定字段顺序的规范 JSON。`observationHash` 只绑定本次 Observation；`fullContextHash` 覆盖实际发送的系统指令和完整用户上下文。Provider 明确返回上下文超限时，该 Agent 以 `runtime_error + context_limit` 记技术 DNF，不重试也不临时扩大或改变窗口，其余四个 Agent 继续。

## 时间与动作预算

- 每 Agent 拥有独立总墙钟，默认值为 `maxActionsPerAgent × decisionTimeoutMs`；
- 新版真实金样当前使用 `decisionTimeoutMs = 120000`（2 分钟）；160 次动作预算下，未单独覆盖时每 Agent 总墙钟为 `19200000 ms`；
- 可通过 `ARENA_TOTAL_WALL_CLOCK_MS` 或 `--total-wall-clock-ms` 统一覆盖；
- 总墙钟从第一次决策前开始；每个逻辑决策总预算仍为 120 秒，单次 Provider 尝试上限为 60 秒；
- 总墙钟耗尽记录为 `model_timeout + total_wall_clock`，故障域为 `undetermined`，只终止当前 Agent；
- `bounded-retry-v2` 每个逻辑决策最多 3 次尝试：`invalid_response`/`invalid_action` 最多修复 2 次，timeout/transport/HTTP 408、429、5xx 最多瞬态重试 1 次；修复上下文附带脱敏的具体错误码和安全被拒动作摘要，重试不延长逻辑决策或总墙钟；
- 鉴权、额度、`context_limit`、拒绝、输出截断和其他不可重试故障直接终止对应 Agent；所有失败和恢复均进入请求账本。

## Provider 协议

| Provider 别名 | 协议 | Base URL 示例 | 原生最高 effort |
| --- | --- | --- | --- |
| `gpt` / `openai` | OpenAI Responses | `https://api.openai.com/v1` | `max` |
| `claude` / `anthropic` | Anthropic Messages | `https://api.anthropic.com/v1` | `max` |
| `deepseek` | OpenAI-compatible Chat Completions | `https://api.deepseek.com` | `max` |
| `qwen` / `dashscope` | OpenAI-compatible Chat Completions | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `xhigh` |
| `kimi` / `moonshot` | OpenAI-compatible Chat Completions | `https://api.moonshot.cn/v1` | `max` |
| `openai-compatible` / `openai-chat` | 通用 Chat Completions | 使用者明确提供 | 由兼容服务决定 |

OpenAI 使用 `/responses` 与严格 JSON Schema；Anthropic 使用 `/messages`；其余兼容服务使用 `/chat/completions`。五组都必须显式配置 `REASONING_EFFORT`：OpenAI 支持 `none/low/medium/high/xhigh/max`，Anthropic 支持 `low/medium/high/xhigh/max`，DeepSeek 与 Kimi 支持 `low/high/max`，Qwen 支持 `low/medium/xhigh`。DeepSeek 的独立 `THINKING` 开关可选 `default`、`disabled`、`enabled`；配置非默认 effort 时不得关闭思考。Provider 适配器统一返回严格 `GameAction`、Token usage、响应 revision 和安全错误分类。

采样策略固定为 `provider-explicit-effort-audited-v2`：Runner 不额外发送 `temperature` 或 `top_p`，逐请求记录两者被省略，并记录实际 max tokens、JSON mode、thinking 开关、reasoning effort 及其是否实际发送。每组可用 `MODEL_REVISION` 声明 revision；适配器优先使用响应值，缺失时回退声明，再缺失为 `unavailable`。声明与响应冲突只记录 mismatch，不中断比赛。

## 本地配置

仓库根目录 `.env` 已被 Git 忽略；可提交模板是 `.env.example`。API Key 只能从环境或 env 文件读取，不接受命令行参数。每组结构如下，完整五组以模板为准：

```dotenv
ARENA_AGENT_A_PROVIDER=openai
ARENA_AGENT_A_BASE_URL=https://api.openai.com/v1
ARENA_AGENT_A_API_KEY=
ARENA_AGENT_A_MODEL=
ARENA_AGENT_A_REASONING_EFFORT=low
ARENA_AGENT_A_MODEL_REVISION=

# ARENA_AGENT_B...E 使用同样字段
# DeepSeek 另需显式开启思考：ARENA_AGENT_C_THINKING=enabled

ARENA_SEED=20260820
ARENA_MAX_ACTIONS_PER_AGENT=160
ARENA_DECISION_TIMEOUT_MS=120000
ARENA_TOTAL_WALL_CLOCK_MS=
ARENA_MAX_OUTPUT_TOKENS=512
ARENA_SLOT_ROTATION_INDEX=0
ARENA_SAVE_RAW_EXCHANGES=false
```

`--agent-a-model` 至 `--agent-e-model` 可临时覆盖 model。E 槽与五组 `REASONING_EFFORT` 均已纳入 CLI allowlist、配置指纹和凭据扫描；Runner 本身不会改写本地 `.env`。

## 运行顺序与三段门禁

### 1. 零网络配置检查

```bash
npm run arena:direct -- --check-config
```

该命令脱敏显示五组配置和轮换结果，不发请求、不写比赛产物，也不要求输出目录。

### 2. 五请求 Probe

```bash
npm run arena:direct -- \
  --output-dir <new-output-directory> \
  --probe-providers
```

`--probe-providers` 本身授权五次在线请求：A–E 并行各请求一次、零重试；一家失败仍尝试其余四家。每个返回动作还会在独立初始环境中严格执行。Probe 必须指定输出目录，并原子写入或替换 `probe-summary.json`；只要该目录还没有比赛产物，就可以重新 Probe。

摘要格式为 `arena-provider-probe-v3`，包含五次尝试、配置指纹、Prompt/context/recovery/sampling 版本、action、usage、latency、revision 和安全故障归属，并有独立摘要 hash。配置指纹覆盖 match、seed、scenario、五组 Provider/model/adapter、端点指纹、thinking、reasoning effort、revision 声明、预算、轮换、上下文、恢复和采样策略，不包含 API Key 或其 hash。

由于指纹刻意不接触密钥，只更换 API Key 无法被比赛门禁识别。发生密钥轮换时，操作者必须主动在同一空目录重新 Probe。

### 3. 十步 Stability Probe

```bash
npm run arena:direct -- \
  --output-dir <same-output-directory> \
  --stability-probe
```

该命令先校验同目录 Probe，再让五家并行各运行一个隔离 Episode；每家内部顺序完成 10 个有效动作。每个逻辑决策使用正式比赛相同的上下文、60/120 秒时间边界和重试策略。只有五家均达到 10 个有效动作才写出 `passed=true` 的 `arena-provider-stability-v1`；失败摘要同样保留，用于判断请求失败、重试、恢复、Token、延迟和 revision。

### 4. 同目录正式比赛

```bash
npm run arena:direct -- \
  --output-dir <same-output-directory> \
  --confirm-live-run
```

CLI 会在任何付费比赛请求前读取同目录最新 Probe 与 Stability 摘要；只有二者配置指纹匹配、Probe 5/5 且 Stability 5×10 全部通过才继续。缺失、失败、损坏或错配一律失败关闭。已有 `episode-traces.json`、`replay.json`、`run-report.json` 或 `replay.html` 时，三种在线模式都拒绝覆盖。

## 逐请求审计与故障归属

`arena-model-call-v2` 是所有聚合指标的唯一账本来源。每条请求记录稳定派生的 `modelCallId`、Agent/slot/actionIndex/attemptIndex、`observationHash`、`fullContextHash`、状态、延迟、Token usage 或缺失标记、sampling、revision，以及 action event、retry reason 或 technical-termination event 三者之一。只要 HTTP 200 响应提供了合法 usage/revision，即使动作 JSON 无法解析、违反契约或当前不可用，也必须在失败调用上保留这些事实；只有真正未取得 usage 的请求才可标记缺失。

`modelCallId` 由 match、Agent、actionIndex 和 attemptIndex 派生，不使用时间或随机 UUID，也不进入模型上下文。成功或环境拒绝的动作引用 action event；可恢复失败引用结构化 retry reason；最终失败引用 technical termination。Run Report 另汇总 retry attempts、recovered decisions 和错误类别，供后续可靠性计分使用。

故障采用可观察证据分层，不做主观归责：

| domain | 可观察边界 | `countsTowardModelFailure` |
| --- | --- | --- |
| `platform` | DNS、TLS、本机网络 transport | false |
| `provider` | HTTP、限流、服务端状态 | false |
| `model` | 拒绝、上下文超限、非法动作、动作预算或循环 | true |
| `protocol` | response envelope、JSON 或 usage 协议无效 | false |
| `runner` | 内部驱动或编排异常 | false |
| `undetermined` | 无法证明原因的单次或总墙钟超时 | false |

Run Report 对每个技术终止明确记录 `countsTowardModelFailure`。Token 保留 input、output、total 和 usage 缺失数，并提供逐请求、逐 Agent 和全场汇总；不估算货币价格，也不用于排名。

## 实时脱敏事实进度

正式比赛在 stdout 逐行输出 `arena-live-progress-v1` JSONL，每行固定以 `[arena-progress] ` 开头。该旁路只从 GameEnvironment 和逐请求账本中读取事实，不进入 Trace、Replay、Report 或 hash；终端关闭或进度消费者抛错不能改变任何 Episode 结果。

| `event` | 内容 |
| --- | --- |
| `episode_started` | Agent、Provider/model、slot 和初始 Day |
| `decision_started` | 请求序号、当前 Day、历史动作条数和已发请求数 |
| `attempt_started` / `attempt_failed` | 尝试序号、重试类别、故障域、是否继续重试和请求统计 |
| `action_completed` | 动作类型、动作成败、Day 前后值、是否经重试恢复、单次延迟/Token 与累计请求/Token |
| `episode_completed` | 终止 Day、动作/请求/重试/恢复汇总、最后延迟、故障类别、故障域和是否计入模型失败 |

进度事件不含 API Key、Base URL、Prompt、Observation、完整历史、上下文/观察 hash、`modelCallId`、响应正文、状态 diff、余额或任意上游错误消息。每行写出前再次执行敏感信息扫描；可用 `jq`、日志采集器或人工终端按 Provider 独立跟踪。

## 原始交换诊断

`ARENA_SAVE_RAW_EXCHANGES` 代码默认关闭；关闭时三种在线模式都不会创建正文文件。开启后统一写入：

```text
dist/arena-diagnostics/<matchId>/probe/
dist/arena-diagnostics/<matchId>/stability/
dist/arena-diagnostics/<matchId>/match/
```

每个 exchange 保存完整请求/响应正文和安全元数据，同时移除 Authorization、API Key、Cookie、Set-Cookie、Bearer 值及嵌套凭据字段。正文仍包含 Prompt、实际发送的有界上下文和模型原始输出，只能在本机用于受控诊断，不应粘贴到聊天、提交 Git 或进入比赛输出包。目录已被 Git 与 npm 包清单排除，也不自动清理。启停诊断不得改变 action、Trace、Replay、fact hash 或排名。

## 正式产物、Replay 与观众页

比赛输出目录最终必须包含：

| 文件 | 内容 |
| --- | --- |
| `probe-summary.json` | 五 Provider 脱敏 Probe 摘要及独立 hash |
| `stability-summary.json` | 五 Provider 十步稳定性摘要、重试/恢复统计及独立 hash |
| `episode-traces.json` | 五个隔离 Episode 的完整证据轨迹 |
| `replay.json` | `arena-schema-v4` 五模型事实 Replay |
| `run-report.json` | `arena-direct-run-report-v5` 请求账本、Token、revision、延迟、重试与故障汇总 |
| `replay.html` | 内嵌 Replay、脚本、样式和本地资源的离线单文件页面 |

Probe 与 Stability 摘要的 hash/创建时间只由 Run Report 引用，不进入 Replay fact hash。正式 Replay 构建器只接受 v4、五 Agent、五 Trace、五个唯一 `Provider + Model` 和连续 slot `0..4`，明确拒绝旧 schema 与四模型 Replay。

历史 `run-001` 的 JSON、hash、报告和已有 HTML 保持原样，但不再保证通过新版构建器重建。构建当前 Replay：

```bash
npm run arena:replay -- --input <replay.json>
```

默认写回同目录 `replay.html`，也可加 `--output <path>`。同一 Replay、源码和锁文件重复构建应字节一致。

观众页标题为“受控五模型展示赛”，身份只显示 `Provider + Model`。五个模型使用与 slot 无关的颜色和纹理，动作区采用自适应最小宽度布局。Day 1–39 不泄露终局；Day 40 只显示正式排名、DNF 和可对账的个人随机事件原始计数，技术 DNF 无正式名次。导出、弹窗、ARIA 和页面文本不得显示 A–E、策略名或 persona。

单文件 HTML 必须支持 `file://` 断网打开，不包含 Provider 调用或远程运行时依赖。日期跳转、导出、弹窗与 ARIA 共用同一事实切片；弹窗约束焦点并在关闭后归还触发卡片，页面支持 reduced-motion。

## 自动浏览器验收

浏览器验收使用锁文件中的 Playwright 与配套 Chromium，固定 `1366×768`、`1920×1080` 两个项目、单 worker、零重试。Playwright 当前验收入口只接受 Node 22/24/26；这不收窄 Arena 主包的运行时 engine。

首次安装浏览器：

```bash
npm run arena:browser:install
```

确定性 Fixture 回归：

```bash
npm run test:arena-browser:fixture
```

该命令固定覆盖五模型身份、Day 1/39/40、防剧透导出、技术 DNF、Replay/fact hash、缺失或篡改 Replay 的失败关闭、`file://` 离线、零远程请求、零控制台 error/warning、键盘、焦点、reduced-motion 和双视口无水平溢出。Fixture 使用测试数据，只证明框架与边界，不能作为真实模型证据。

真实比赛完成后，在不调用 Provider、不覆盖任何比赛产物的前提下执行：

```bash
npm run test:arena-browser -- \
  --input <run-directory>/replay.json \
  --report <run-directory>/browser-acceptance.json
```

正式入口要求输入 v4 Direct、五个唯一 `Provider + model` 和同目录 `replay.html`，并拒绝内置 Fake、Fixture、Scripted 等已知测试替身标记。它在系统临时目录重复构建 HTML 两次，要求 SHA-256 字节一致且与现有 HTML 相同，然后运行同一浏览器矩阵。无论通过或失败，显式报告路径都会得到 `arena-browser-acceptance-v1` JSON。

## 离线验证与未完成项

```bash
npm run test:arena
npm --prefix web run typecheck
npm run test:arena-browser:fixture
git diff --check
```

测试覆盖五 Fake Provider Probe + Stability + Match、有界上下文、动作修复、超时恢复、重试耗尽、不可重试 `context_limit`、账本对账、故障隔离、轮换、诊断脱敏、v4 失败关闭、Replay 重建确定性、敏感信息扫描和上述双视口浏览器检查。Fake Provider/Fake Fetch 与浏览器 Fixture 通过不代表真实账户、模型 ID、配额或端点在线可用。

新策略真实金样仍为 `0/3`。标准 `run-002` 目录中的 Probe 5/5 与 Stability 3/5 使用 `bounded-retry-v1` 和旧 Adapter 指纹；契约已升级为 v2，因此二者均只作诊断，不能越过新门禁。完整事实见 [`run-002` 诊断记录](arena-direct-acceptance-run-002.md)。下一次付费 Probe 必须另行取得产品负责人授权，Probe 通过后仍需单独授权 Stability。

## Replay Enrichment 与 legacy 边界

P0 Runner 只生成事实层。高光、采访、奖项和解说属于 P0.5 的独立 Replay Enrichment；通用生成使用与五个 Runner 均不同的第六组 `Provider + Model`。采访可调用对应选手原模型，但必须使用全新 session，且只提供截至采访日已发生的该选手事实。任何派生叙事、历史轮次或 Enrichment 缓存都不得写回 Runner 或后续比赛上下文。

strict MCP 属于 P1。Scripted Driver 只保留为 internal 确定性回归工具，不是产品入口、P0 金样或真实模型证据。legacy MCP 通过 `beijing-fushengji-mcp` bin 和 `npm run start:mcp` 保留。
