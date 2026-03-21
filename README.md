# 北京浮生记 MCP Server

经典回合制经商游戏「北京浮生记」的 MCP Server 实现。AI Agent 通过 MCP 工具自主完成整局 40 天的游戏——移动、买卖、存取款、还债，全程无需人类干预。

![北京浮生记](image.png)

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
└── index.ts        # MCP Server 入口（注册 9 个工具）
```

## 技术栈

- TypeScript 5.8（ES2022 / Node16 ESM）
- `@modelcontextprotocol/sdk` — MCP 协议
- `zod` — 参数校验
- 纯内存状态，无数据库依赖

## 原版游戏
https://github.com/chrisguo/beijing_fushengji

## 许可证

GPL 2.0
