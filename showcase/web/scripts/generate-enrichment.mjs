import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { adaptCoreMatchReplay } from "../src/replay-adapter.ts";
import {
  generateCuratedReplayEnrichment,
  generateReplayEnrichment,
} from "../src/enrichment.ts";

function readValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} 缺少值`);
  return value;
}

function parseArgs(args) {
  let input = "";
  let output = "";
  let curated = false;
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
    if (argument === "--curated") {
      curated = true;
      continue;
    }
    throw new Error("存在未知参数；用法：replay:enrich -- --input <replay.json> --output <enrichment.json> [--curated]");
  }
  if (!input || !output) throw new Error("必须显式传入 --input 与 --output");
  return { inputPath: resolve(input), outputPath: resolve(output), curated };
}

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const { inputPath, outputPath, curated } = parseArgs(args);
const rawReplay = JSON.parse(await readFile(inputPath, "utf8"));
const replay = adaptCoreMatchReplay(rawReplay);
const enrichment = curated
  ? generateCuratedReplayEnrichment(replay)
  : generateReplayEnrichment(replay);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(enrichment, null, 2)}\n`, "utf8");
process.stdout.write(`${curated ? "人工精选" : "程序"}高光已生成：${outputPath}\n`);
process.stdout.write(`Enrichment SHA-256：${enrichment.enrichmentHash}\n`);
