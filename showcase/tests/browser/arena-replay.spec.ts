import { expect, test, type Locator, type Page } from "@playwright/test";
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
const assistedFixtureReplayPath = requiredEnvironment("ARENA_BROWSER_ASSISTED_FIXTURE_REPLAY");
const assistedFixtureHtmlPath = requiredEnvironment("ARENA_BROWSER_ASSISTED_FIXTURE_HTML");
const missingReplayHtmlPath = requiredEnvironment("ARENA_BROWSER_MISSING_HTML");
const tamperedReplayHtmlPath = requiredEnvironment("ARENA_BROWSER_TAMPERED_HTML");
const badEnrichmentHtmlPath = requiredEnvironment("ARENA_BROWSER_BAD_ENRICHMENT_HTML");
const subjectReplay = readReplay(subjectReplayPath);
const enrichmentMatch = readFileSync(subjectHtmlPath, "utf8").match(/<script\b[^>]*id="arena-replay-enrichment-data"[^>]*>([\s\S]*?)<\/script>/u);
const isCuratedSubject = enrichmentMatch !== null && JSON.parse(enrichmentMatch[1]).generator?.id === "curated-highlights";
const fixtureReplay = readReplay(fixtureReplayPath);
const assistedFixtureReplay = readReplay(assistedFixtureReplayPath);
const panelHeadings = ["今日物价", "公共事件", "实时排名", "比赛时间线", "净资产曲线", "今日动作"] as const;

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

async function openReplayWithoutEnrichment(page: Page) {
  const source = readFileSync(fixtureHtmlPath, "utf8");
  const html = source.replace(
    /<script type="application\/json" id="arena-replay-enrichment-data">[\s\S]*?<\/script>/u,
    "",
  );
  expect(html, "缺失 Enrichment 场景必须实际移除内嵌 artifact").not.toBe(source);
  await page.setContent(html, { waitUntil: "load" });
  await expect(page.locator(".arena-shell")).toBeVisible();
}

function panelByHeading(page: Page, name: typeof panelHeadings[number]): Locator {
  return page.getByRole("heading", { name, exact: true }).locator("xpath=ancestor::section[1]");
}

async function expectCurrentDay(page: Page, day: number) {
  const slider = page.getByRole("slider", { name: "回放日期", exact: true });
  await expect(slider).toHaveValue(String(day));
  await expect(slider).toHaveAttribute("aria-valuetext", `第 ${day} 天`);
  await expect(page.getByText(new RegExp(`第\\s*${day}\\s*\\/\\s*40\\s*天$`, "u")).first()).toBeVisible();
}

async function goToDay(page: Page, day: number) {
  const input = page.getByRole("spinbutton", { name: "跳转到第几天", exact: true });
  await input.fill(String(day));
  await page.getByRole("button", { name: "跳转", exact: true }).click();
  await expectCurrentDay(page, day);
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
    if (firstVisibleDay > 1) await goToDay(page, firstVisibleDay);

    const trigger = page.getByRole("button", { name: `查看 ${label} 详情` });
    const card = page.locator(".agent-card").filter({ hasText: label });
    await expect(trigger).toHaveCount(1);
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/dnf/);
    await expect(card).toContainText("DNF");
    if (exitDay < 40) await expect(card).toContainText(`第 ${exitDay} 天退出`);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: label });
    await expect(dialog).toContainText("技术 DNF");
    await expect(dialog).toContainText(`第 ${exitDay} 天退出`);
    if (category && failureLabels[category]) await expect(dialog).toContainText(failureLabels[category]);
    await dialog.getByRole("button", { name: "关闭" }).click();

    let currentDay = firstVisibleDay;
    if (exitDay < 40) {
      const firstPostExitDay = Math.max(1, exitDay + 1);
      if (firstPostExitDay > currentDay) await goToDay(page, firstPostExitDay);
      currentDay = firstPostExitDay;
      await expect(panelByHeading(page, "今日动作").locator("details").filter({ hasText: label })).toContainText(
        `已于第 ${exitDay} 天退出，无后续动作。`,
      );
    }
    if (currentDay < 40) await goToDay(page, 40);
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
  await expect(page.locator("[data-fact-layer-hash-marker] code")).toHaveText(subjectReplay.factHash);
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

test("中央舞台使用六帧循环条带，右侧排名只使用静态头部头像", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, fixtureHtmlPath);

  const stageCharacters = page.locator(".stage-character--idle");
  await expect(stageCharacters).toHaveCount(5);
  expect((await stageCharacters.evaluateAll(elements => elements.map(element => element.getAttribute("data-asset-id")))).toSorted()).toEqual([
    "model.pet.stage.anthropic.idle",
    "model.pet.stage.deepseek.idle",
    "model.pet.stage.gpt-5.6-sol.idle",
    "model.pet.stage.kimi.idle",
    "model.pet.stage.qwen.idle",
  ]);
  const stageImages = await stageCharacters.locator("img").evaluateAll(images => images.map(image => {
    const element = image as HTMLImageElement;
    const style = getComputedStyle(element);
    return {
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      animationDelay: style.animationDelay,
      animationTimingFunction: style.animationTimingFunction,
      animationIterationCount: style.animationIterationCount,
      backfaceVisibility: style.backfaceVisibility,
      filter: style.filter,
      willChange: style.willChange,
    };
  }));
  expect(stageImages).toHaveLength(5);
  for (const image of stageImages) {
    expect([image.naturalWidth, image.naturalHeight]).toEqual([1_536, 256]);
    expect(image.animationName).toBe("stage-character-idle");
    expect(cssDurationMilliseconds(image.animationDuration)).toBe(1_100);
    expect(image.animationTimingFunction).toBe("steps(1)");
    expect(image.animationIterationCount).toBe("infinite");
    expect(image.backfaceVisibility).toBe("hidden");
    expect(image.filter).toBe("none");
    expect(image.willChange).toBe("transform");
  }
  expect(new Set(stageImages.map(image => image.animationDelay))).toEqual(new Set([
    "0s", "-0.22s", "-0.44s", "-0.66s", "-0.88s",
  ]));
  const stageFilters = await stageCharacters.evaluateAll(elements => elements.map(element => getComputedStyle(element).filter));
  expect(stageFilters.every(filter => filter.includes("drop-shadow"))).toBe(true);

  const avatars = page.locator(".agent-avatar");
  await expect(avatars).toHaveCount(5);
  expect((await avatars.evaluateAll(elements => elements.map(element => element.getAttribute("data-asset-id")))).toSorted()).toEqual([
    "model.avatar.anthropic",
    "model.avatar.deepseek",
    "model.avatar.gpt-5.6-sol",
    "model.avatar.qwen",
    "model.pet.kimi",
  ]);
  const avatarImages = await avatars.locator("img").evaluateAll(images => images.map(image => {
    const element = image as HTMLImageElement;
    return [element.naturalWidth, element.naturalHeight];
  }));
  expect(avatarImages.filter(([width, height]) => width === 512 && height === 512)).toHaveLength(4);
  expect(avatarImages.filter(([width, height]) => width === 1_024 && height === 1_024)).toHaveLength(1);
  runtime.assertClean();
});

test("Day 1 与 Day 39 的页面、弹窗、ARIA 和导出均保持防剧透", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, subjectHtmlPath);

  for (const heading of panelHeadings) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toContainText(/第\s*1\s*\/\s*40\s*天/u);
  await expectCurrentDay(page, 1);
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

  await goToDay(page, 39);
  await expectCurrentDay(page, 39);
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

test("固定 Fixture 的无事件日使用等高公园占位图，Day 2 呈现共享事实且前后可往返", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, fixtureHtmlPath);

  const events = panelByHeading(page, "公共事件");
  await expect(events).toContainText("本日没有新增公共事件");
  const eventArt = events.locator(".event-art");
  await expect(eventArt).toHaveAttribute("data-asset-id", "event.calm-park");
  await expect(eventArt.getByRole("img", { name: /风和日丽的北京社区公园/u })).toBeVisible();
  const emptyArtBox = await eventArt.boundingBox();
  expect(emptyArtBox).not.toBeNull();
  await page.getByRole("button", { name: "后一天", exact: true }).click();
  await expectCurrentDay(page, 2);
  await expect(events).toContainText("全场公开价格波动");
  await expect(events).not.toContainText("本日没有新增公共事件");
  await expect(eventArt).toHaveAttribute("data-asset-id", "event.market.volatility");
  const eventArtBox = await eventArt.boundingBox();
  expect(eventArtBox).not.toBeNull();
  expect(Math.abs(eventArtBox!.height - emptyArtBox!.height)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "前一天", exact: true }).click();
  await expectCurrentDay(page, 1);
  await expect(eventArt).toHaveAttribute("data-asset-id", "event.calm-park");
  runtime.assertClean();
});

test("Day 40 正式排名与核心 finalRanking 一致且只陈列随机事件原始计数", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, subjectHtmlPath);
  await goToDay(page, 40);

  await expectCurrentDay(page, 40);
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

test("Completion-Assisted Fixture 显示辅助事实且只在终局揭示可靠性评分卡", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, assistedFixtureHtmlPath);

  await expect(page.getByText("五模型 · Completion-Assisted 事实层", { exact: true })).toBeVisible();
  const assistedAction = panelByHeading(page, "今日动作").locator("li.assisted");
  await expect(assistedAction).toHaveCount(1);
  await expect(assistedAction).toContainText("Runner 辅助原地过日");
  await expect(assistedAction).toContainText("瞬态故障重试耗尽");
  await expect(page.getByRole("region", { name: "可靠性评分卡" })).toHaveCount(0);
  await expect(page.getByRole("contentinfo", { name: "回放审计区" })).toContainText("终局揭示可靠性评分卡");
  const dayOneExport = await exportedFacts(page);
  expect(dayOneExport.reliabilityAudit).toBeUndefined();

  await goToDay(page, 39);
  const dayThirtyNineExport = await exportedFacts(page);
  expect(dayThirtyNineExport.reliabilityAudit).toBeUndefined();

  await goToDay(page, 40);
  const footer = page.getByRole("contentinfo", { name: "回放审计区" });
  await expect(footer).toContainText("自主 171 天 · 辅助 1 天 · 重试 2 次");
  const firstLabel = identity(assistedFixtureReplay.agents[0]);
  await page.getByRole("button", { name: `查看 ${firstLabel} 详情` }).click();
  const scorecard = page.getByRole("region", { name: "可靠性评分卡" });
  await expect(scorecard).toBeVisible();
  await expect(scorecard).toContainText("39/40 天");
  await expect(scorecard).toContainText("2 / 1");
  await page.keyboard.press("Escape");

  const dayFortyExport = await exportedFacts(page);
  expect(dayFortyExport.reliabilityAudit.agents).toHaveLength(5);
  expect(dayFortyExport.reliabilityAudit.agents[0].participant).toBe(firstLabel);
  expect(JSON.stringify(dayFortyExport.reliabilityAudit)).not.toContain("competitor-");
  runtime.assertClean();
});

test("固定 Fixture 在 Day 12 呈现技术 DNF、后续无动作和终局无名次", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  const technicalDnfs = fixtureReplay.agents.filter((agent: JsonObject) => technicalStatuses.has(agent.status));
  expect(technicalDnfs).toHaveLength(1);
  expect(technicalDnfs[0].finalResult.endDay).toBe(12);
  expect(await verifyTechnicalDnfs(page, fixtureReplay, fixtureHtmlPath)).toBe(1);
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
  const pageHeading = subjectReplay.matchId === "arena-completion-assisted-v1-prompt-v2-run-001-attempt-003"
    ? "北京浮生记：AI 发财生存赛"
    : subjectReplay.metadata.title;
  await expect(page.getByRole("heading", { name: pageHeading, exact: true })).toBeVisible();
  await goToDay(page, 40);
  await page.getByRole("button", { name: `查看 ${identity(subjectReplay.agents[0])} 详情` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const exported = await exportedFacts(page);
  expect(exported.visibleThroughDay).toBe(40);
  runtime.assertClean();
});

test("播放、前后日、唯一日期滑杆、跳日与方向键走通同一日期状态", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, fixtureHtmlPath);

  const previous = page.getByRole("button", { name: "前一天", exact: true });
  const next = page.getByRole("button", { name: "后一天", exact: true });
  const play = page.getByRole("button", { name: "播放回放", exact: true });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await play.click();
  await expect(page.getByRole("button", { name: "暂停回放", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "暂停回放", exact: true }).click();
  await expect(play).toHaveAttribute("aria-pressed", "false");

  await next.click();
  await expectCurrentDay(page, 2);
  await previous.click();
  await expectCurrentDay(page, 1);

  const slider = page.getByRole("slider", { name: "回放日期", exact: true });
  await expect(page.getByRole("slider")).toHaveCount(1);
  await expect(page.locator('input[type="range"]')).toHaveCount(1);
  await slider.focus();
  await slider.press("ArrowRight");
  await expectCurrentDay(page, 2);
  await slider.press("ArrowLeft");
  await expectCurrentDay(page, 1);

  const jump = page.getByRole("spinbutton", { name: "跳转到第几天", exact: true });
  await expect(page.getByRole("button", { name: "跳转", exact: true })).toBeVisible();
  await jump.fill("12");
  await jump.press("Enter");
  await expectCurrentDay(page, 12);

  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press("ArrowRight");
  await expectCurrentDay(page, 13);
  await page.keyboard.press("ArrowLeft");
  await expectCurrentDay(page, 12);
  runtime.assertClean();
});

test("全屏按钮请求隐藏浏览器界面并可再次点击退出", async ({ page }) => {
  await page.addInitScript(() => {
    let fullscreenTarget: Element | null = null;
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
      value: async function requestFullscreen(options?: FullscreenOptions) {
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
  const runtime = createRuntimeObserver(page);
  await openReplay(page, fixtureHtmlPath);

  const enter = page.getByRole("button", { name: "进入全屏", exact: true });
  await expect(enter).toBeEnabled();
  await expect(enter).toHaveAttribute("aria-pressed", "false");
  await enter.click();

  const exit = page.getByRole("button", { name: "退出全屏", exact: true });
  await expect(exit).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => ({
    target: Reflect.get(window, "__arenaFullscreenTarget"),
    options: Reflect.get(window, "__arenaFullscreenOptions"),
  }))).toEqual({ target: "documentElement", options: { navigationUI: "hide" } });

  await exit.click();
  await expect(enter).toHaveAttribute("aria-pressed", "false");
  runtime.assertClean();
});

test("今日动作使用五组 details，摘要可用键盘展开并显示事实动作", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, fixtureHtmlPath);

  const details = panelByHeading(page, "今日动作").locator("details");
  await expect(details).toHaveCount(5);
  const first = details.first();
  const summary = first.locator("summary");
  await expect(summary).toBeVisible();
  if (await first.evaluate(element => (element as HTMLDetailsElement).open)) await summary.click();
  expect(await first.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
  await summary.focus();
  await summary.press("Enter");
  expect(await first.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true);
  await expect(first.locator("li").first()).toBeVisible();
  runtime.assertClean();
});

test("排名详情弹窗支持焦点圈、Escape 关闭并把焦点归还触发器", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReplay(page, subjectHtmlPath);

  const trigger = page.getByRole("button", { name: `查看 ${identity(subjectReplay.agents[0])} 详情` });
  await trigger.focus();
  await trigger.press("Enter");
  const close = page.getByRole("dialog").getByRole("button", { name: "关闭" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const motion = await page.locator("button").first().evaluate(element => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  });
  expect(cssDurationMilliseconds(motion.animationDuration)).toBeLessThanOrEqual(0.01);
  expect(cssDurationMilliseconds(motion.transitionDuration)).toBe(0);
  const reducedStageMotion = await page.locator(".stage-character--idle img").first().evaluate(element => {
    const style = getComputedStyle(element);
    return { animationName: style.animationName, transform: style.transform };
  });
  expect(reducedStageMotion.animationName).toBe("none");
  expect(reducedStageMotion.transform).toBe("matrix(1, 0, 0, 1, 0, 0)");
  runtime.assertClean();
});

test("1366×768 与 1920×1080 均保持左中右三栏、无水平溢出且关键字可读", async ({ page }, testInfo) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, fixtureHtmlPath);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect([[1366, 768], [1920, 1080]]).toContainEqual([viewport!.width, viewport!.height]);
  expect(testInfo.project.name).toMatch(/^chromium-(?:1366x768|1920x1080)$/u);

  const stage = page.getByRole("heading", { name: "五模型同场", exact: true }).locator("xpath=ancestor::section[1]");
  const columns = {
    left: [panelByHeading(page, "今日物价"), panelByHeading(page, "公共事件")],
    center: [stage, panelByHeading(page, "比赛时间线"), panelByHeading(page, "净资产曲线")],
    right: [panelByHeading(page, "实时排名"), panelByHeading(page, "今日动作")],
  };
  const boxes: Record<string, { x: number; y: number; width: number; height: number } | null> = {};
  for (const [column, panels] of Object.entries(columns)) {
    for (const [index, panel] of panels.entries()) {
      await expect(panel).toBeVisible();
      boxes[`${column}-${index}`] = await panel.boundingBox();
      expect(boxes[`${column}-${index}`], `${column} 第 ${index + 1} 个面板必须有几何尺寸`).not.toBeNull();
    }
  }

  const left = boxes["left-0"]!;
  const center = boxes["center-0"]!;
  const right = boxes["right-0"]!;
  expect(Math.abs(boxes["left-1"]!.x - left.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(boxes["center-1"]!.x - center.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(boxes["center-2"]!.x - center.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(boxes["right-1"]!.x - right.x)).toBeLessThanOrEqual(3);
  expect(left.x + left.width).toBeLessThan(center.x);
  expect(center.x + center.width).toBeLessThan(right.x);
  expect(center.width).toBeGreaterThan(left.width);
  expect(center.width).toBeGreaterThan(right.width);
  expect(Math.abs(left.y - center.y)).toBeLessThanOrEqual(3);
  expect(Math.abs(center.y - right.y)).toBeLessThanOrEqual(3);

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    directChildrenOutsideViewport: [...document.querySelectorAll<HTMLElement>(".replay-grid > *")]
      .map(element => ({ className: element.className, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.left < -1 || box.right > document.documentElement.clientWidth + 1)
      .map(({ className }) => className),
  }));
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(overflow.directChildrenOutsideViewport).toEqual([]);

  for (const heading of panelHeadings) {
    const locator = page.getByRole("heading", { name: heading, exact: true });
    const size = await locator.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(size, `${heading} 字号`).toBeGreaterThanOrEqual(16);
  }
  for (const locator of [
    page.getByRole("button", { name: "前一天", exact: true }),
    page.getByRole("button", { name: "播放回放", exact: true }),
    page.getByRole("button", { name: "后一天", exact: true }),
    page.getByRole("button", { name: "背景音乐开关", exact: true }),
    page.getByRole("button", { name: "跳转", exact: true }),
  ]) {
    const size = await locator.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(size, "关键控件字号").toBeGreaterThanOrEqual(12);
  }
  runtime.assertClean();
});

test("自动回放在 featured 高光暂停，关闭后不自启，再次播放并在 Day 40 停止", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, fixtureHtmlPath);

  const play = page.getByRole("button", { name: "播放回放", exact: true });
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".highlight-list button")).toHaveCount(0);
  await play.click();
  await expect(page.getByRole("button", { name: "暂停回放", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expectCurrentDay(page, 2);

  const highlight = page.getByRole("dialog", { name: "公共市场事件" });
  await expect(highlight).toBeVisible();
  const close = highlight.getByRole("button", { name: "关闭高光" });
  await expect(close).toBeFocused();
  await close.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(play).toBeFocused();
  await page.waitForTimeout(1_700);
  await expectCurrentDay(page, 2);

  await play.click();
  await expectCurrentDay(page, 3);
  await page.getByRole("button", { name: "暂停回放", exact: true }).click();
  await goToDay(page, 39);
  await page.getByRole("button", { name: "播放回放", exact: true }).click();
  await expectCurrentDay(page, 40);
  await expect(page.getByRole("button", { name: "播放回放", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "播放回放", exact: true })).toHaveAttribute("aria-pressed", "false");
  runtime.assertClean();
});

test("背景音乐不自播且与日期播放独立", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function pause() {};
  });
  await openReplay(page, fixtureHtmlPath);
  const audio = page.locator("audio:not([data-highlight-voice])");
  await expect(audio).not.toHaveAttribute("autoplay", "");
  expect(await audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
  const music = page.getByRole("button", { name: "背景音乐开关", exact: true });
  await expect(music).toHaveAttribute("aria-pressed", "false");
  await music.click();
  await expect(music).toHaveAttribute("aria-pressed", "true");
  await expectCurrentDay(page, 1);
  await expect(page.getByRole("button", { name: "播放回放", exact: true })).toHaveAttribute("aria-pressed", "false");
  await music.click();
  await expect(music).toHaveAttribute("aria-pressed", "false");
  runtime.assertClean();
});

test("Enrichment 成功、缺失与错误均可区分，缺失或错误只降级高光层", async ({ page }) => {
  const runtime = createRuntimeObserver(page);

  await openReplay(page, fixtureHtmlPath);
  await expect(page.locator(".enrichment-state--ready")).toContainText("hash 已核验");
  await goToDay(page, 2);
  expect(await page.locator(".highlight-list button").count()).toBeGreaterThan(0);
  await expect(page.locator("#arena-replay-enrichment-data")).toHaveCount(0);

  await openReplayWithoutEnrichment(page);
  await expect(page.locator(".enrichment-state--missing")).toContainText("未提供程序高光");
  await expect(page.locator(".agent-card")).toHaveCount(5);
  await expect(page.locator(".highlight-list button")).toHaveCount(0);
  await goToDay(page, 2);
  await expect(panelByHeading(page, "公共事件")).toContainText("全场公开价格波动");
  await expect(page.locator("#arena-replay-enrichment-data")).toHaveCount(0);

  await openReplay(page, badEnrichmentHtmlPath);
  await expect(page.locator(".enrichment-state--error")).toContainText("sourceFactHash");
  await expect(page.locator(".agent-card")).toHaveCount(5);
  await expect(page.locator(".highlight-list button")).toHaveCount(0);
  await goToDay(page, 2);
  await expect(panelByHeading(page, "公共事件")).toContainText("全场公开价格波动");
  await expect(page.locator("#arena-replay-enrichment-data")).toHaveCount(0);
  runtime.assertClean();
});

test("Gold1 只展示五条人工精选高光且每条加载独立 3:2 新素材", async ({ page }) => {
  test.skip(!isCuratedSubject, "仅适用于 Gold1 人工精选发布包");
  const runtime = createRuntimeObserver(page);
  await openReplay(page, subjectHtmlPath);
  const state = page.locator(".enrichment-state--ready");
  await expect(state).toContainText("精选高光");
  await expect(state).toContainText("5 条");
  await expect(state).toContainText("人工白名单");

  const expected = [
    { day: 21, title: "Qwen 逆袭登顶", assetId: "highlight.gold1.qwen-comeback" },
    { day: 24, title: "获赠假酒，现场变现还债", assetId: "highlight.gold1.altman-gift" },
    { day: 32, title: "梭哈假白酒，反超登顶", assetId: "highlight.gold1.deepseek-gamble" },
    { day: 36, title: "Claude 遗憾退场", assetId: "highlight.gold1.dario-exit" },
    { day: 40, title: "终局揭晓", assetId: "highlight.gold1.podium" },
  ];
  const sources = new Set<string>();
  for (const item of expected) {
    await goToDay(page, item.day);
    await page.locator(".highlight-list button").filter({ hasText: item.title }).click();
    const dialog = page.getByRole("dialog", { name: item.title, exact: true });
    const slot = dialog.locator(".highlight-art");
    await expect(slot).toHaveAttribute("data-asset-id", item.assetId);
    const image = slot.locator("img");
    await expect(image).toBeVisible();
    expect(await image.evaluate(element => [element.naturalWidth, element.naturalHeight])).toEqual([1_536, 1_024]);
    sources.add((await image.getAttribute("src")) ?? "");
    await dialog.getByRole("button", { name: "关闭高光" }).click();
  }
  expect(sources.size).toBe(5);
  expect(sources.has("")).toBe(false);
  runtime.assertClean();
});

test("仅 Gold1 回放页提供返回首页按钮", async ({ page }) => {
  const runtime = createRuntimeObserver(page);
  await openReplay(page, subjectHtmlPath);
  const homeLink = page.getByRole("link", { name: "返回首页", exact: true });
  const matchMeta = page.locator(".match-meta");
  if (subjectReplay.matchId === "arena-completion-assisted-v1-prompt-v2-run-001-attempt-003") {
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute("href", "./index.html");
    await expect(matchMeta).toHaveCount(0);
    expect((await page.locator(".topbar").boundingBox())?.height).toBeLessThanOrEqual(90);
  } else {
    await expect(homeLink).toHaveCount(0);
    await expect(matchMeta).toContainText(subjectReplay.matchId);
    await expect(matchMeta).toContainText(`seed ${subjectReplay.seed}`);
  }
  runtime.assertClean();
});

test("Gold1 仅梭哈、离场和最终获胜三个高光播放对应内联配音", async ({ page }) => {
  test.skip(!isCuratedSubject, "仅适用于 Gold1 人工精选发布包");
  await page.addInitScript(() => {
    (window as unknown as { __highlightVoicePlays: string[] }).__highlightVoicePlays = [];
    HTMLMediaElement.prototype.play = function play() {
      if (this.dataset.highlightVoice === "true") {
        (window as unknown as { __highlightVoicePlays: string[] }).__highlightVoicePlays.push(
          this.dataset.audioAssetId ?? "missing-audio-id",
        );
      }
      return Promise.resolve();
    };
  });
  const runtime = createRuntimeObserver(page);
  await openReplay(page, subjectHtmlPath);
  const voice = page.locator("audio[data-highlight-voice='true']");
  const expected = [
    { day: 21, title: "Qwen 逆袭登顶", audioId: null },
    { day: 24, title: "获赠假酒，现场变现还债", audioId: null },
    { day: 32, title: "梭哈假白酒，反超登顶", audioId: "highlight.gold1.voice.deepseek-gamble" },
    { day: 36, title: "Claude 遗憾退场", audioId: "highlight.gold1.voice.dario-exit" },
    { day: 40, title: "终局揭晓", audioId: "highlight.gold1.voice.final-victory" },
  ];
  const played: string[] = [];
  for (const item of expected) {
    await goToDay(page, item.day);
    await page.locator(".highlight-list button").filter({ hasText: item.title }).click();
    const dialog = page.getByRole("dialog", { name: item.title, exact: true });
    await expect(dialog).toBeVisible();
    if (item.audioId) {
      played.push(item.audioId);
      await expect(voice).toHaveAttribute("data-audio-asset-id", item.audioId);
      await expect(voice).toHaveAttribute("src", /^data:audio\/wav;base64,/u);
    } else {
      await expect(voice).not.toHaveAttribute("data-audio-asset-id");
    }
    expect(await page.evaluate(() => (
      window as unknown as { __highlightVoicePlays: string[] }
    ).__highlightVoicePlays)).toEqual(played);
    await dialog.getByRole("button", { name: "关闭高光" }).click();
    await expect(voice).not.toHaveAttribute("data-audio-asset-id");
  }
  runtime.assertClean();
});

test("Gold1 每个首要公共事件按 catalog ID 加载对应像素素材", async ({ page }) => {
  test.skip(!isCuratedSubject, "仅适用于 Gold1 人工精选发布包");
  const runtime = createRuntimeObserver(page);
  await openReplay(page, subjectHtmlPath);
  const expected = [
    { day: 2, assetId: "event.gold1.market-07" },
    { day: 6, assetId: "event.gold1.market-14" },
    { day: 8, assetId: "event.gold1.market-05" },
    { day: 12, assetId: "event.gold1.market-13" },
    { day: 14, assetId: "event.gold1.market-01" },
    { day: 18, assetId: "event.gold1.market-06" },
    { day: 20, assetId: "event.gold1.market-12" },
    { day: 21, assetId: "event.gold1.market-04" },
    { day: 28, assetId: "event.gold1.market-10" },
    { day: 32, assetId: "event.gold1.market-08" },
  ];
  const sources = new Set<string>();
  for (const item of expected) {
    await goToDay(page, item.day);
    const slot = panelByHeading(page, "公共事件").locator(".event-art");
    await expect(slot).toHaveAttribute("data-asset-id", item.assetId);
    const image = slot.locator("img");
    await expect(image).toBeVisible();
    expect(await image.evaluate(element => [element.naturalWidth, element.naturalHeight])).toEqual([768, 512]);
    sources.add((await image.getAttribute("src")) ?? "");
  }
  expect(sources.size).toBe(expected.length);
  expect(sources.has("")).toBe(false);
  runtime.assertClean();
});
