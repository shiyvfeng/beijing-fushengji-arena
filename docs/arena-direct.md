# Direct-only Arena 运行说明

## 当前赛制

Direct Arena 固定使用四组独立 Provider 配置。四个槽位共享：

- `neutral-v1` 中性决策策略及同一策略 hash；
- `identity-free-v1` 模型观察契约；
- 规则、scenario、seed、公共市场、动作上限、超时、输出 Token 上限和零自动重试。

展示名称、颜色、persona、slot、Provider、model、adapter、episode ID 和审计 hash 只进入 Trace、Replay 和 UI，不进入模型上下文。Provider 适配器收到的近期结果也只包含 `success`、安全错误码和结果消息，不携带嵌套 Observation。

个人随机事件继续按槽位隔离，Replay 固定记录 `personalRandomization: slot-isolated`。因此当前比赛是“受控四模型展示赛”，不是纯模型能力基准。第 40 天的最幸运/最倒霉标记只按 Replay 中有 catalog ID 与随机流证据的个人事件计数：现金或健康下降、债务增加为负面；没有负面效果的纯库存赠送为正面。先比较负面更少，再比较正面更多；反向得到最倒霉者，允许并列。

## 已完成的真实验收

2026-08-21 已使用四组真实配置完成一次 Provider Probe 和一次完整比赛，并生成 `dist/arena-direct/run-001` 下的本地 Replay、Trace、报告和 HTML。该次运行的 Provider/model、请求数、DNF、排名、Token、hash、浏览器验收结果及已知限制见 [2026-08-21 真实验收记录](arena-direct-acceptance-2026-08-21.md)。这是有日期、有配置边界的一次验收记录，不是对未来模型 ID、账户额度或服务可用性的持续保证；任何新配置仍应重新执行 Probe。

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

## 四组配置

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

## 运行顺序

### 1. 零网络配置检查

```bash
npm run arena:direct -- --check-config
```

该命令显示四组脱敏配置，不联网、不写产物，也不要求输出目录。

### 2. 四请求 Provider Probe

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

### 3. 显式完整比赛

四家 Probe 全部通过后，另行执行：

```bash
npm run arena:direct -- \
  --output-dir dist/arena-direct/run-001 \
  --confirm-live-run
```

完整比赛最多请求 `4 × maxActionsPerAgent` 次，默认上限为 640。单个 Provider 超时、拒绝、协议错误或非法动作会使对应 Agent 成为带安全分类与退出日的技术 DNF；其他 Agent 继续。DNF 是有效比赛结果，产物仍会生成。

Runner 会在联网前拒绝覆盖已有的 `replay.json`、`episode-traces.json`、`run-report.json` 或 `replay.html`，第二场比赛应使用新目录。

## 产物与报告

完整运行依次生成：

| 文件 | 内容 |
| --- | --- |
| `replay.json` | `arena-schema-v2` MatchReplay、比赛审计、身份、DNF、终局与运气计数 |
| `episode-traces.json` | 四个隔离 Episode 的完整证据轨迹 |
| `run-report.json` | 总计与逐 Agent 请求/动作/超时/DNF/错误/Token/usage 缺失数/延迟 |
| `replay.html` | 内嵌 Replay、脚本、样式和本地资源的离线单文件页面 |

费用固定记录为：

```json
{
  "status": "unavailable",
  "reason": "provider-pricing-not-estimated"
}
```

项目不内置价格表，也不推测费用。Token 与延迟只进入运行报告，不进入主观众界面。

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

### 原始请求与响应边界

正式 `replay.json`、Trace 和 `run-report.json` 不保存 API Key、Authorization、Base URL、系统指令正文或 Provider 原始响应。需要诊断协议时，应单独生成经过脱敏的本地诊断文件；当前会话生成的文件位于被 Git 忽略的 `dist/arena-diagnostics/`，不属于正式比赛产物，也不应提交或公开。正式 Replay 只保留动作、执行事实、Provider/model/adapter、usage、延迟和安全错误分类。

## 正式页面边界

正式页面不导入模拟 Replay。缺少数据、schema 不兼容、结构无效或内容与 `replayHash` 不一致时，页面直接停止展示。页面仅显示：

- Provider、模型与 adapter；
- 当日完整动作序列及结果；
- 现金、存款、债务、健康、库存、公开参考价计值净资产；
- 公共价格和公共事件；
- 第 1～39 天暂定排名与名次变化；
- DNF 分类与退出日；
- 第 40 天核心正式排名、运气审计与 Replay hash。

第 1～39 天的可见切片、弹窗和导出不携带终局排名或运气结果。第 40 天名次直接映射核心 `finalRanking`，技术 DNF 没有正式名次。HTML 在浏览器中不调用 Provider，也没有 `fetch`、XHR、WebSocket、外链脚本或外链样式。

## 当前非目标

- legacy MCP Server 保持现状；`StrictMcpEpisodePort` 只是接口占位，Runner 会拒绝将 MCP 描述符伪装成已执行能力。
- 采访、预测对账、导演高光、奖项、人物结局和模型生成解说不在 Replay 契约或正式页面中。
- `npm run build:arena` 是显式 Scripted 金样，不代表任何在线模型或 MCP 验收。
- Fake Provider/Fake Fetch 的离线测试通过，本身不等于真实账户、模型 ID、配额、JSON mode 或 Token 参数在线可用；虽然 2026-08-21 已完成一次具名真实验收，后续配置仍必须独立 Probe。
