#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runSampleScriptedMatch } from "./arena/match-runner.js";

interface CliOptions {
  seed: number;
  output?: string;
  replayOnly: boolean;
  pretty: boolean;
}

function usage(): string {
  return [
    "北京浮生记 Arena Scripted 样例 Runner",
    "",
    "用法：node dist/arena-cli.js [选项]",
    "",
    "  --seed <整数>       比赛 seed（默认 20260820）",
    "  --output <路径>     将 JSON 写入文件；省略时输出到 stdout",
    "  --replay-only       只输出 MatchReplay，不重复附带 EpisodeTrace",
    "  --compact           输出紧凑 JSON",
    "  --help              显示帮助",
    "",
    "说明：此命令只运行 4 个确定性 Scripted Agent；真实 Direct Model 使用独立的 arena-direct-cli。",
  ].join("\n");
}

function parseArgs(args: readonly string[]): CliOptions | null {
  const options: CliOptions = {
    seed: 20_260_820,
    replayOnly: false,
    pretty: true,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return null;
    if (argument === "--replay-only") {
      options.replayOnly = true;
      continue;
    }
    if (argument === "--compact") {
      options.pretty = false;
      continue;
    }
    if (argument === "--seed") {
      const value = Number(args[++index]);
      if (!Number.isSafeInteger(value)) throw new Error("--seed 必须是安全整数");
      options.seed = value;
      continue;
    }
    if (argument === "--output") {
      const value = args[++index];
      if (!value) throw new Error("--output 需要文件路径");
      options.output = resolve(value);
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const output = await runSampleScriptedMatch(options.seed);
  const artifact = options.replayOnly
    ? output.replay
    : {
        artifactType: "arena-scripted-match-v1",
        executionMode: "scripted",
        disclaimer: "此产物未调用真实模型或 MCP Host；Direct Model 使用独立 Runner。",
        ...output,
      };
  const json = JSON.stringify(artifact, null, options.pretty ? 2 : 0);

  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, `${json}\n`, "utf8");
    process.stdout.write(`已写入 Scripted Arena 产物：${options.output}\n`);
    process.stdout.write(`Replay hash：${output.replay.replayHash}\n`);
    return;
  }
  process.stdout.write(`${json}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Arena Runner 失败：${message}\n`);
  process.exitCode = 1;
});
