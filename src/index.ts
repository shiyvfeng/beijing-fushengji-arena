#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GameEngine } from "./game-engine.js";
import { DRUGS, LOCATIONS } from "./game-data.js";

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

// 启动 MCP Server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
