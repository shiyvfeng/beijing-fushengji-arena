#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = join(root, "web", "dist", "site");
const releaseRoot = join(root, "release");
const releaseAssetsRoot = join(releaseRoot, "assets");
const evidenceRoot = join(root, "evidence", "home");
const homeManifest = JSON.parse(readFileSync(join(root, "web", "public", "assets", "asset-manifest.json"), "utf8"));
const audioManifest = JSON.parse(readFileSync(join(root, "web", "public", "assets", "audio", "audio-manifest.json"), "utf8"));
const rulesAssetIds = new Set([
  "arena.stage.market.five",
  "event.health-debt-crisis",
]);
const rulesStaticAssets = [
  "./assets/rules/runner-decision-loop-v1.png",
];

function ensureFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} 不存在：${path}`);
}

function copyRelative(relativePath) {
  const normalized = relativePath.replace(/^\.\//u, "");
  const source = join(buildRoot, normalized);
  const target = join(releaseRoot, normalized);
  ensureFile(source, `首页发布依赖 ${normalized}`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return target;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function removePreviousHomeRuntime() {
  if (!existsSync(releaseAssetsRoot)) return;
  for (const entry of readdirSync(releaseAssetsRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:home|audio-manifest)-.+\.(?:css|js)$/u.test(entry.name)) {
      rmSync(join(releaseAssetsRoot, entry.name));
    }
  }
  for (const directory of ["home", "audio"]) {
    const target = join(releaseAssetsRoot, directory);
    if (existsSync(target)) rmSync(target, { recursive: true });
  }
}

function main() {
  const sourceIndex = join(buildRoot, "index.html");
  ensureFile(sourceIndex, "Vite 首页构建产物");
  mkdirSync(releaseRoot, { recursive: true });
  removePreviousHomeRuntime();

  const sourceHtml = readFileSync(sourceIndex, "utf8");
  const scriptMatch = sourceHtml.match(/\s*<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"><\/script>/u);
  const stylesheetMatch = sourceHtml.match(/\s*<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)">/u);
  if (!scriptMatch || !stylesheetMatch) throw new Error("首页 HTML 没有找到唯一的 JS/CSS 运行依赖");
  if (/rel="modulepreload"/u.test(sourceHtml)) throw new Error("首页离线构建仍有拆分模块，无法安全内联");

  const scriptPath = join(buildRoot, scriptMatch[1]);
  const stylesheetPath = join(buildRoot, stylesheetMatch[1]);
  ensureFile(scriptPath, "首页 JavaScript");
  ensureFile(stylesheetPath, "首页 CSS");
  const script = readFileSync(scriptPath, "utf8");
  const stylesheet = readFileSync(stylesheetPath, "utf8");
  if (/(?:^|\n)\s*(?:import|export)\s/u.test(script)) {
    throw new Error("首页 JavaScript 仍包含 ESM import/export，不能作为 file:// 经典脚本内联");
  }
  const safeScript = script.replace(/<\/script/giu, "<\\/script");
  const html = sourceHtml
    .replace(scriptMatch[0], "")
    .replace(stylesheetMatch[0], () => `\n    <style>${stylesheet}</style>`)
    .replace("</body>", () => `  <script>${safeScript}</script>\n  </body>`);
  const releaseIndex = join(releaseRoot, "index.html");
  writeFileSync(releaseIndex, html, "utf8");

  const sourceRules = join(buildRoot, "rules.html");
  ensureFile(sourceRules, "Vite 玩法介绍构建产物");
  const sourceRulesHtml = readFileSync(sourceRules, "utf8");
  const rulesStylesheetMatch = sourceRulesHtml.match(/\s*<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)">/u);
  if (!rulesStylesheetMatch) throw new Error("玩法介绍 HTML 没有找到唯一的 CSS 运行依赖");
  if (/<script\b[^>]*\bsrc=/iu.test(sourceRulesHtml)) throw new Error("玩法介绍页面不应包含外部 JavaScript 运行依赖");
  const rulesStylesheetPath = join(buildRoot, rulesStylesheetMatch[1]);
  ensureFile(rulesStylesheetPath, "玩法介绍 CSS");
  const rulesStylesheet = readFileSync(rulesStylesheetPath, "utf8")
    .replaceAll("url(../assets/", "url(./assets/");
  const rulesHtml = sourceRulesHtml.replace(
    rulesStylesheetMatch[0],
    () => `\n    <style>${rulesStylesheet}</style>`,
  );
  const releaseRules = join(releaseRoot, "rules.html");
  writeFileSync(releaseRules, rulesHtml, "utf8");

  const copied = [releaseIndex, releaseRules];

  for (const [id, asset] of Object.entries(homeManifest.assets)) {
    if (id.startsWith("home.") || rulesAssetIds.has(id)) copied.push(copyRelative(asset.relativePath));
  }
  for (const asset of rulesStaticAssets) copied.push(copyRelative(asset));
  copied.push(copyRelative(audioManifest.assets["demo.bgm.happy-times"].relativePath));

  const forbidden = copied.filter(path => /(?:\.prompt\.md$|diagnostics|episode-traces|run-report|request|response-body)/iu.test(path));
  if (forbidden.length > 0) throw new Error(`首页 release 混入了禁止文件：${forbidden.join(", ")}`);

  const manifest = {
    artifactType: "arena-home-release-v1",
    generatedAt: new Date().toISOString(),
    entry: "release/index.html",
    rulesTarget: "release/rules.html",
    benchTarget: "release/bench.html",
    replayTarget: "release/replay.html",
    files: copied
      .map(path => ({
        path: relative(root, path),
        bytes: statSync(path).size,
        sha256: sha256(path),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`可直接双击的首页成品已生成：${manifest.entry}（${manifest.files.length} 个必要文件）\n`);
}

main();
