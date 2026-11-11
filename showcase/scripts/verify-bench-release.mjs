#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(root, "release");
const workRoot = join(root, "work", "bench-acceptance");
const reportPath = join(root, "evidence", "bench", "browser-acceptance.json");
const supportedNodeMajors = new Set([22, 24, 26]);
const viewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function staticServer() {
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const relativePath = pathname === "/" ? "bench.html" : normalize(pathname).replace(/^[/\\]+/u, "");
    const filePath = resolve(releaseRoot, relativePath);
    if (!filePath.startsWith(`${releaseRoot}/`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = readFileSync(filePath);
      const mime = extname(filePath) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream";
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Length": body.byteLength, "Content-Type": mime });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

async function listen(server) {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === "object", "Bench 验收服务器未能取得端口");
  return `http://127.0.0.1:${address.port}/bench.html`;
}

async function verifyViewport(browser, target, viewport, mode) {
  const context = await browser.newContext({
    colorScheme: "light",
    locale: "zh-CN",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    viewport,
  });
  const page = await context.newPage();
  const issues = [];
  page.on("console", message => {
    if (["warning", "error"].includes(message.type())) issues.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", error => issues.push(`pageerror: ${error.message}`));
  page.on("request", request => {
    const url = new URL(request.url());
    const allowed = mode === "file" ? ["file:", "data:", "blob:"].includes(url.protocol) : url.origin === new URL(target).origin;
    if (!allowed) issues.push(`remote request: ${request.url()}`);
  });
  page.on("response", response => {
    if (response.status() >= 400) issues.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  await page.goto(target, { waitUntil: "networkidle" });
  assert((await page.title()).includes("Bench 分析"), "Bench 页面标题缺失");
  assert(await page.getByRole("heading", { name: /不只看谁赢/u }).isVisible(), "Bench 主标题不可见");
  assert((await page.locator(".run-card").count()) === 2, "默认应同时展示 Gold 1 与 Gold 2");
  assert((await page.locator(".score-table tbody tr").count()) === 10, "终局成绩表应展示两场共十条成绩");
  assert((await page.locator(".strategy-run").count()) === 2, "策略复盘应同时展示两场");
  assert((await page.locator(".strategy-table tbody tr").count()) === 10, "策略复盘应展示两场共十条模型分析");
  assert((await page.locator(".cross-run-table tbody tr").count()) === 5, "双场模式应展示五条跨场策略对照");
  assert((await page.locator(".reliability-table tbody tr").count()) === 10, "稳定性表应展示两场共十条记录");
  assert((await page.locator(".process-run").count()) === 2, "逐请求轨迹应展示两场");
  assert((await page.locator(".process-cells .call-cell").count()) === 410, "逐请求轨迹应包含 410 次真实请求");
  assert(await page.getByText("成本不可用").first().isVisible(), "成本不可用边界未展示");
  assert(await page.getByText(/6 次缺失/u).isVisible(), "Gold 2 Token usage 缺失未展示");
  assert(await page.getByText(/Stability 失败 · 已豁免/u).isVisible(), "Gold 1 Stability waiver 未展示");
  assert(await page.getByText(/Probe 失败 · 已豁免/u).isVisible(), "Gold 2 Probe waiver 未展示");
  assert(await page.getByText(/¥9,180，占当时现金 87%/u).isVisible(), "Gold 1 DeepSeek 重仓动作证据未展示");
  assert(await page.getByText(/获赠 2 辆走私汽车后卖得 ¥48,606/u).isVisible(), "Gold 2 Kimi 赠品驱动证据未展示");
  assert(await page.getByText(/¥102,488 → ¥112,736 → ¥124,009/u).isVisible(), "Gold 2 Qwen 债务链证据未展示");
  assert(await page.getByText(/Claude Opus 5.*裸调工具调用能力最强/u).isVisible(), "Opus 5 工具调用综合判断未展示");
  assert(await page.getByText(/Qwen.*每场比赛中呈现出的整体策略感最强/u).isVisible(), "Qwen 策略感综合判断未展示");
  assert(await page.getByText(/提示词 v1 无法跑完整场.*连续 3 次输出超时/u).isVisible(), "DeepSeek 提示词与超时综合判断未展示");

  await page.getByRole("tab", { name: "只看 Gold 1" }).click();
  assert((await page.locator(".run-card").count()) === 1, "Gold 1 筛选后场次卡数量错误");
  assert((await page.locator(".score-table tbody tr").count()) === 5, "Gold 1 筛选后成绩行数量错误");
  assert((await page.locator(".strategy-run").count()) === 1, "Gold 1 筛选后策略场次数量错误");
  assert((await page.locator(".strategy-table tbody tr").count()) === 5, "Gold 1 筛选后策略行数量错误");
  assert((await page.locator(".cross-run-table").count()) === 0, "单场筛选时不应展示跨场策略表");
  await page.getByRole("tab", { name: "只看 Gold 2" }).click();
  assert((await page.locator(".run-card").count()) === 1, "Gold 2 筛选后场次卡数量错误");
  assert((await page.locator(".score-table tbody tr").count()) === 5, "Gold 2 筛选后成绩行数量错误");
  assert((await page.locator(".strategy-run").count()) === 1, "Gold 2 筛选后策略场次数量错误");
  assert((await page.locator(".strategy-table tbody tr").count()) === 5, "Gold 2 筛选后策略行数量错误");
  await page.getByRole("tab", { name: "双场对比" }).click();

  mkdirSync(workRoot, { recursive: true });
  const screenshot = join(workRoot, `bench-${mode}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  assert(issues.length === 0, issues.join("\n"));
  await context.close();
  return {
    mode,
    viewport,
    status: "passed",
    screenshot: screenshot.replace(`${root}/`, ""),
    checks: ["dual-run", "filters", "scores", "strategy-review", "strategy-evidence", "cross-run-strategy", "latency", "tokens", "usage-missing", "waivers", "reliability", "request-process", "offline"],
  };
}

async function main() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  assert(supportedNodeMajors.has(nodeMajor), `Bench 浏览器验收只支持 Node 22/24/26，当前为 ${process.versions.node}`);
  const server = staticServer();
  let browser;
  try {
    const httpTarget = await listen(server);
    browser = await chromium.launch({ headless: true });
    const fileTarget = pathToFileURL(join(releaseRoot, "bench.html")).href;
    const results = [];
    for (const viewport of viewports) {
      results.push(await verifyViewport(browser, fileTarget, viewport, "file"));
      results.push(await verifyViewport(browser, httpTarget, viewport, "http"));
    }
    const report = {
      artifactType: "arena-bench-browser-acceptance-v1",
      generatedAt: new Date().toISOString(),
      nodeVersion: process.versions.node,
      browser: "chromium",
      status: "passed",
      results,
    };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`Bench 浏览器验收通过：${results.length}/${results.length}\n`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
