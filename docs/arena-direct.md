# Direct Arena 运行说明

> 当前实现与目标必须分开阅读：现有 CLI、源码和 `run-001` 固定为 A/B/C/D 四槽；修订后的 P0 是五个不同 `Provider + Model` 组合同时参赛。五槽支持尚未实现，本页不会把未来契约写成当前命令能力。

## 当前四槽实现

Direct Arena 固定使用四组独立 Provider 配置。四个槽位共享：

- `neutral-v1` 中性决策策略及同一策略 hash；
- `identity-free-v1` 模型观察契约；
- 规则、scenario、seed、公共市场、动作上限、超时、输出 Token 上限和零自动重试。

展示名称、颜色、persona、slot、Provider、model、adapter、episode ID 和审计 hash 只进入 Trace、Replay 和 UI，不进入模型上下文。Provider 适配器收到的近期结果也只包含 `success`、安全错误码和结果消息，不携带嵌套 Observation。

个人随机事件继续按槽位隔离，Replay 固定记录 `personalRandomization: slot-isolated`。因此当前比赛是“受控四模型展示赛”，不是纯模型能力基准。当前 `arena-schema-v2` 仍在第 40 天按个人随机事件计数生成最幸运/最倒霉标签；这是四槽历史实现，不是新版 P0 规则。

## 已完成的真实验收

2026-08-21 已使用四组真实配置完成一次 Provider Probe 和一次完整比赛，并生成 `dist/arena-direct/run-001` 下的本地 Replay、Trace、报告和 HTML。该次运行的 Provider/model、请求数、DNF、排名、Token、hash、浏览器验收结果及已知限制见 [2026-08-21 真实验收记录](arena-direct-acceptance-2026-08-21.md)。这是有日期、有配置边界的一次验收记录，不是对未来模型 ID、账户额度或服务可用性的持续保证；任何新配置仍应重新执行 Probe。

该记录只验收四槽历史实现，不能作为五模型 P0 的通过证据。`run-001` 不回填、不改写；新版比赛使用新目录和新验收记录。

## 五模型 P0 目标（待实现）

新版 P0 的比赛契约是：

- 五组独立 Runner 配置，五个 `Provider + Model` 组合不能完全重复；同一 Provider 下的不同 model 可以作为不同组合；
- 五个模型同场运行五个隔离 Episode，不是“五候选四”，也没有自动替补或中途换模；
- 五者共享版本化中性策略、无身份观察、规则、scenario、seed、公共市场、动作预算、超时、输出 Token 上限和零自动重试；
- 正式 UI 只使用 `Provider + Model` 作为参赛身份，不显示 A/B/C/D、策略化名称或 persona；内部 slot 只用于确定性排序和随机流；
- 单个 Provider 失败只使对应 Agent 技术 DNF，其他 Agent 继续；DNF 保留原始随机事件计数，但不进入“最幸运/最倒霉”候选；
- slot 轮换作为可配置选项保留。公开模型能力结论仍需要多 seed 与明确的轮换计划，单场只属于受控展示；
- P0 至少完成 3 场新版五模型 Direct 比赛。游戏内死亡、破产和解释充分的技术 DNF 均可保留为真实结果，不要求五个 Agent 都存活到第 40 天。

Runner 只生成事实层。每次模型调用的决策输入不得包含叙事内容、采访、导演标签、奖项、历史轮次结果或其他参赛者信息。新版审计还需补齐：版本化上下文策略、实际发送上下文 hash、model revision、sampling parameters、总墙钟上限、请求与 action 的逐条关联、平台/Provider/模型故障归属，以及输入/输出/总 Token；暂不计算货币价格。

五槽实现完成后，Provider Probe 应对五组配置各发起恰好一次请求，并保存脱敏结果摘要。同一个原始交换开关覆盖 Probe 和正式比赛，代码默认关闭、开发 `.env` 开启；正文写入独立、脱敏、Git 忽略且当前不自动清理的本地目录。事实 Replay 继续只保存结构化事实。上述目标尚未由当前 A/B/C/D CLI 实现。

## Replay Enrichment P0.5（待实现）

导演高光、采访、奖项及其他娱乐内容不进入 Runner。它们只能在事实 Replay 完成后由独立 Replay Enrichment 管线加工：

- 通用生成使用与五个 Runner `Provider + Model` 组合均不重复的第六组模型配置，不共用 Runner 配置；
- Enrichment 的失败不得修改、阻断或重新运行事实比赛，派生内容应有独立版本、来源和 hash；
- 唯一例外是赛后采访可以分别调用各参赛者原模型，但每个历史采访截面只能读取该选手截至采访日已经发生的事实结果；
- 采访、奖项、解说、历史轮次结论及其他派生叙事永不写回 Runner，也不进入后续轮次或后续比赛上下文。

strict MCP 已移入 P1；当前 legacy MCP 与 `StrictMcpEpisodePort` 占位不属于 Direct P0。

## Provider 协议

| provider | 协议 | Base URL 示例 |
| --- | --- | --- |
| `gpt` / `openai` | OpenAI Responses | `https://api.openai.com/v1` |
| `claude` / `anthropic` | Anthropic Messages | `https://api.anthropic.com/v1` |
| `deepseek` | OpenAI-compatible Chat Completions | `https://api.deepseek.com` |
| `qwen` / `dashscope` | OpenAI-compatible Chat Completions | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `kimi` / `moonshot` | OpenAI-compatible Chat Completions | `https://api.moonshot.cn/v1` |
| `openai-compatible` / `openai-chat` | 通用 Chat Completions | 由使用者明确提供 |

OpenAI 使用 `/responses` 与严格 JSON Schema；Anthropic 使用 `/messages`、`x-api-key` 和 `anthropic-version`；其余兼容服务使用 `/chat/completions`。各适配器统一返回严格 `GameAction`、归一化 Token usage 和脱敏错误分类。

DeepSeek V4 默认会进入 thinking。Arena 的动作只需要一个短 JSON，因此 DeepSeek 槽位默认使用 `ARENA_AGENT_<槽位>_THINKING=disabled`，并发送 `thinking: { type: "disabled" }`。可选值为 `default`（完全不发送 `thinking` 字段）、`disabled`、`enabled`；后两者当前只允许用于 DeepSeek。该值会进入 Trace、Replay 和 Probe 审计，但不会进入模型 Prompt。

## 当前四组配置（已实现）

仓库根目录的 `.env` 已被 Git 忽略；可提交模板是 `.env.example`。建议实际文件权限为 `0600`。

```dotenv
ARENA_AGENT_A_PROVIDER=openai
ARENA_AGENT_A_BASE_URL=https://api.openai.com/v1
ARENA_AGENT_A_API_KEY=
ARENA_AGENT_A_MODEL=

ARENA_AGENT_B_PROVIDER=anthropic
ARENA_AGENT_B_BASE_URL=https://api.anthropic.com/v1
ARENA_AGENT_B_API_KEY=
ARENA_AGENT_B_MODEL=

ARENA_AGENT_C_PROVIDER=deepseek
ARENA_AGENT_C_BASE_URL=https://api.deepseek.com
ARENA_AGENT_C_API_KEY=
ARENA_AGENT_C_MODEL=
ARENA_AGENT_C_THINKING=disabled

ARENA_AGENT_D_PROVIDER=qwen
ARENA_AGENT_D_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ARENA_AGENT_D_API_KEY=
ARENA_AGENT_D_MODEL=

ARENA_SEED=20260820
ARENA_MAX_ACTIONS_PER_AGENT=160
ARENA_DECISION_TIMEOUT_MS=60000
ARENA_MAX_OUTPUT_TOKENS=512
```

`512` 是当前 CLI 默认值。本次 2026-08-21 真实展示赛显式使用 `4096`，该实际预算已写入 Replay 的 `competitionAudit.maxOutputTokensPerRequest`，不应从示例默认值反推历史比赛配置。

API Key 只从对应环境变量读取，不接受命令行参数。Provider、模型和 adapter version 是公开审计字段；Key、Authorization、Base URL、原始响应和系统指令正文不会进入 Trace、Replay 或报告。模型 ID 与 Base URL 也不得夹带凭据。

第五组 Runner 配置及其命名尚未落地。实现时必须同时更新 CLI allowlist、凭据清理、Probe 请求数、配置摘要、不同 `Provider + Model` 组合校验和测试；在此之前，添加 `ARENA_AGENT_E_*` 不会让当前 CLI 自动支持五模型。

## 运行顺序

### 1. 当前四槽零网络配置检查

```bash
npm run arena:direct -- --check-config
```

该命令显示四组脱敏配置，不联网、不写产物，也不要求输出目录。

### 2. 当前四请求 Provider Probe

```bash
npm run arena:direct -- --probe-providers
```

`--probe-providers` 本身就是恰好四次在线请求的授权，与 `--check-config`、`--confirm-live-run` 互斥。Probe 并行请求 A/B/C/D，各使用同一初始无身份观察，并在独立初始环境严格执行返回动作。它具有以下边界：

- 每个槽位恰好一次请求、零重试；
- 一家失败仍会尝试另外三家；
- 检查 endpoint、鉴权、模型 ID、JSON/Token 参数和 `GameAction`；
- 只输出安全的 Provider、model、adapter、usage、延迟、HTTP 状态与错误类别；
- 不要求输出目录，不生成 Replay/Trace/Report/HTML；
- 无论成功与否都不会自动启动完整比赛。

### 3. 当前四槽显式完整比赛

四家 Probe 全部通过后，另行执行：

```bash
npm run arena:direct -- \
  --output-dir <new-output-directory> \
  --confirm-live-run
```

当前完整比赛最多请求 `4 × maxActionsPerAgent` 次，默认上限为 640。单个 Provider 超时、拒绝、协议错误或非法动作会使对应 Agent 成为带安全分类与退出日的技术 DNF；其他 Agent 继续。DNF 是有效比赛结果，产物仍会生成。该命令只产生四槽历史格式产物，不满足五模型 P0。

Runner 会在联网前拒绝覆盖已有的 `replay.json`、`episode-traces.json`、`run-report.json` 或 `replay.html`，第二场比赛应使用新目录。

## 产物与报告

完整运行依次生成：

| 文件 | 内容 |
| --- | --- |
| `replay.json` | 当前 `arena-schema-v2` MatchReplay、比赛审计、身份、DNF、终局与运气计数 |
| `episode-traces.json` | 四个隔离 Episode 的完整证据轨迹 |
| `run-report.json` | 总计与逐 Agent 请求/动作/超时/DNF/错误/Token/usage 缺失数/延迟 |
| `replay.html` | 内嵌 Replay、脚本、样式和本地资源的离线单文件页面 |

当前四槽报告的费用字段固定记录为：

```json
{
  "status": "unavailable",
  "reason": "provider-pricing-not-estimated"
}
```

项目不内置价格表，也不推测费用。新版 P0 继续只统计输入、输出和总 Token，不计算货币价格。Token 与延迟只进入运行报告，不进入主观众界面。

JSON、Trace 和报告会先写盘，再构建 HTML。即使 HTML 构建失败，已完成的比赛事实也会保留，且可以无模型调用地重试：

```bash
npm run arena:replay -- --input dist/arena-direct/run-001/replay.json
```

默认在输入 Replay 同目录写入 `replay.html`；也可显式加 `--output <路径>`。构建器要求显式输入，校验 `replayHash`，使用固定资源顺序，不加入时间戳或远程依赖。同一 Replay、源码与锁文件重复构建应得到字节一致的 HTML。

### 本地浏览器验收

严格离线能力应直接打开单文件 HTML 验收：

```bash
open dist/arena-direct/run-001/replay.html
```

部分浏览器自动化插件因安全策略不能接管 `file://` 页面。要检查 DOM、控制台和交互，可以临时把同一产物目录仅绑定到本机回环地址：

```bash
python3 -m http.server 4173 \
  --bind 127.0.0.1 \
  --directory dist/arena-direct/run-001
```

然后访问 `http://127.0.0.1:4173/replay.html`，验收结束后停止服务。localhost 方式只解决自动化工具的页面接管限制，不能替代 `file://` 的断网验收，也不改变 HTML 不调用模型、无远程依赖的要求。浏览器可能自动请求不存在的 `/favicon.ico` 并产生一次 404；这不属于 Replay 页面依赖。

P0 必须把上述流程固化为可重复的自动浏览器验收，覆盖至少 Day 1、Day 39、Day 40、Agent 详情、DNF、最终排名、离线网络边界和控制台错误。Playwright 不是强制品牌，内置浏览器、Chrome 控制或其他等价工具均可；人工单次观看不能替代可重复验收。

### 原始请求与响应边界

正式 `replay.json`、Trace 和 `run-report.json` 不保存 API Key、Authorization、Base URL、系统指令正文或 Provider 原始响应。当前实现需要诊断协议时，只能单独生成经过脱敏的本地诊断文件；现有文件位于被 Git 忽略的 `dist/arena-diagnostics/`，不属于正式比赛产物，也不应提交。

新版 P0 要求正式验收包保存脱敏的 Probe 结果摘要。同一个显式诊断开关覆盖 Probe 和正式比赛原始请求/响应：代码默认关闭，开发 `.env` 开启；开启后正文写入独立、脱敏、Git 忽略的诊断目录，当前开发阶段不做自动清理。它不进入事实 Replay，也不默认随验收包分发。项目当前只用于本地研究、线下展示和私有仓库协作，但仍不得记录 API Key、Authorization 或未脱敏凭据。

## 正式页面边界

当前正式页面不导入模拟 Replay。缺少数据、schema 不兼容、结构无效或内容与 `replayHash` 不一致时，页面直接停止展示。当前四槽页面显示：

- Provider、模型与 adapter；
- 当日完整动作序列及结果；
- 现金、存款、债务、健康、库存、公开参考价计值净资产；
- 公共价格和公共事件；
- 第 1～39 天暂定排名与名次变化；
- DNF 分类与退出日；
- 第 40 天核心正式排名、运气审计与 Replay hash。

第 1～39 天的可见切片、弹窗和导出不携带终局排名或运气结果。第 40 天名次直接映射核心 `finalRanking`，技术 DNF 没有正式名次。HTML 在浏览器中不调用 Provider，也没有 `fetch`、XHR、WebSocket、外链脚本或外链样式。

新版五模型 P0 页面沿用相同事实和揭示边界，但参赛身份只显示 `Provider + Model`，不显示 A/B/C/D、persona 或策略化名称。Runner 只提供个人随机事件原始计数；“最幸运/最倒霉”等价值标签移到 Replay Enrichment，且技术 DNF 不参与候选。P0 页面不得混入未生成、未验证或影响事实 hash 的娱乐化 fallback。

## 范围说明

- P0 只做 Direct Runner、事实 Replay 和五模型事实观众页；strict MCP 移入 P1。legacy MCP Server 保持现状，`StrictMcpEpisodePort` 仍只是防止伪装已实现的接口占位。
- Replay Enrichment 属于 P0.5；采访、导演高光、奖项、人物结局和模型生成解说不写入 Runner 事实契约。
- Scripted 模式只保留为内部确定性回归工具，不属于产品范围、用户运行主流程、P0 验收或待办。
- Fake Provider/Fake Fetch 的离线测试通过，本身不等于真实账户、模型 ID、配额、JSON mode 或 Token 参数在线可用；2026-08-21 的具名真实验收只覆盖四槽历史实现，五模型配置仍必须重新 Probe 并完成新版验收。
- 当前交付目标是本地研究、线下展示和私有仓库协作，不包含公网托管或公开发布。
