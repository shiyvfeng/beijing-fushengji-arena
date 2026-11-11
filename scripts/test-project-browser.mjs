import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { buildSite, createSiteServer } from './project-site.mjs';

const site = buildSite('showcase/samples/gold-001/replay.json', 'showcase/curation/gold-001/replay-enrichment.json');
const files = readdirSync(site, { recursive: true }).map(String);
assert.ok(!files.some(path => /\.(?:mp3|wav|json|md|env)$/.test(path)));
assert.ok(!readFileSync(join(site, 'replay.html'), 'utf8').includes('data:image/'));
const parent = dirname(site);
writeFileSync(join(parent, 'outside.html'), 'must not serve');
symlinkSync(join(parent, 'outside.html'), join(site, 'outside.html'));
const server = createSiteServer(site);
let browser;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/outside.html', '/.env', '/episode-traces.json', '/%2e%2e%2foutside.html']) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  browser = await chromium.launch();
  mkdirSync('dist/project-browser', { recursive: true });
  for (const width of [1366, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1366 ? 768 : 1080 } });
    const issues = [];
    page.on('pageerror', error => issues.push(error.message));
    page.on('console', message => { if (message.type() === 'error') issues.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) issues.push(`${response.status()} ${response.url()}`); });
    page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) issues.push(`External: ${request.url()}`); });
    await page.goto(origin);
    await expect(page.getByRole('link', { name: '比赛回放', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Bench/ })).toHaveCount(0);
    await page.getByRole('link', { name: /玩法介绍/ }).click();
    await expect(page.locator('main')).toBeVisible();
    await page.goto(origin);
    await page.getByRole('link', { name: '比赛回放', exact: true }).click();
    await expect(page.getByRole('heading', { name: '今日物价', exact: true })).toBeVisible();
    await expect(page.locator('.match-status')).toContainText('1/40');
    await expect(page.getByRole('button', { name: '背景音乐开关' })).toHaveCount(0);
    await page.getByRole('spinbutton', { name: '跳转到第几天' }).fill('40');
    await page.getByRole('button', { name: '跳转', exact: true }).click();
    await expect(page.locator('.match-status')).toContainText('40/40');
    await page.screenshot({ path: `dist/project-browser/replay-${width}.png`, fullPage: true });
    await page.getByRole('link', { name: '返回首页', exact: true }).click();
    await expect(page.getByRole('link', { name: '比赛回放', exact: true })).toBeVisible();
    assert.deepEqual(issues, [], `browser ${width}`);
    await page.close();
  }
  // 与静态托管子路径一致，从 /public/ 加载相对 JS/CSS/图片和页面链接。
  const nested = createSiteServer(parent);
  try {
    nested.listen(0, '127.0.0.1');
    await once(nested, 'listening');
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${nested.address().port}/public/`);
    await page.getByRole('link', { name: '比赛回放', exact: true }).click();
    await expect(page.getByRole('heading', { name: '今日物价', exact: true })).toBeVisible();
    await page.close();
  } finally { nested.close(); }
  writeFileSync('dist/project-browser/report.json', JSON.stringify({ passed: true, viewports: [1366, 1920], site, checks: ['home', 'rules', 'day1', 'day40', 'navigation', 'subpath', 'no-external-requests', 'no-audio', 'path-boundary'] }, null, 2));
  console.log('统一站点浏览器验证通过：dist/project-browser/report.json');
} finally {
  await browser?.close();
  server.close();
}
