#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(root, "web");

function readValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} 缺少值`);
  return value;
}

function parseArgs(args) {
  let input = "";
  let output = "";
  let allowInternalScripted = false;
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
    if (argument === "--allow-internal-scripted") {
      allowInternalScripted = true;
      continue;
    }
    throw new Error("存在未知参数；用法：arena:replay -- --input <replay.json> [--output <replay.html>]");
  }
  if (!input) throw new Error("必须显式传入 --input <replay.json>");
  const inputPath = resolve(input);
  return {
    inputPath,
    outputPath: output ? resolve(output) : join(dirname(inputPath), "replay.html"),
    allowInternalScripted,
  };
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("离线 Replay 构建步骤失败");
}

function sanitizedEnvironment() {
  const env = { ...process.env };
  for (const name of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "DASHSCOPE_API_KEY",
    "MOONSHOT_API_KEY",
    "ARENA_AGENT_A_API_KEY",
    "ARENA_AGENT_B_API_KEY",
    "ARENA_AGENT_C_API_KEY",
    "ARENA_AGENT_D_API_KEY",
    "ARENA_AGENT_E_API_KEY",
  ]) delete env[name];
  return env;
}

function normalizedProviderIdentity(value) {
  switch (String(value).trim().toLowerCase()) {
    case "gpt": return "openai";
    case "claude": return "anthropic";
    case "dashscope": return "qwen";
    case "moonshot": return "kimi";
    case "openai-chat": return "openai-compatible";
    default: return String(value).trim().toLowerCase();
  }
}

function validateReplay(value, allowInternalScripted) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Replay JSON 顶层必须是对象");
  if (value.schemaVersion !== "arena-schema-v4") throw new Error("正式构建器只支持 arena-schema-v4 Replay");
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.replayHash ?? "")) throw new Error("Replay hash 无效");
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.factHash ?? "")) throw new Error("Replay fact hash 无效");
  const isInternalScripted = allowInternalScripted && value?.metadata?.executionMode === "scripted";
  if (!isInternalScripted && value?.metadata?.executionMode !== "direct") {
    throw new Error("正式构建器只接受 Direct Replay");
  }
  if (!Array.isArray(value.agents) || (!isInternalScripted && value.agents.length !== 5)) {
    throw new Error("正式 Direct Replay 必须包含五个 Agent");
  }
  if (!isInternalScripted) {
    const slots = value.agents.map(agent => agent?.slot).sort((a, b) => a - b);
    if (slots.some((slot, index) => slot !== index)) throw new Error("Direct Replay slot 必须连续覆盖 0..4");
    const ids = value.agents.map(agent => agent?.id).sort();
    if (ids.some((id, index) => id !== `competitor-${index + 1}`)) {
      throw new Error("Direct Replay 内部 Agent ID 必须是 competitor-1...5");
    }
    const identities = new Set(value.agents.map(agent => (
      `${normalizedProviderIdentity(agent?.provider ?? "")}\0${String(agent?.model ?? "").trim()}`
    )));
    if (identities.size !== 5 || value.agents.some(agent => !agent?.provider?.trim() || !agent?.model?.trim())) {
      throw new Error("Direct Replay 必须包含五组唯一 Provider + model");
    }
  }
  if (!Array.isArray(value.days) || value.days.length !== 40) throw new Error("Replay 必须连续包含第 1..40 天");
  if (value.days.some((day, index) => day?.day !== index + 1)) throw new Error("Replay 日期不连续");
  const body = { ...value };
  delete body.replayHash;
  const actualHash = `sha256:${createHash("sha256").update(stableStringify(body), "utf8").digest("hex")}`;
  if (actualHash !== value.replayHash) throw new Error("Replay 内容与 replayHash 不一致");
  if (containsPotentialSecret(value)) throw new Error("Replay 包含疑似凭据，已拒绝构建");
}

function containsPotentialSecret(value) {
  const sensitiveKey = /(?:^|[-_])(api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|token|password|secret|prompt|bearer)(?:$|[-_])/iu;
  const sensitiveValues = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
    /\b(?:sk|rk)-[A-Za-z0-9_-]{10,}\b/iu,
  ];
  const visited = new Set();
  function visit(current) {
    if (typeof current === "string") return sensitiveValues.some(pattern => pattern.test(current));
    if (!current || typeof current !== "object" || visited.has(current)) return false;
    visited.add(current);
    if (Array.isArray(current)) return current.some(visit);
    return Object.entries(current).some(([key, item]) => sensitiveKey.test(key) || visit(item));
  }
  return visit(value);
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Replay 包含非有限数值");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new Error("Replay 包含 undefined 字段");
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  throw new Error(`Replay 包含不支持的 ${typeof value} 值`);
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function validateOfflineHtml(html, replay) {
  const forbidden = [
    /(?:src|href)=["'](?:https?:|\/\/)/iu,
    /<script\b[^>]+src=/iu,
    /<link\b[^>]+rel=["']stylesheet["']/iu,
    /\bfetch\s*\(/u,
    /\bnew\s+XMLHttpRequest\b/u,
    /\bnew\s+WebSocket\b/u,
    /\bnew\s+EventSource\b/u,
    /\bnavigator\.sendBeacon\s*\(/u,
    /url\(\s*["']?(?:https?:|\/\/)/iu,
  ];
  if (forbidden.some(pattern => pattern.test(html))) throw new Error("replay.html 含远程依赖或运行时网络能力");
  if (!html.includes(replay.replayHash) || !html.includes(replay.factHash)) {
    throw new Error("replay.html 未完整嵌入 Replay hash/fact hash");
  }
  if (!html.includes("data-replay-hash-marker") || !html.includes("回放哈希")) {
    throw new Error("replay.html 缺少可见 Replay hash 标记");
  }
  for (const forbidden of [
    "sampleReplay",
    "sample-fallback",
    "采访预测",
    "预测对账",
    "守夜电台",
    "导演高光",
    "人物结局",
  ]) {
    if (html.includes(forbidden)) throw new Error(`replay.html 包含暂停或样例能力：${forbidden}`);
  }
}

function main() {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  const { inputPath, outputPath, allowInternalScripted } = parseArgs(args);
  if (inputPath === outputPath) throw new Error("Replay JSON 与 HTML 输出路径不能相同");
  accessSync(join(webRoot, "node_modules", ".bin", "tsc"));
  const replay = JSON.parse(readFileSync(inputPath, "utf8"));
  validateReplay(replay, allowInternalScripted);
  const env = sanitizedEnvironment();
  run("npm", ["run", "build:site"], webRoot, env);
  run(process.execPath, [
    join(webRoot, "scripts", "build-replay.mjs"),
    "--input",
    inputPath,
    "--output",
    outputPath,
  ], root, env);
  const html = readFileSync(outputPath, "utf8");
  validateOfflineHtml(html, replay);
  const htmlHash = createHash("sha256").update(html).digest("hex");
  process.stdout.write(`离线 Replay 已生成：${outputPath}\n`);
  process.stdout.write(`HTML SHA-256：${htmlHash}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "未知错误";
  process.stderr.write(`Arena Replay 构建失败：${message}\n`);
  process.exitCode = 1;
}
