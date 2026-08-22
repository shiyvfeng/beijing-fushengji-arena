import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, any>;

const technicalStatuses = new Set(["model_timeout", "tool_limit", "loop_terminated", "runtime_error"]);
const failureLabels: Record<string, string> = {
  timeout: "请求超时",
  total_wall_clock: "总墙钟耗尽",
  context_limit: "模型上下文超限",
  action_budget: "动作预算耗尽",
  invalid_action_loop: "连续无效动作",
  transport_error: "网络传输错误",
  http_error: "Provider HTTP 错误",
  invalid_response: "响应协议无效",
  invalid_action: "模型动作无效",
  refusal: "模型拒绝响应",
  incomplete: "响应未完成",
  driver_error: "驱动错误",
};
const subjectReplayPath = requiredEnvironment("ARENA_BROWSER_SUBJECT_REPLAY");
const subjectHtmlPath = requiredEnvironment("ARENA_BROWSER_SUBJECT_HTML");
const fixtureReplayPath = requiredEnvironment("ARENA_BROWSER_FIXTURE_REPLAY");
const fixtureHtmlPath = requiredEnvironment("ARENA_BROWSER_FIXTURE_HTML");
const missingReplayHtmlPath = requiredEnvironment("ARENA_BROWSER_MISSING_HTML");
const tamperedReplayHtmlPath = requiredEnvironment("ARENA_BROWSER_TAMPERED_HTML");
const subjectReplay = readReplay(subjectReplayPath);
const fixtureReplay = readReplay(fixtureReplayPath);

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

function readReplay(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8"));
}

function identity(agent: JsonObject): string {
  return `${agent.provider} + ${agent.model}`;
}

function cssDurationMilliseconds(value: string): number {
  if (value.endsWith("ms")) return Number.parseFloat(value);
  if (value.endsWith("s")) return Number.parseFloat(value) * 1_000;
  throw new Error(`无法解析 CSS 时长：${value}`);
}

function createRuntimeObserver(page: Page) {
  const remoteRequests: string[] = [];
  const webSockets: string[] = [];
  const consoleIssues: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", request => {
    const protocol = new URL(request.url()).protocol;
    if (!["file:", "data:", "blob:"].includes(protocol)) remoteRequests.push(request.url());
  });
  page.on("websocket", socket => webSockets.push(socket.url()));
  page.on("console", message => {
    if (["warning", "error"].includes(message.type())) consoleIssues.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  return {
    assertClean() {
      expect(remoteRequests, "页面不得发起 HTTP(S) 或其他远程请求").toEqual([]);
      expect(webSockets, "页面不得建立 WebSocket").toEqual([]);
      expect(consoleIssues, "控制台必须为 0 error / 0 warning").toEqual([]);
      expect(pageErrors, "页面不得产生未捕获异常").toEqual([]);
    },
  };
}

async function openReplay(page: Page, htmlPath: string) {
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
}

async function goToDay(page: Page, day: number, currentDay: number) {
  const input = page.getByRole("spinbutton", { name: "跳转日期" });
  await input.fill(String(day));
  const expected = day > currentDay ? `揭示至第 ${day} 天` : `跳转至第 ${day} 天`;
  await expect(page.getByRole("button", { name: expected })).toBeVisible();
  await input.press("Enter");
  await expect(page.getByText(new RegExp(`第 ${day}/40 天$`))).toBeVisible();
}

async function exportedFacts(page: Page): Promise<JsonObject> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前已揭示事实" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有生成导出文件");
  return JSON.parse(readFileSync(path, "utf8"));
}

async function verifyTechnicalDnfs(page: Page, replay: JsonObject, htmlPath: string): Promise<number> {
  const dnfAgents = replay.agents.filter((agent: JsonObject) => technicalStatuses.has(agent.status));
  for (const dnfAgent of dnfAgents) {
    const label = identity(dnfAgent);
    const exitDay = dnfAgent.finalResult.endDay;
    const category = dnfAgent.finalResult.technicalFailure?.category;
    const firstVisibleDay = Math.max(1, exitDay);
    await openReplay(page, htmlPath);
    if (firstVisibleDay > 1) await goToDay(page, firstVisibleDay, 1);

    const card = page.getByRole("button", { name: `查看 ${label} 详情` });
    await expect(card).toHaveClass(/dnf/);
    await expect(card).toContainText("DNF");
    if (exitDay < 40) await expect(card).toContainText(`第 ${exitDay} 天退出`);
    await card.click();
    const dialog = page.getByRole("dialog", { name: label });
    await expect(dialog).toContainText("技术 DNF");
    await expect(dialog).toContainText(`第 ${exitDay} 天退出`);
    if (category && failureLabels[category]) await expect(dialog).toContainText(failureLabels[category]);
    await dialog.getByRole("button", { name: "关闭" }).click();

    let currentDay = firstVisibleDay;
    if (exitDay < 40) {
      const firstPostExitDay = Math.max(1, exitDay + 1);
      if (firstPostExitDay > currentDay) await goToDay(page, firstPostExitDay, currentDay);
      currentDay = firstPostExitDay;
      await expect(page.getByRole("region", { name: `${label} 当日动作` })).toContainText(
        `已于第 ${exitDay} 天退出，无后续动作。`,
      );
    }
    if (currentDay < 40) await goToDay(page, 40, currentDay);
    const finalRow = page.getByRole("table", { name: "正式排名" }).getByRole("row").filter({ hasText: label });
    await expect(finalRow).toContainText("DNF");
  }
  return dnfAgents.length;
}

test("五模型事实页面只显示 Replay 身份与可核对 hash", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, subjectHtmlPath);

  await expect(page.locator(".agent-card")).toHaveCount(5);
  const identities = subjectReplay.agents.map(identity);
  expect(new Set(identities).size).toBe(5);
  const displayedIdentities = await page.locator(".agent-identity b").allTextContents();
  expect(displayedIdentities.toSorted()).toEqual(identities.toSorted());
  for (const label of identities) {
    await expect(page.getByRole("button", { name: `查看 ${label} 详情`, exact: true })).toHaveCount(1);
  }
  await expect(page.locator("#arena-replay-data")).toHaveCount(0);
  await expect(page.locator("[data-replay-hash-marker] code")).toHaveText(subjectReplay.replayHash);
  await expect(page.locator("footer code")).toHaveText(subjectReplay.factHash);
  await expect(page.locator("body")).not.toContainText("competitor-");
  await expect(page.locator("body")).not.toContainText("Scripted 金样");
  await expect(page.locator("body")).not.toContainText("最幸运");
  await expect(page.locator("body")).not.toContainText("最倒霉");
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/槽位\s*[A-E]\b/u);
  expect(bodyText).not.toContain("persona");
  expect(bodyText).not.toContain("模拟内容");
  runtime.assertClean();
});

test("Day 1 与 Day 39 的页面、弹窗、ARIA 和导出均保持防剧透", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, subjectHtmlPath);

  await expect(page.locator(".match-meta")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByRole("slider", { name: "回放日期" })).toHaveAttribute("aria-valuetext", "第 1 天");
  await expect(page.getByRole("img", { name: "第 1 天到第 1 天净资产轨迹" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "第 40 天统一结算" })).toHaveCount(0);
  const firstLabel = identity(subjectReplay.agents[0]);
  await page.getByRole("button", { name: `查看 ${firstLabel} 详情` }).click();
  const dayOneDialog = page.getByRole("dialog", { name: firstLabel });
  await expect(dayOneDialog).toContainText("数据截至第 1 天");
  await expect(dayOneDialog.getByText("第 40 天", { exact: true })).toHaveCount(0);
  await dayOneDialog.getByRole("button", { name: "关闭" }).click();

  const dayOneExport = await exportedFacts(page);
  expect(dayOneExport.visibleThroughDay).toBe(1);
  expect(dayOneExport.days).toHaveLength(1);
  expect(dayOneExport.finalResults).toBeUndefined();
  expect(dayOneExport.personalRandomEventAudit).toBeUndefined();
  expect(JSON.stringify(dayOneExport)).not.toContain("competitor-");

  await goToDay(page, 39, 1);
  await expect(page.getByRole("slider", { name: "回放日期" })).toHaveAttribute("aria-valuetext", "第 39 天");
  await expect(page.getByRole("img", { name: "第 1 天到第 39 天净资产轨迹" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "第 40 天统一结算" })).toHaveCount(0);
  await page.getByRole("button", { name: `查看 ${firstLabel} 详情` }).click();
  const dayThirtyNineDialog = page.getByRole("dialog", { name: firstLabel });
  await expect(dayThirtyNineDialog).toContainText("数据截至第 39 天");
  await expect(dayThirtyNineDialog.getByText("第 40 天", { exact: true })).toHaveCount(0);
  await dayThirtyNineDialog.getByRole("button", { name: "关闭" }).click();

  const dayThirtyNineExport = await exportedFacts(page);
  expect(dayThirtyNineExport.visibleThroughDay).toBe(39);
  expect(dayThirtyNineExport.days).toHaveLength(39);
  expect(dayThirtyNineExport.days.some((day: JsonObject) => day.day === 40)).toBe(false);
  expect(dayThirtyNineExport.finalResults).toBeUndefined();
  expect(dayThirtyNineExport.personalRandomEventAudit).toBeUndefined();
  runtime.assertClean();
});

test("Day 40 正式排名与核心 finalRanking 一致且只陈列随机事件原始计数", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, subjectHtmlPath);
  await goToDay(page, 40, 1);

  await expect(page.getByRole("heading", { name: "第 40 天统一结算" })).toBeVisible();
  await expect(page.getByRole("table", { name: "正式排名" }).getByRole("row")).toHaveCount(5);
  const ranking = new Map(subjectReplay.finalRanking.map((entry: JsonObject) => [entry.agentId, entry.rank]));
  for (const agent of subjectReplay.agents) {
    const row = page.getByRole("table", { name: "正式排名" }).getByRole("row").filter({ hasText: identity(agent) });
    await expect(row).toHaveCount(1);
    if (ranking.has(agent.id)) await expect(row).toContainText(`#${ranking.get(agent.id)}`);
    else await expect(row).toContainText("DNF");
  }
  await expect(page.getByText("个人随机事件原始计数", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("最幸运");
  await expect(page.locator("body")).not.toContainText("最倒霉");
  const dayFortyExport = await exportedFacts(page);
  expect(dayFortyExport.visibleThroughDay).toBe(40);
  expect(dayFortyExport.days).toHaveLength(40);
  expect(dayFortyExport.finalResults).toHaveLength(5);
  expect(dayFortyExport.personalRandomEventAudit.agents).toHaveLength(5);
  runtime.assertClean();
});

test("固定 Fixture 覆盖技术 DNF、退出占位、后续无动作和终局无名次", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  expect(await verifyTechnicalDnfs(page, fixtureReplay, fixtureHtmlPath)).toBeGreaterThan(0);
  if (subjectReplayPath !== fixtureReplayPath) {
    await verifyTechnicalDnfs(page, subjectReplay, subjectHtmlPath);
  }
  runtime.assertClean();
});

test("缺失 Replay 与篡改 Replay 都失败关闭且不存在 fallback", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  for (const [path, message] of [
    [missingReplayHtmlPath, "正式页面缺少 Replay 数据"],
    [tamperedReplayHtmlPath, "完整性校验失败"],
  ] as const) {
    await openReplay(page, path);
    await expect(page.getByRole("heading", { name: "正式回放已停止展示" })).toBeVisible();
    await expect(page.locator(".load-error")).toContainText(message);
    await expect(page.locator(".arena-shell")).toHaveCount(0);
    await expect(page.locator(".agent-card")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("sampleReplay");
  }
  runtime.assertClean();
});

test("单文件 Replay 在离线 BrowserContext 中完成交互且无远程请求", async ({ page, context }) => {
  const runtime = createRuntimeObserver(page);
  await context.setOffline(true);
  await openReplay(page, subjectHtmlPath);
  await expect(page.getByRole("heading", { name: subjectReplay.metadata.title })).toBeVisible();
  await goToDay(page, 40, 1);
  await page.getByRole("button", { name: `查看 ${identity(subjectReplay.agents[0])} 详情` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const exported = await exportedFacts(page);
  expect(exported.visibleThroughDay).toBe(40);
  runtime.assertClean();
});

test("键盘、焦点、reduced-motion 与双视口布局满足主要可访问性路径", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReplay(page, subjectHtmlPath);

  const slider = page.getByRole("slider", { name: "回放日期" });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "第 2 天");
  await slider.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuetext", "第 1 天");

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/第 2\/40 天$/)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText(/第 1\/40 天$/)).toBeVisible();

  const trigger = page.getByRole("button", { name: `查看 ${identity(subjectReplay.agents[0])} 详情` });
  await trigger.focus();
  await trigger.press("Enter");
  const close = page.getByRole("dialog").getByRole("button", { name: "关闭" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await close.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  await page.locator(".modal-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const motion = await page.locator("button").first().evaluate(element => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  });
  expect(cssDurationMilliseconds(motion.animationDuration)).toBeLessThanOrEqual(0.01);
  expect(cssDurationMilliseconds(motion.transitionDuration)).toBe(0);
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    cardWidths: [...document.querySelectorAll<HTMLElement>(".agent-card")].map(card => card.getBoundingClientRect().width),
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.cardWidths).toHaveLength(5);
  expect(layout.cardWidths.every(width => width > 0 && width <= layout.clientWidth)).toBe(true);
  runtime.assertClean();
});
