# 北京浮生记 Arena

当前产品主线是 **Direct Arena**。待办 1 已把源码升级为五个不同 `Provider + Model` 的 Direct-only Runner，并完成 Fake Provider 离线闭环；待办 2 已建立 Playwright/Chromium 自动浏览器框架，并以确定性五模型 v3 Fixture 在双视口通过 14/14 检查。真实五 Provider Probe、三场新版金样及其正式浏览器报告仍未执行，因此当前不是完整 P0 已验收。2026-08-21 的四槽 `run-001` 继续作为不可回填的历史证据保留。

![北京浮生记](image.png)

## Direct Arena 主线

项目总体进度、v2.2 方案对照、剩余风险和已确认决策统一记录在 [项目进度台账](docs/project-status.md)。日期验收记录只保存当次事实，不替代滚动台账。

修订后的 P0 闭环是：

```text
五组不可重复的 Provider + Model 配置
→ 五次 Provider Probe 与脱敏摘要
→ 五模型 Direct 真实比赛
→ probe-summary.json / replay.json / episode-traces.json / run-report.json
→ 自动生成单文件 replay.html
→ 第 1～40 天事实回放
```

P0 至少完成 3 场新版五模型 Direct 比赛。游戏内死亡、破产或技术 DNF 都可以是如实记录的比赛结果，不要求五个 Agent 都存活到第 40 天；未解释的中断不能作为通过。五个参赛组合必须各自配置，且归一化后的 `Provider + Model` 组合不能重复。slot 采用 `cyclic-v1`，由 `ARENA_SLOT_ROTATION_INDEX=0..4` 配置轮换。

Runner 只负责事实比赛：所有参赛模型使用 `neutral-v1`、无身份 Observation 和 `full-history-v1`。每次请求包含固定系统指令、当前 Observation，以及本局此前全部 action、result、effects 和 state diff；不发送旧 Observation、不摘要、不截断，也不包含展示名称、persona、slot、Provider、model、其他参赛者、审计 ID、叙事或跨局结果。公共市场共享 seed，个人随机事件按 slot 隔离。技术 DNF 只影响对应 Agent，其他 Agent 继续。正式 UI 只显示 `Provider + Model`，Day 40 只展示正式排名、DNF 与个人随机事件原始计数。

Arena 工具链要求 Node.js 22.18 或更高版本；Playwright 浏览器验收固定使用其当前支持的 Node 22/24/26。离线测试使用 Fake Provider/Fake Fetch；Fixture 浏览器测试通过不等于真实 Provider 已在线验收。

### 当前五模型命令

```bash
npm ci
npm --prefix web ci
npm run test:arena
npm --prefix web run typecheck

# 首次使用自动浏览器验收时单独安装 Chromium
npm run arena:browser:install

# 确定性五模型 Fixture；只证明浏览器框架与固定边界
npm run test:arena-browser:fixture

# 对真实五模型 Direct Replay 生成机器可读正式报告；不会调用 Provider
npm run test:arena-browser -- \
  --input <run-directory>/replay.json \
  --report <run-directory>/browser-acceptance.json

# 查看或脱敏检查 Direct 配置（不会发起请求）
npm run arena:direct -- --help
npm run arena:direct -- --check-config

# 恰好并行请求 A...E 各一次，并原子写入指定目录的 probe-summary.json
npm run arena:direct -- --output-dir <new-output-directory> --probe-providers

# 同目录存在配置匹配、全部通过的最新 Probe 摘要后，显式启动比赛
npm run arena:direct -- --output-dir <same-output-directory> --confirm-live-run

# 只从五模型 arena-schema-v3 Replay 重建 HTML，不再次调用模型
npm run arena:replay -- --input <replay.json>
```

Direct Runner 默认读取仓库根目录的本地 `.env`，使用 `ARENA_AGENT_A...E_*` 五组本地配置；A–E 只是配置入口，不是公开身份。每组必须显式配置 `REASONING_EFFORT`，可声明 `MODEL_REVISION`；DeepSeek 另有独立 `THINKING` 开关。全场可覆盖总墙钟、轮换和输出预算。Probe 摘要的配置指纹包含 thinking 与 reasoning effort，但不包含 API Key 或其 hash，因此只更换 API Key 无法由门禁识别，需由操作者主动重新 Probe。完整 Provider 协议、审计、诊断和恢复构建边界见 [Direct Arena 运行说明](docs/arena-direct.md)。

Scripted 模式只保留为内部确定性回归工具，不属于产品范围、P0 验收或用户运行主流程。strict MCP 移入 P1；当前 legacy MCP 入口不迁移、不扩建，也不属于 Direct P0。

### Replay Enrichment（P0.5，尚未实现）

导演高光、采访、奖项和其他娱乐化内容只能在事实 Replay 完成后由独立 Replay Enrichment 阶段生成。通用 Enrichment 使用与五个 Runner `Provider + Model` 组合均不重复的第六组模型配置，失败时不得改变事实 Replay；唯一例外是赛后采访可分别调用各参赛者原模型，但只提供该选手截至采访日已经发生的事实结果。任何叙事输出、采访内容或历史轮次结果都不得进入 Runner 或后续比赛上下文。

### 2026-08-21 真实验收状态

已完成一次四 Provider Probe 和一次真实受控展示赛：四个槽位均实际收到请求；OpenAI、Anthropic 和 DeepSeek 得到有效比赛结果，Kimi 在 Day 1 超时后仅对应槽位技术 DNF，其他三局继续结算。Replay、Trace、运行报告和离线 HTML 均已生成并完成 Day 1/39/40 浏览器验收。该结论是四槽历史基线，只对应本次具名配置与本地产物，不满足修订后的五模型 P0，也不表示未来凭据、模型或网关无需重新 Probe。完整数字、hash、浏览器证据和已知延迟统计限制见 [2026-08-21 真实验收记录](docs/arena-direct-acceptance-2026-08-21.md)。

正式页面没有模拟 fallback；缺少或无法验证五模型 `arena-schema-v3` Replay 时会直接停止展示。新版正式构建器与浏览器验收入口都拒绝 v2、四模型 Replay 和已知 Fake/Fixture/Scripted 测试标记；历史 `run-001` 的 JSON、hash、报告和 HTML 保持原样。自动验收固定覆盖 Day 1/39/40、防剧透、技术 DNF、hash、失败关闭、`file://` 断网、控制台、键盘、焦点和 1366×768/1920×1080 布局；正式模式还会重复构建 HTML 并核对同目录产物。Fixture 通过不替代三场真实金样报告。历史边界见 [Direct-only Arena v0 说明](docs/arena-v0.md)。下一交付目标仅限本地研究、线下展示和私有仓库协作，不包含公网托管或公开发布。

## Legacy OpenClaw / MCP（非当前 Direct P0）

以下内容描述仓库继承的旧 MCP/OpenClaw 用法，仅为 legacy 兼容资料。它不使用当前 Direct Arena 的事实 Runner，不属于当前 P0；strict MCP 与统一核心的正式兼容工作已移入 P1。

### OpenClaw 的游戏

这是一款**让 OpenClaw 自己玩**的游戏。

OpenClaw 已经有了自己的社交平台 [Moltbook](https://github.com/anthropics/moltbook)，能在上面发帖、互动、交朋友。那 OpenClaw 当然也可以有自己的游戏——不是帮人类玩，是 AI 自己玩给你看。

你只需要说一句「来一局北京浮生记」，OpenClaw 就会化身北漂青年铁牛，独立完成 40 天的买卖、还债、存钱、跑路……全程自主决策，你只需要坐下来当观众。每隔 10 天铁牛还会给你"发朋友圈"汇报战况，游戏结束后还有一篇精彩的北漂故事回顾。

人类玩游戏，AI 看着。现在反过来了——**AI 玩游戏，你看着。**

## Legacy 游戏简介

你扮演北漂青年**铁牛**，带着 2000 元现金和 5000 元债务来到北京。在 40 天内通过倒卖 8 种商品（进口香烟、走私汽车、盗版 VCD 等）赚钱还债。债务每天涨 10% 复利，不还会膨胀到 22 万+。

最终得分 = 现金 + 银行存款 - 债务

## Legacy MCP 工具

| 工具 | 说明 |
|------|------|
| `start_game` | 开始新一局游戏 |
| `move` | 移动到指定地点（消耗 1 天） |
| `buy` / `sell` | 买入 / 卖出商品 |
| `bank` | 银行存款或取款 |
| `repay_debt` | 向村长还债 |
| `hospital` | 去医院治疗 |
| `rent_house` | 租更大的房子（扩容背包） |
| `get_status` | 查看当前游戏状态 |
| `load_game_records` | 加载历史游戏记录和经验总结 |
| `save_game_records` | 保存游戏记录和经验总结 |

## Legacy MCP 安装

### 前置条件

- Node.js >= 22.18.0（与当前 Arena 主包 engine 保持一致）
- npm

### 步骤

```bash
# 1. 克隆仓库
git clone <repo-url> beijing-fushengji-mcp
cd beijing-fushengji-mcp

# 2. 安装依赖
npm install

# 3. 编译 TypeScript
npm run build
```

编译后入口文件为 `dist/index.js`，通过 stdio 提供 MCP 服务。

## Legacy OpenClaw 安装

### 手动安装

完成上面的编译步骤后，执行以下三步将 Skill 注册到 OpenClaw：

```bash
# 1. 创建符号链接，让 OpenClaw 发现这个 Skill
ln -s "$(pwd)" ~/.openclaw/skills/beijing-fushengji-mcp

# 2. 注册 MCP Server 到 mcporter 配置
#    编辑 ~/.openclaw/workspace/config/mcporter.json，在 mcpServers 中添加：
#    "beijing-fushengji": {
#      "command": "node <绝对路径>/beijing-fushengji-mcp/dist/index.js"
#    }

# 3. 重启 Gateway 生效
openclaw gateway restart
```

### 验证安装

```bash
# 检查 Skill 是否就绪
openclaw skills list | grep beijing
# 应显示: ✓ ready │ 📦 beijing-fushengji
```

### Agent 自动安装指引

如果你是 AI Agent 并需要自动完成安装，按以下步骤执行：

1. 将本项目克隆到 `~/.openclaw/workspace/beijing-fushengji-mcp`
2. 在项目目录执行 `npm install && npm run build`
3. 创建符号链接：`ln -s ~/.openclaw/workspace/beijing-fushengji-mcp ~/.openclaw/skills/beijing-fushengji-mcp`
4. 读取 `~/.openclaw/workspace/config/mcporter.json`，在 `mcpServers` 对象中追加：
   ```json
   "beijing-fushengji": {
     "command": "node ~/.openclaw/workspace/beijing-fushengji-mcp/dist/index.js"
   }
   ```
   注意：`command` 中的路径必须展开为绝对路径（替换 `~`）
5. 执行 `openclaw gateway restart` 重启 Gateway
6. 执行 `openclaw skills list | grep beijing` 确认状态为 `✓ ready`

## 在其他 MCP 客户端中使用 legacy 入口

在任何支持 MCP 的客户端（Claude Desktop、Cursor 等）的配置中添加：

```json
{
  "mcpServers": {
    "beijing-fushengji": {
      "command": "node",
      "args": ["<绝对路径>/beijing-fushengji-mcp/dist/index.js"]
    }
  }
}
```

## Legacy MCP 项目结构

```
src/
├── types.ts        # 类型定义（GameState, GameResponse 等）
├── game-data.ts    # 游戏数据（商品、事件、地点、常量）
├── game-engine.ts  # 游戏引擎（状态管理、回合推进、事件触发）
└── index.ts        # MCP Server 入口（注册 13 个工具）
records/
└── game_records.md # AI Agent 游戏记录与经验档案（跨局持久化，≤2000字符）
```

## Legacy MCP 技术栈

- TypeScript 5.8（ES2022 / Node16 ESM）
- `@modelcontextprotocol/sdk` — MCP 协议
- `zod` — 参数校验
- 游戏状态纯内存，游戏记录持久化到 `records/game_records.md`

## 原版游戏
https://github.com/chrisguo/beijing_fushengji

## 许可证

GPL 2.0
