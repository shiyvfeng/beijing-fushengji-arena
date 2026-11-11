#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = join(root, "web", "dist", "bench");
const releaseRoot = join(root, "release");
const evidenceRoot = join(root, "evidence", "bench");

function ensureFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} 不存在：${path}`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  const sourceHtmlPath = join(buildRoot, "bench.html");
  ensureFile(sourceHtmlPath, "Vite Bench 构建产物");
  const sourceHtml = readFileSync(sourceHtmlPath, "utf8");
  const scriptMatch = sourceHtml.match(/\s*<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"><\/script>/u);
  const stylesheetMatch = sourceHtml.match(/\s*<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)">/u);
  if (!scriptMatch || !stylesheetMatch) throw new Error("Bench HTML 没有找到唯一的 JS/CSS 运行依赖");
  if (/rel="modulepreload"/u.test(sourceHtml)) throw new Error("Bench 离线构建仍有拆分模块，无法安全内联");

  const scriptPath = join(buildRoot, scriptMatch[1]);
  const stylesheetPath = join(buildRoot, stylesheetMatch[1]);
  ensureFile(scriptPath, "Bench JavaScript");
  ensureFile(stylesheetPath, "Bench CSS");
  const script = readFileSync(scriptPath, "utf8");
  const stylesheet = readFileSync(stylesheetPath, "utf8");
  if (/(?:^|\n)\s*(?:import|export)\s/u.test(script)) {
    throw new Error("Bench JavaScript 仍包含 ESM import/export，不能作为 file:// 经典脚本内联");
  }

  const safeScript = script.replace(/<\/script/giu, "<\\/script");
  const html = sourceHtml
    .replace(scriptMatch[0], "")
    .replace(stylesheetMatch[0], () => `\n    <style>${stylesheet}</style>`)
    .replace("</body>", () => `  <script>${safeScript}</script>\n  </body>`);

  if (/(?:src|href)=["']https?:\/\//iu.test(html)) throw new Error("Bench release 包含远程运行依赖");
  if (/(?:diagnostics|episode-traces|response-body|authorization|api[_-]?key)/iu.test(html)) {
    throw new Error("Bench release 混入了禁止的私有诊断字段");
  }

  mkdirSync(releaseRoot, { recursive: true });
  const releasePath = join(releaseRoot, "bench.html");
  writeFileSync(releasePath, html, "utf8");
  const manifest = {
    artifactType: "arena-bench-release-v1",
    generatedAt: new Date().toISOString(),
    entry: "release/bench.html",
    sources: [
      "samples/catalog.json",
      "samples/gold-001/replay.json",
      "samples/gold-002/replay.json",
      "archive/gold-001/runner-output/run-report.json",
      "archive/gold-002/runner-output/run-report.json",
    ],
    files: [{
      path: relative(root, releasePath),
      bytes: statSync(releasePath).size,
      sha256: sha256(releasePath),
    }],
  };
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`可直接双击的 Bench 成品已生成：${manifest.entry}\n`);
}

main();
