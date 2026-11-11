#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(root, "samples", "catalog.json");
const outputPath = join(root, "web", "src", "bench-data.generated.json");

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} 不存在：${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function required(value, label) {
  if (value === null || value === undefined) throw new Error(`${label} 缺失`);
  return value;
}

function gateSummary(summary, waiver) {
  if (summary.passed === true) return { state: "passed", disposition: null };
  if (waiver) return {
    state: summary.artifactType?.includes("skipped") ? "skipped-waived" : "failed-waived",
    disposition: waiver.disposition,
  };
  return { state: "failed", disposition: null };
}

function processCalls(modelCalls) {
  return modelCalls.map((call, requestIndex) => ({
    requestIndex: requestIndex + 1,
    status: call.status,
    latencyMs: round(required(call.latencyMs, `modelCalls[${requestIndex}].latencyMs`)),
    totalTokens: call.tokenUsage?.totalTokens ?? null,
    usageMissing: call.usageMissing === true,
    attemptIndex: call.attemptIndex ?? 0,
  }));
}

function buildSample(sample) {
  const archiveRoot = join(root, "archive", sample.id, "runner-output");
  const replay = readJson(join(root, "samples", sample.replayPath), `${sample.id} Replay`);
  const report = readJson(join(archiveRoot, "run-report.json"), `${sample.id} Run Report`);
  const probe = readJson(join(archiveRoot, "probe-summary.json"), `${sample.id} Probe Summary`);
  const stability = readJson(join(archiveRoot, "stability-summary.json"), `${sample.id} Stability Summary`);
  const probeWaiverPath = join(archiveRoot, "probe-waiver.json");
  const stabilityWaiverPath = join(archiveRoot, "stability-waiver.json");
  const probeWaiver = existsSync(probeWaiverPath) ? readJson(probeWaiverPath, `${sample.id} Probe Waiver`) : null;
  const stabilityWaiver = existsSync(stabilityWaiverPath) ? readJson(stabilityWaiverPath, `${sample.id} Stability Waiver`) : null;

  if (report.matchId !== replay.matchId || replay.matchId !== sample.matchId) {
    throw new Error(`${sample.id} 的 Catalog、Replay 与 Run Report matchId 不一致`);
  }
  if (report.replayHash !== replay.replayHash || replay.replayHash !== sample.replayHash) {
    throw new Error(`${sample.id} 的 Replay hash 不一致`);
  }
  if (!Array.isArray(report.agents) || report.agents.length !== 5) {
    throw new Error(`${sample.id} Run Report 必须包含五个 Agent`);
  }

  const replayAgents = new Map(replay.agents.map(agent => [agent.id, agent]));
  const rankings = new Map(replay.finalRanking.map(entry => [entry.agentId, entry]));

  return {
    id: sample.id,
    shortTitle: sample.id === "gold-001" ? "Gold 1" : sample.id === "gold-002" ? "Gold 2" : sample.title,
    title: sample.title,
    matchId: sample.matchId,
    seed: report.seed,
    runTrack: report.runTrack,
    effortLabel: sample.id === "gold-002" ? "High Effort" : "Low Effort",
    replayTarget: sample.id === "gold-001" ? "./replay.html" : `./${sample.id}.html`,
    replayHash: report.replayHash,
    limits: {
      decisionTimeoutMs: report.limits.decisionTimeoutMs,
      maxOutputTokensPerRequest: report.limits.maxOutputTokensPerRequest,
      maxAttemptsPerDecision: report.limits.maxAttemptsPerDecision,
    },
    gates: {
      probe: gateSummary(probe, probeWaiver),
      stability: gateSummary(stability, stabilityWaiver),
    },
    cost: report.cost,
    totals: report.totals,
    agents: report.agents.map(agent => {
      const replayAgent = required(replayAgents.get(agent.agentId), `${sample.id} ${agent.agentId} Replay Agent`);
      const ranking = required(rankings.get(agent.agentId), `${sample.id} ${agent.agentId} Ranking`);
      return {
        agentId: agent.agentId,
        provider: agent.provider,
        model: agent.model,
        providerReasoningEffort: agent.providerReasoningEffort ?? null,
        providerThinkingMode: agent.providerThinkingMode ?? null,
        rank: ranking.rank,
        finalNetWorth: ranking.finalNetWorth,
        tier: ranking.tier,
        status: replayAgent.status,
        exitDay: agent.exitDay,
        requestCount: agent.requestCount,
        successfulRequests: agent.successfulRequests,
        failedRequests: agent.failedRequests,
        timedOutRequests: agent.timedOutRequests,
        retryAttempts: agent.retryAttempts,
        recoveredDecisions: agent.recoveredDecisions,
        validActions: agent.validActions,
        invalidActions: agent.invalidActions,
        dnf: agent.dnf,
        errorCategories: agent.errorCategories,
        tokens: agent.tokens,
        latency: agent.latency,
        calls: processCalls(agent.modelCalls),
      };
    }),
  };
}

function main() {
  const catalog = readJson(catalogPath, "Showcase Catalog");
  const readySamples = catalog.samples.filter(sample => sample.ready === true);
  if (readySamples.length < 2) throw new Error("Bench 分析至少需要两个 ready 样本");
  const samples = readySamples.map(buildSample);
  const output = {
    schemaVersion: "arena-bench-summary-v1",
    generatedFrom: [
      "samples/catalog.json",
      "samples/<gold>/replay.json",
      "archive/<gold>/runner-output/run-report.json",
      "archive/<gold>/runner-output/probe-summary.json",
      "archive/<gold>/runner-output/stability-summary.json",
      "archive/<gold>/runner-output/*-waiver.json",
    ],
    caveats: [
      "Token 仅汇总 Provider 返回的 usage，不对缺失 usage 做估算。",
      "成本字段在两场 Run Report 中均为 unavailable。",
      "终局成绩与运行可靠性分开陈列，不用 waiver 改写游戏净资产排名。",
    ],
    samples,
  };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`Bench 脱敏汇总已生成：${outputPath}\n`);
}

main();
