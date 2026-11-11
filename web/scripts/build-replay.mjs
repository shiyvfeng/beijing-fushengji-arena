import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const siteRoot = join(webRoot, "dist", "site");

function readValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} 缺少值`);
  return value;
}

function parseArgs(args) {
  let input = "";
  let output = "";
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--input") {
      input = readValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--output") {
      output = readValue(args, index, argument);
      index++;
      continue;
    }
    throw new Error("存在未知参数");
  }
  if (!input) throw new Error("必须显式传入 --input <replay.json>");
  if (!output) throw new Error("必须显式传入 --output <replay.html>");
  return { inputPath: resolve(input), outputPath: resolve(output) };
}

const mimeByExtension = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function listFiles(directory) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const nested = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    nested.push(...(entry.isDirectory() ? await listFiles(path) : [path]));
  }
  return nested;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function inlinePublicAssets(source) {
  const assetRoot = join(siteRoot, "assets");
  let files = [];
  try {
    files = await listFiles(assetRoot);
  } catch {
    return source;
  }

  let result = source;
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    const mime = mimeByExtension[extension];
    if (!mime) continue;
    const relative = file.slice(siteRoot.length + 1).replaceAll("\\", "/");
    const dataUri = `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
    for (const candidate of [`./${relative}`, `/${relative}`, relative]) {
      result = result.replace(new RegExp(escapeRegExp(candidate), "g"), dataUri);
    }
  }
  return result;
}

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const { inputPath, outputPath } = parseArgs(args);
let html = await readFile(join(siteRoot, "index.html"), "utf8");
const stylesheetPattern = /<link\s+rel="stylesheet"\s+crossorigin\s+href="([^"]+)"\s*\/?>/g;
const modulePattern = /<script\s+type="module"\s+crossorigin\s+src="([^"]+)"><\/script>/g;

for (const match of [...html.matchAll(stylesheetPattern)]) {
  const href = match[1].replace(/^\.\//u, "");
  const css = await inlinePublicAssets(await readFile(join(siteRoot, href), "utf8"));
  html = html.replace(match[0], () => `<style>${css}</style>`);
}

for (const match of [...html.matchAll(modulePattern)]) {
  const src = match[1].replace(/^\.\//u, "");
  const js = await inlinePublicAssets(await readFile(join(siteRoot, src), "utf8"));
  html = html.replace(match[0], () => `<script type="module">${js}</script>`);
}

const replayJson = JSON.parse(await readFile(inputPath, "utf8"));
const safeJson = JSON.stringify(replayJson).replaceAll("<", "\\u003c");
if (!html.includes("</body>")) throw new Error("站点模板缺少 </body>");
html = html.replace(
  "</body>",
  `<script type="application/json" id="arena-replay-data">${safeJson}</script></body>`,
);
html = await inlinePublicAssets(html);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, html, "utf8");

if (/(?:src|href)=["'](?:https?:|\/\/)/iu.test(html)) {
  throw new Error("replay.html still contains a remote runtime dependency");
}
if (!html.includes("data-replay-hash-marker") || !html.includes("回放哈希")) {
  throw new Error("replay.html 缺少可见的 Replay hash 标记");
}
