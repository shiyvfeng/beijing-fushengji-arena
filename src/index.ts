#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { GameEngine } from "./game-engine.js";
import { DRUGS, LOCATIONS } from "./game-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

const engine = new GameEngine();

const server = new McpServer({
  name: "beijing-fushengji",
  version: "1.0.0",
  description: "北京浮生记 - AI自主玩的回合制经商游戏。你作为AI Agent通过调用游戏工具自主完成整局40天的游戏，不需要等待用户输入每一步操作。",
});

// ===== Tool: start_game =====
server.tool(
  "start_game",
  "开始一局新的北京浮生记游戏。你扮演铁牛，带着2000元现金和5000元债务来到北京，在40天内通过倒卖商品赚钱还债。开始后请自主循环调用move/buy/sell等工具完成全部40天，不要等待用户输入。",
  {},
  async () => {
    const res = engine.startGame();
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

// ===== Tool: move =====
server.tool(
  "move",
  `移动到指定地点（消耗1天）。移动后会生成新的市场价格并触发随机事件。地铁线路(0-9): ${LOCATIONS.filter(l => l.map === "subway").map(l => `${l.id}=${l.name}`).join(", ")}。地面线路(10-19): ${LOCATIONS.filter(l => l.map === "surface").map(l => `${l.id}=${l.name}`).join(", ")}`,
  { location_id: z.number().int().min(0).max(19).describe("目标地点ID (0-19)") },
  async ({ location_id }) => {
    const res = engine.move(location_id);
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

// ===== Tool: buy =====
server.tool(
  "buy",
  `买入商品。商品列表: ${DRUGS.map(d => `${d.id}=${d.name}(${d.basePrice}-${d.basePrice + d.priceRange}元)`).join(", ")}`,
  {
    item_id: z.number().int().min(0).max(7).describe("商品ID (0-7)"),
    quantity: z.number().int().min(1).describe("购买数量"),
  },
  async ({ item_id, quantity }) => {
    const res = engine.buy(item_id, quantity);
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

// ===== Tool: sell =====
server.tool(
  "sell",
  "卖出持有的商品。注意：卖假白酒(ID=3)扣10点声望，卖禁书(ID=4)扣7点声望。",
  {
    item_id: z.number().int().min(0).max(7).describe("商品ID (0-7)"),
    quantity: z.number().int().min(1).describe("卖出数量"),
  },
  async ({ item_id, quantity }) => {
    const res = engine.sell(item_id, quantity);
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

// ===== Tool: bank =====
server.tool(
  "bank",
  "银行操作：存款或取款。存款利率1%/天（复利）。建议有闲钱时存入银行赚利息。",
  {
    action: z.enum(["deposit", "withdraw"]).describe("操作类型: deposit=存款, withdraw=取款"),
    amount: z.number().int().min(1).describe("金额"),
  },
  async ({ action, amount }) => {
    const res = action === "deposit"
      ? engine.bankDeposit(amount)
      : engine.bankWithdraw(amount);
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

// ===== Tool: repay_debt =====
server.tool(
  "repay_debt",
  "向村长还债。债务利率10%/天（复利），5000元初始债务40天不还会膨胀到22万+。尽早还清！",
  { amount: z.number().int().min(1).describe("还款金额") },
  async ({ amount }) => {
    const res = engine.repayDebt(amount);
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

// ===== Tool: hospital =====
server.tool(
  "hospital",
  "去医院治疗。费用3500元/点。健康<85时会被强制住院1-2天。健康归零则死亡。",
  { heal_points: z.number().int().min(1).describe("治疗点数") },
  async ({ heal_points }) => {
    const res = engine.hospital(heal_points);
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

// ===== Tool: rent_house =====
server.tool(
  "rent_house",
  "租更大的房子，背包容量+10（初始100，上限140）。需要至少30000元现金，中介会收取大量费用。",
  {},
  async () => {
    const res = engine.rentHouse();
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

// ===== Tool: get_status =====
server.tool(
  "get_status",
  "查看当前游戏状态：现金/存款/债务、健康/声望、背包、市场价格、可选地点、价格历史。",
  {},
  async () => {
    const res = engine.getStatus();
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

// ===== Tool: check_update =====
server.tool(
  "check_update",
  "检查北京浮生记是否有新版本可用。比较本地版本和 GitHub 远程仓库的最新版本。",
  {},
  async () => {
    try {
      // fetch latest from remote
      execSync("git fetch origin", { cwd: PROJECT_ROOT, stdio: "pipe", timeout: 30000 });

      const localHead = execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim();
      const remoteHead = execSync("git rev-parse origin/main", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim();

      const localMsg = execSync("git log -1 --format=%s", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim();
      const localDate = execSync("git log -1 --format=%ci", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim();

      if (localHead === remoteHead) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              hasUpdate: false,
              message: "当前已是最新版本，无需更新。",
              localVersion: { commit: localHead.slice(0, 7), message: localMsg, date: localDate },
            }, null, 2),
          }],
        };
      }

      const remoteMsg = execSync("git log -1 origin/main --format=%s", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim();
      const remoteDate = execSync("git log -1 origin/main --format=%ci", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim();
      const behindCount = execSync("git rev-list HEAD..origin/main --count", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            hasUpdate: true,
            message: `发现新版本！当前落后远程 ${behindCount} 个提交。请调用 update_game 工具进行更新。`,
            localVersion: { commit: localHead.slice(0, 7), message: localMsg, date: localDate },
            remoteVersion: { commit: remoteHead.slice(0, 7), message: remoteMsg, date: remoteDate },
            behindCommits: Number(behindCount),
          }, null, 2),
        }],
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            hasUpdate: false,
            message: `检查更新失败：${errMsg}`,
          }, null, 2),
        }],
      };
    }
  },
);

// ===== Tool: update_game =====
server.tool(
  "update_game",
  "更新北京浮生记到最新版本。执行 git pull、npm install、npm run build。更新完成后需要用户重启 gateway 才能生效。",
  {},
  async () => {
    const steps: string[] = [];
    try {
      // Step 1: git pull
      const pullOutput = execSync("git pull origin main", {
        cwd: PROJECT_ROOT, encoding: "utf-8", stdio: "pipe", timeout: 60000,
      }).trim();
      steps.push(`✅ git pull: ${pullOutput}`);

      if (pullOutput.includes("Already up to date")) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "当前已是最新版本，无需更新。",
              steps,
              needRestart: false,
            }, null, 2),
          }],
        };
      }

      // Step 2: npm install
      const installOutput = execSync("npm install --omit=dev", {
        cwd: PROJECT_ROOT, encoding: "utf-8", stdio: "pipe", timeout: 120000,
      }).trim();
      steps.push(`✅ npm install: 依赖安装完成`);

      // Step 3: npm run build
      execSync("npm run build", {
        cwd: PROJECT_ROOT, encoding: "utf-8", stdio: "pipe", timeout: 60000,
      });
      steps.push(`✅ npm run build: 编译完成`);

      const newCommit = execSync("git log -1 --format=%s", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: "更新成功！请运行 `openclaw gateway restart` 重启网关以加载新版本。",
            steps,
            latestCommit: newCommit,
            needRestart: true,
          }, null, 2),
        }],
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      steps.push(`❌ 失败: ${errMsg}`);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            message: `更新失败：${errMsg}`,
            steps,
            needRestart: false,
          }, null, 2),
        }],
      };
    }
  },
);

// 启动 MCP Server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
