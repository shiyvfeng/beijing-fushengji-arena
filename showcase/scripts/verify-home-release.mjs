#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(root, "release");
const workRoot = join(root, "work", "home-acceptance");
const reportPath = join(root, "evidence", "home", "browser-acceptance.json");
const supportedNodeMajors = new Set([22, 24, 26]);
const viewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".png", "image/png"],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function staticServer() {
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const relativePath = pathname === "/" ? "index.html" : normalize(pathname).replace(/^[/\\]+/u, "");
    const filePath = resolve(releaseRoot, relativePath);
    if (!filePath.startsWith(`${releaseRoot}/`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = readFileSync(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": body.byteLength,
        "Content-Type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream",
      });
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
  assert(address && typeof address === "object", "本地验收服务器未能取得端口");
  return `http://127.0.0.1:${address.port}`;
}

async function verifyViewport(browser, target, viewport, mode) {
  const context = await browser.newContext({
    colorScheme: "light",
    locale: "zh-CN",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    viewport,
  });
  await context.addInitScript(() => {
    let fullscreenTarget = null;
    Object.defineProperty(Document.prototype, "fullscreenEnabled", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(Document.prototype, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenTarget,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: async function requestFullscreen(options) {
        fullscreenTarget = this;
        Reflect.set(window, "__arenaFullscreenTarget", this === document.documentElement ? "documentElement" : "other");
        Reflect.set(window, "__arenaFullscreenOptions", options);
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
    Object.defineProperty(Document.prototype, "exitFullscreen", {
      configurable: true,
      value: async () => {
        fullscreenTarget = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
  });
  const page = await context.newPage();
  const issues = [];
  page.on("console", message => {
    if (["warning", "error"].includes(message.type())) issues.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", error => issues.push(`pageerror: ${error.message}`));
  page.on("request", request => {
    const url = new URL(request.url());
    const allowed = mode === "file"
      ? ["file:", "data:", "blob:"].includes(url.protocol)
      : url.origin === new URL(target).origin;
    if (!allowed) issues.push(`remote request: ${request.url()}`);
  });
  page.on("response", response => {
    if (response.status() >= 400) issues.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  await page.goto(target, { waitUntil: "networkidle" });
  assert((await page.title()).includes("北京浮生记"), "首页标题缺失");
  assert(await page.locator(".home-shell").isVisible(), "首页主体不可见");
  assert(await page.getByRole("link", { name: "比赛回放", exact: true }).isVisible(), "比赛回放入口不可见");
  assert(await page.getByRole("link", { name: /玩法介绍/u }).isVisible(), "玩法介绍入口不可见");
  assert(await page.getByRole("link", { name: /Bench 分析/u }).isVisible(), "Bench 分析入口不可见");

  const fullscreenButton = page.getByRole("button", { name: "进入全屏", exact: true });
  const musicButton = page.getByRole("button", { name: /音乐开关/u });
  assert(await fullscreenButton.isVisible(), "首页全屏按钮不可见");
  assert(await fullscreenButton.isEnabled(), "首页全屏按钮不可用");
  const toolbarAlignment = await page.evaluate(() => {
    const fullscreen = document.querySelector(".home-fullscreen-control")?.getBoundingClientRect();
    const music = document.querySelector(".music-control")?.getBoundingClientRect();
    const hero = document.querySelector(".home-hero")?.getBoundingClientRect();
    return fullscreen && music && hero ? {
      fullscreenLeft: fullscreen.left,
      fullscreenTop: fullscreen.top,
      fullscreenHeight: fullscreen.height,
      musicTop: music.top,
      musicHeight: music.height,
      heroLeft: hero.left,
    } : null;
  });
  assert(toolbarAlignment !== null, "首页工具栏或 KV 定位信息缺失");
  assert(Math.abs(toolbarAlignment.fullscreenLeft - toolbarAlignment.heroLeft) <= 1, "全屏按钮左边缘未与 KV 左边缘对齐");
  assert(Math.abs(toolbarAlignment.fullscreenTop - toolbarAlignment.musicTop) <= 1, "全屏按钮未与音乐开关保持同一垂直位置");
  assert(Math.abs(toolbarAlignment.fullscreenHeight - toolbarAlignment.musicHeight) <= 1, "全屏按钮与音乐开关高度不一致");

  await fullscreenButton.click();
  const exitFullscreenButton = page.getByRole("button", { name: "退出全屏", exact: true });
  assert((await exitFullscreenButton.getAttribute("aria-pressed")) === "true", "首页全屏状态未同步");
  const fullscreenRequest = await page.evaluate(() => ({
    target: Reflect.get(window, "__arenaFullscreenTarget"),
    options: Reflect.get(window, "__arenaFullscreenOptions"),
  }));
  assert(fullscreenRequest.target === "documentElement", "首页全屏目标不是 documentElement");
  assert(fullscreenRequest.options?.navigationUI === "hide", "首页全屏没有请求隐藏浏览器界面");
  await exitFullscreenButton.click();
  assert((await fullscreenButton.getAttribute("aria-pressed")) === "false", "首页退出全屏状态未同步");

  const heroSize = await page.locator(".home-hero img").evaluate(image => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
  assert(heroSize.width > 0 && heroSize.height > 0, "首页主视觉加载失败");

  await musicButton.click();
  await page.waitForFunction(() => document.querySelector(".music-control")?.getAttribute("aria-pressed") === "true");
  await musicButton.click();
  assert((await musicButton.getAttribute("aria-pressed")) === "false", "音乐开关未能关闭");

  const replayHref = await page.getByRole("link", { name: "比赛回放", exact: true }).getAttribute("href");
  const replayUrl = new URL(replayHref, target);
  assert(replayUrl.pathname.endsWith("/release/replay.html") || replayUrl.pathname === "/replay.html", "首页 Replay 链接目标错误");
  const benchHref = await page.getByRole("link", { name: /Bench 分析/u }).getAttribute("href");
  const benchUrl = new URL(benchHref, target);
  assert(benchUrl.pathname.endsWith("/release/bench.html") || benchUrl.pathname === "/bench.html", "首页 Bench 链接目标错误");
  const rulesHref = await page.getByRole("link", { name: /玩法介绍/u }).getAttribute("href");
  const rulesUrl = new URL(rulesHref, target);
  assert(rulesUrl.pathname.endsWith("/release/rules.html") || rulesUrl.pathname === "/rules.html", "首页玩法介绍链接目标错误");

  mkdirSync(workRoot, { recursive: true });
  const screenshot = join(workRoot, `home-${mode}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });

  await page.goto(rulesUrl.href, { waitUntil: "networkidle" });
  assert((await page.title()).includes("玩法介绍"), "玩法介绍标题缺失");
  assert(await page.getByRole("heading", { name: "北京浮生记", exact: true }).isVisible(), "玩法介绍主标题不可见");
  assert(await page.getByText("大模型 40 天北漂生存挑战", { exact: true }).isVisible(), "玩法介绍副标题不可见");
  assert((await page.locator(".rules-slide").count()) === 7, "玩法介绍应包含倒霉事件图鉴与模型决策流程图");
  assert(await page.getByRole("heading", { name: "北京不会只坑你一次", exact: true }).isVisible(), "倒霉事件图鉴不可见");
  assert(await page.getByText("健康归零：当场出局", { exact: true }).isVisible(), "倒霉事件具体条目不可见");
  assert(await page.getByRole("table", { name: "五个模型共享的比赛条件" }).isVisible(), "玩法介绍比赛条件表格不可见");
  assert(await page.getByRole("link", { name: "进入比赛回放", exact: true }).isVisible(), "玩法介绍回放入口不可见");
  const rulesImages = await page.locator(".rules-slide img").evaluateAll(images => images.map(image => ({
    complete: image.complete,
    width: image.naturalWidth,
    height: image.naturalHeight,
  })));
  assert(rulesImages.length === 4, "玩法介绍图片数量不符合预期");
  assert(rulesImages.every(image => image.complete && image.width > 0 && image.height > 0), "玩法介绍存在加载失败的图片");
  const rulesScreenshot = join(workRoot, `rules-${mode}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: rulesScreenshot, fullPage: true });

  await page.goto(replayUrl.href, { waitUntil: "load" });
  assert(await page.locator(".arena-shell").isVisible(), "首页跳转目标不是可用 Replay 页面");
  assert(issues.length === 0, issues.join("\n"));
  await context.close();
  return {
    mode,
    viewport,
    status: "passed",
    screenshot: screenshot.replace(`${root}/`, ""),
    rulesScreenshot: rulesScreenshot.replace(`${root}/`, ""),
    checks: ["layout", "hero", "fullscreen-toggle", "toolbar-alignment", "rules-page", "rules-assets", "music-toggle", "replay-link", "bench-link", "no-runtime-errors"],
  };
}

async function main() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  assert(supportedNodeMajors.has(nodeMajor), `首页浏览器验收只支持 Node 22/24/26；当前为 ${process.version}`);
  assert(statSync(join(releaseRoot, "index.html")).isFile(), "请先运行 npm run build:home-release");

  const server = staticServer();
  let browser;
  const results = [];
  try {
    const baseUrl = await listen(server);
    browser = await chromium.launch({ headless: true });
    const fileUrl = pathToFileURL(join(releaseRoot, "index.html")).href;
    for (const viewport of viewports) {
      results.push(await verifyViewport(browser, fileUrl, viewport, "file"));
      results.push(await verifyViewport(browser, `${baseUrl}/`, viewport, "http"));
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolvePromise => server.close(resolvePromise));
  }

  const report = {
    artifactType: "arena-home-browser-acceptance-v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    toolchain: { node: process.version, chromium: browser?.version() ?? "closed" },
    results,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`首页浏览器验收通过：${results.length}/${results.length}（file:// 与 HTTP 双协议）\n`);
}

await main();
