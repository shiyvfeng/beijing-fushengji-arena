#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutput = resolve(scriptDirectory, "model-list.csv");

function usage() {
  return [
    "用法：",
    "  MODEL_LIST_API_KEY=... node tools/model-list-query/query-models.mjs --base-url <Base URL>",
    "  node tools/model-list-query/query-models.mjs --base-url <Base URL> --api-key <API Key>",
    "",
    "可选参数：",
    "  --auth-header <bearer|x-api-key|x-goog-api-key>  鉴权头，默认 bearer",
    "  --output <path>                                CSV 输出路径，默认本目录 model-list.csv",
    "",
    "也可使用 MODEL_LIST_BASE_URL 与 MODEL_LIST_API_KEY 环境变量。",
  ].join("\n");
}

function nextValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少值`);
  return value;
}

function parseArgs(args) {
  const options = {
    baseUrl: process.env.MODEL_LIST_BASE_URL ?? "",
    apiKey: process.env.MODEL_LIST_API_KEY ?? "",
    authHeader: "bearer",
    output: defaultOutput,
  };

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--base-url") {
      options.baseUrl = nextValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--api-key") {
      options.apiKey = nextValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--auth-header") {
      options.authHeader = nextValue(args, index, argument);
      index++;
      continue;
    }
    if (argument === "--output") {
      options.output = resolve(nextValue(args, index, argument));
      index++;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  if (!options.baseUrl) throw new Error("缺少 Base URL（--base-url 或 MODEL_LIST_BASE_URL）");
  if (!options.apiKey) throw new Error("缺少 API Key（--api-key 或 MODEL_LIST_API_KEY）");
  if (!new Set(["bearer", "x-api-key", "x-goog-api-key"]).has(options.authHeader)) {
    throw new Error("--auth-header 仅支持 bearer、x-api-key 或 x-goog-api-key");
  }
  return options;
}

function modelsEndpoint(baseUrl) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Base URL 不能包含用户名、密码、查询参数或 hash");
  }
  const pathname = url.pathname.replace(/\/+$/u, "");
  if (pathname.endsWith("/models")) return url.toString();
  url.pathname = `${pathname || ""}${pathname.endsWith("/v1") ? "/models" : "/v1/models"}`;
  return url.toString();
}

function authorizationHeaders(apiKey, authHeader) {
  if (authHeader === "bearer") return { Authorization: `Bearer ${apiKey}` };
  if (authHeader === "x-api-key") return { "x-api-key": apiKey };
  return { "x-goog-api-key": apiKey };
}

function sanitizeServerMessage(value) {
  return String(value)
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]")
    .replace(/(?:api[-_ ]?key|token|secret)\s*[:=]\s*[^\s,"']+/giu, "$1=[REDACTED]")
    .slice(0, 500);
}

function modelRows(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : null;
  if (!items) throw new Error("接口响应不含模型数组（预期 data 或 models）");

  return items.map((item, index) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim()) {
      throw new Error(`第 ${index + 1} 个模型缺少 id`);
    }
    return {
      id: item.id,
      object: typeof item.object === "string" ? item.object : "",
      created: typeof item.created === "number" ? new Date(item.created * 1000).toISOString() : "",
      owned_by: typeof item.owned_by === "string" ? item.owned_by : "",
      root: typeof item.root === "string" ? item.root : "",
      parent: typeof item.parent === "string" ? item.parent : "",
    };
  });
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function toCsv(rows) {
  const columns = ["id", "object", "created", "owned_by", "root", "parent"];
  return `${columns.join(",")}\n${rows.map(row => columns.map(column => escapeCsv(row[column])).join(",")).join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const endpoint = modelsEndpoint(options.baseUrl);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authorizationHeaders(options.apiKey, options.authHeader),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`模型列表请求失败：HTTP ${response.status}${body ? ` - ${sanitizeServerMessage(body)}` : ""}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("模型列表响应不是合法 JSON");
  }
  const rows = modelRows(payload);
  const outputPath = options.output;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, toCsv(rows), "utf8");
  process.stdout.write(`已查询 ${rows.length} 个模型，CSV 已写入：${outputPath}\n`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "未知错误";
  process.stderr.write(`模型列表查询失败：${message}\n`);
  process.exitCode = 1;
});
