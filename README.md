# 北京浮生记 Arena

当前产品主线是 **Direct Arena**。当前源码和 2026-08-21 的 `run-001` 仍是已验收的四槽历史实现；修订后的 P0 目标是五个不同的 `Provider + Model` 组合同时参赛，在相同中性策略、规则与预算下各自完成一局 40 天比赛，并生成可校验 Replay、Trace、运行报告和单文件离线观众页。五模型支持尚未实现，不能用四槽命令或 `run-001` 代替新版 P0 验收。

![北京浮生记](image.png)

## Direct Arena 主线

项目总体进度、v2.2 方案对照、剩余风险和已确认决策统一记录在 [项目进度台账](docs/project-status.md)。日期验收记录只保存当次事实，不替代滚动台账。

修订后的 P0 闭环是：

```text
五组不可重复的 Provider + Model 配置
→ 五次 Provider Probe 与脱敏摘要
→ 五模型 Direct 真实比赛
→ replay.json / episode-traces.json / run-report.json
→ 自动生成单文件 replay.html
→ 第 1～40 天事实回放
```

P0 至少完成 3 场新版五模型 Direct 比赛。游戏内死亡、破产或技术 DNF 都可以是如实记录的比赛结果，不要求五个 Agent 都存活到第 40 天；未解释的中断不能作为通过。五个参赛组合必须各自配置，且 `Provider + Model` 组合不能完全重复。slot 轮换保留为可配置选项。

Runner 只负责事实比赛：所有参赛模型使用同一版本化中性策略和无身份观察，不接收展示名称、persona、slot、Provider、model、episode ID、审计 hash、叙事内容或历史轮次结论。公共市场共享 seed，个人随机事件按 slot 隔离。技术 DNF 只影响对应 Agent，其他 Agent 继续；DNF 保留原始随机事件计数，但不参与“最幸运/最倒霉”判断。正式 UI 的参赛者身份只显示 `Provider + Model`，不显示 A/B/C/D 或策略化名称。

Arena 工具链要求 Node.js 22.18 或更高版本。离线测试使用 Fake Provider/Fake Fetch；测试通过不等于真实 Provider 已在线验收。

### 当前可执行命令：四槽历史实现

以下命令准确描述当前源码，仍只读取 A/B/C/D 四组配置。它们可用于维护和历史产物重建，但在五槽实现完成前不能产生新版 P0 验收结果。

```bash
npm ci
npm --prefix web ci
npm run test:arena
npm --prefix web run typecheck

# 查看或脱敏检查 Direct 配置（不会发起请求）
npm run arena:direct -- --help
npm run arena:direct -- --check-config

# 恰好请求 A/B/C/D 各一次；本 flag 本身就是四次在线请求授权
npm run arena:direct -- --probe-providers

# Probe 全部通过后，另行显式启动当前四槽比赛；必须使用新目录
npm run arena:direct -- --output-dir <new-output-directory> --confirm-live-run

# 只从既有 Replay 重建 HTML，不再次调用模型
npm run arena:replay -- --input dist/arena-direct/run-001/replay.json
```

当前 Direct Runner 默认读取仓库根目录的本地 `.env`，并使用 `ARENA_AGENT_A/B/C/D_*` 四组配置。目标实现将扩展为五组不可重复的参赛配置，但现阶段不要把未支持的第五组写成“已经可运行”。Provider 协议、当前命令、五模型目标契约、诊断边界和恢复构建方式见 [Direct Arena 运行说明](docs/arena-direct.md)。

Scripted 模式只保留为内部确定性回归工具，不属于产品范围、P0 验收或用户运行主流程。strict MCP 移入 P1；当前 legacy MCP 入口不迁移、不扩建，也不属于 Direct P0。

### Replay Enrichment（P0.5，尚未实现）

导演高光、采访、奖项和其他娱乐化内容只能在事实 Replay 完成后由独立 Replay Enrichment 阶段生成。通用 Enrichment 使用与五个 Runner `Provider + Model` 组合均不重复的第六组模型配置，失败时不得改变事实 Replay；唯一例外是赛后采访可分别调用各参赛者原模型，但只提供该选手截至采访日已经发生的事实结果。任何叙事输出、采访内容或历史轮次结果都不得进入 Runner 或后续比赛上下文。

### 2026-08-21 真实验收状态

已完成一次四 Provider Probe 和一次真实受控展示赛：四个槽位均实际收到请求；OpenAI、Anthropic 和 DeepSeek 得到有效比赛结果，Kimi 在 Day 1 超时后仅对应槽位技术 DNF，其他三局继续结算。Replay、Trace、运行报告和离线 HTML 均已生成并完成 Day 1/39/40 浏览器验收。该结论是四槽历史基线，只对应本次具名配置与本地产物，不满足修订后的五模型 P0，也不表示未来凭据、模型或网关无需重新 Probe。完整数字、hash、浏览器证据和已知延迟统计限制见 [2026-08-21 真实验收记录](docs/arena-direct-acceptance-2026-08-21.md)。

正式页面没有模拟 fallback；缺少或无法验证 Replay 时会直接停止展示。当前四模型纵向切片的历史边界见 [Direct-only Arena v0 说明](docs/arena-v0.md)。下一交付目标仅限本地研究、线下展示和私有仓库协作，不包含公网托管或公开发布。具体工具品牌不是硬要求，但 P0 必须具备可重复的自动浏览器验收，并同时保留单文件 `file://` 断网验收。

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

- Node.js >= 18
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
