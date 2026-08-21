# 北京浮生记 Arena

当前版本的主线是 **Direct-only Arena**：四个独立 Provider/模型在同一中性决策策略、同一规则与预算下，各自完成一局 40 天比赛，并生成可校验 Replay、Trace、运行报告和单文件离线观众页。仓库原有 MCP Server 仍作为 legacy 入口保留，但不迁移、不扩建，也不属于本阶段 Arena 验收。

![北京浮生记](image.png)

## Direct-only 最小闭环

项目总体进度、v2.1 方案对照、风险和待确认决策统一记录在 [项目进度台账](docs/project-status.md)。日期验收记录只保存当次事实，不替代滚动台账。

当前冻结范围是：四组独立模型配置 → 四次 Provider Probe → 真实比赛 → `replay.json` / `episode-traces.json` / `run-report.json` → 自动生成 `replay.html` → 第 1～40 天事实回放。

四个槽位统一使用 `neutral-v1`，模型只接收无身份观察，不接收展示名称、persona、slot、Provider、model、episode ID 或审计 hash。公共市场共享 seed，个人随机事件仍按槽位隔离，所以本场明确标记为“受控四模型展示赛”，不宣称是纯模型能力排名。技术 DNF 只影响对应 Agent，其他 Agent 继续完成比赛。

Arena 工具链要求 Node.js 22.18 或更高版本。离线测试使用 Fake Provider/Fake Fetch；测试通过不等于真实 Provider 已在线验收。

```bash
npm ci
npm --prefix web ci
npm run test:arena
npm --prefix web run typecheck

# 显式生成 Scripted 金样（不会调用模型）
npm run build:arena

# 查看或脱敏检查 Direct 配置（不会发起请求）
npm run arena:direct -- --help
npm run arena:direct -- --check-config

# 恰好请求 A/B/C/D 各一次；本 flag 本身就是四次在线请求授权
npm run arena:direct -- --probe-providers

# Probe 全部通过后，另行显式启动完整比赛
npm run arena:direct -- --output-dir dist/arena-direct/run-001 --confirm-live-run

# 只从既有 Replay 重建 HTML，不再次调用模型
npm run arena:replay -- --input dist/arena-direct/run-001/replay.json
```

Direct Runner 默认读取仓库根目录的本地 `.env`。四位 Agent 分别使用 `ARENA_AGENT_A/B/C/D_PROVIDER`、`BASE_URL`、`API_KEY`、`MODEL` 四组独立配置，支持 OpenAI Responses、Anthropic Messages 和 OpenAI-compatible Chat Completions。DeepSeek 槽位另可用 `ARENA_AGENT_<槽位>_THINKING=default|disabled|enabled` 调整 thinking，默认 `disabled`。Probe 与 `--check-config`、`--confirm-live-run` 互斥；Probe 不要求输出目录、不写比赛产物，也绝不自动续跑完整比赛。完整配置、安全预算、报告字段和恢复构建方式见 [Direct Model Runner](docs/arena-direct.md)。

### 2026-08-21 真实验收状态

已完成一次四 Provider Probe 和一次真实受控展示赛：四个槽位均实际收到请求；OpenAI、Anthropic 和 DeepSeek 得到有效比赛结果，Kimi 在 Day 1 超时后仅对应槽位技术 DNF，其他三局继续结算。Replay、Trace、运行报告和离线 HTML 均已生成并完成 Day 1/39/40 浏览器验收。该结论只对应本次具名配置与本地产物，不表示未来凭据、模型或网关无需重新 Probe。完整数字、hash、浏览器证据和已知延迟统计限制见 [2026-08-21 真实验收记录](docs/arena-direct-acceptance-2026-08-21.md)。

正式页面没有模拟 fallback。缺少或无法验证 Replay 时会直接停止展示；Scripted 数据只能经显式 `arena:sample` / `build:arena` 流程生成。当前交付边界见 [Direct-only Arena 说明](docs/arena-v0.md)。本分支不包含 commit、push、部署或发布承诺。

## OpenClaw 的游戏

这是一款**让 OpenClaw 自己玩**的游戏。

OpenClaw 已经有了自己的社交平台 [Moltbook](https://github.com/anthropics/moltbook)，能在上面发帖、互动、交朋友。那 OpenClaw 当然也可以有自己的游戏——不是帮人类玩，是 AI 自己玩给你看。

你只需要说一句「来一局北京浮生记」，OpenClaw 就会化身北漂青年铁牛，独立完成 40 天的买卖、还债、存钱、跑路……全程自主决策，你只需要坐下来当观众。每隔 10 天铁牛还会给你"发朋友圈"汇报战况，游戏结束后还有一篇精彩的北漂故事回顾。

人类玩游戏，AI 看着。现在反过来了——**AI 玩游戏，你看着。**

## 游戏简介

你扮演北漂青年**铁牛**，带着 2000 元现金和 5000 元债务来到北京。在 40 天内通过倒卖 8 种商品（进口香烟、走私汽车、盗版 VCD 等）赚钱还债。债务每天涨 10% 复利，不还会膨胀到 22 万+。

最终得分 = 现金 + 银行存款 - 债务

## 提供的 MCP 工具

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

## 安装

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

## 在 OpenClaw 中安装

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

## 在其他 MCP 客户端中使用

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

## 项目结构

```
src/
├── types.ts        # 类型定义（GameState, GameResponse 等）
├── game-data.ts    # 游戏数据（商品、事件、地点、常量）
├── game-engine.ts  # 游戏引擎（状态管理、回合推进、事件触发）
└── index.ts        # MCP Server 入口（注册 13 个工具）
records/
└── game_records.md # AI Agent 游戏记录与经验档案（跨局持久化，≤2000字符）
```

## 技术栈

- TypeScript 5.8（ES2022 / Node16 ESM）
- `@modelcontextprotocol/sdk` — MCP 协议
- `zod` — 参数校验
- 游戏状态纯内存，游戏记录持久化到 `records/game_records.md`

## 原版游戏
https://github.com/chrisguo/beijing_fushengji

## 许可证

GPL 2.0
