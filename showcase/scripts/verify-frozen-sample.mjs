import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReplayEnrichment } from "../web/src/enrichment.ts";
import { adaptCoreMatchReplay } from "../web/src/replay-adapter.ts";
import { integrityHash } from "../web/src/replay-integrity.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = readJson(join(root, "samples", "catalog.json"));

function sampleContext(sampleId) {
  const archiveRoot = join(root, "archive", sampleId);
  return {
    sampleId,
    archiveRoot,
    runnerRoot: join(archiveRoot, "runner-output"),
    diagnosticsRoot: join(archiveRoot, "diagnostics"),
    sampleReplayPath: join(root, "samples", sampleId, "replay.json"),
    manifest: readJson(join(archiveRoot, "freeze-manifest.json")),
  };
}

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`冻结归档禁止符号链接：${relative(root, path)}`);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
    else fail(`冻结归档包含非常规文件：${relative(root, path)}`);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function assertInside(base, candidate) {
  const value = relative(base, candidate);
  if (!value || value.startsWith(`..${sep}`) || value === ".." || value.startsWith(sep)) {
    fail(`SHA256SUMS 路径越界：${candidate}`);
  }
}

function verifySha256Sums(context) {
  const { archiveRoot, runnerRoot, diagnosticsRoot, manifest } = context;
  const sumsPath = join(archiveRoot, "SHA256SUMS");
  if (sha256File(sumsPath) !== manifest.hashes.sha256SumsFile) fail("SHA256SUMS 自身哈希不一致");
  const lines = readFileSync(sumsPath, "utf8").trim().split("\n");
  const seen = new Set();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    if (!match) fail(`SHA256SUMS 行格式无效：${line}`);
    const target = resolve(archiveRoot, match[2]);
    assertInside(archiveRoot, target);
    if (seen.has(target)) fail(`SHA256SUMS 重复路径：${match[2]}`);
    seen.add(target);
    if (!lstatSync(target).isFile()) fail(`SHA256SUMS 目标不是普通文件：${match[2]}`);
    if (sha256File(target) !== match[1]) fail(`冻结文件哈希不一致：${match[2]}`);
  }
  const actual = [...listFiles(runnerRoot), ...listFiles(diagnosticsRoot)];
  if (lines.length !== actual.length || actual.some(path => !seen.has(path))) {
    fail("SHA256SUMS 未完整覆盖 Runner 输出和 diagnostics");
  }
}

function verifyInventory(context) {
  const { runnerRoot, diagnosticsRoot, manifest } = context;
  const groups = [
    [runnerRoot, manifest.inventory.runnerOutput],
    [diagnosticsRoot, manifest.inventory.diagnostics],
  ];
  for (const [directory, expected] of groups) {
    const files = listFiles(directory);
    const bytes = files.reduce((sum, path) => sum + statSync(path).size, 0);
    if (files.length !== expected.files || bytes !== expected.bytes) {
      fail(`冻结清单数量或字节数不一致：${relative(root, directory)}`);
    }
  }
  const phaseCounts = Object.fromEntries(["probe", "stability", "match"].map(phase => {
    const directory = join(diagnosticsRoot, phase);
    return [phase, existsSync(directory) ? listFiles(directory).length : 0];
  }));
  if (phaseCounts.probe !== manifest.inventory.diagnostics.probeFiles
    || phaseCounts.stability !== manifest.inventory.diagnostics.stabilityFiles
    || phaseCounts.match !== manifest.inventory.diagnostics.matchFiles) {
    fail("Diagnostics phase 文件数量不一致");
  }
}

function assertInternalHash(value, field, label) {
  const expected = value[field];
  const body = { ...value };
  delete body[field];
  if (integrityHash(body) !== expected) fail(`${label} 内部哈希不一致`);
}

function verifyArtifactLinks(context) {
  const { runnerRoot, diagnosticsRoot, manifest, sampleId } = context;
  const probe = readJson(join(runnerRoot, "probe-summary.json"));
  const stability = readJson(join(runnerRoot, "stability-summary.json"));
  const stabilityWaiver = readJson(join(runnerRoot, "stability-waiver.json"));
  const probeWaiverPath = join(runnerRoot, "probe-waiver.json");
  const probeWaiver = existsSync(probeWaiverPath) ? readJson(probeWaiverPath) : null;
  const traces = readJson(join(runnerRoot, "episode-traces.json"));
  const rawReplay = readJson(join(runnerRoot, "replay.json"));
  const report = readJson(join(runnerRoot, "run-report.json"));
  assertInternalHash(probe, "probeSummaryHash", "Probe");
  assertInternalHash(stability, "stabilitySummaryHash", "Stability");
  assertInternalHash(stabilityWaiver, "waiverHash", "Stability waiver");
  if (probeWaiver) assertInternalHash(probeWaiver, "waiverHash", "Probe waiver");
  for (const [index, trace] of traces.entries()) assertInternalHash(trace, "traceHash", `Trace ${index + 1}`);
  const traceHashes = traces.map(trace => trace.traceHash);
  if (JSON.stringify(traceHashes) !== JSON.stringify(rawReplay.sourceTraceHashes)) fail("Replay 的 sourceTraceHashes 不匹配");
  if (report.replayHash !== rawReplay.replayHash
    || report.probe.summaryHash !== probe.probeSummaryHash
    || report.stability.summaryHash !== stability.stabilitySummaryHash
    || stabilityWaiver.probeSummaryHash !== probe.probeSummaryHash
    || stabilityWaiver.stabilitySummaryHash !== stability.stabilitySummaryHash
    || (report.stability.waiver && report.stability.waiver.hash !== stabilityWaiver.waiverHash)
    || Boolean(report.probe.waiver) !== Boolean(probeWaiver)
    || (probeWaiver && (probeWaiver.probeSummaryHash !== probe.probeSummaryHash
      || report.probe.waiver?.hash !== probeWaiver.waiverHash))) {
    fail("Report、Replay、Probe、Stability 或 waiver 引用不一致");
  }
  if (manifest.gates && (probe.passed !== manifest.gates.probePassed
    || stability.passed !== manifest.gates.stabilityPassed
    || stability.skipped !== manifest.gates.stabilitySkipped
    || probeWaiver?.waiverHash !== manifest.gates.probeWaiverHash
    || stabilityWaiver.waiverHash !== manifest.gates.stabilityWaiverHash
    || report.probe.waiver?.hash !== manifest.gates.probeWaiverHash
    || report.stability.waiver?.hash !== manifest.gates.stabilityWaiverHash)) {
    fail(`${sampleId} 的 Probe/Stability gate 事实不一致`);
  }
  const browser = readJson(join(runnerRoot, "browser-acceptance.json"));
  const passed = browser.checks.filter(check => check.status === "passed").length;
  if (browser.status !== manifest.historicalBrowserAcceptance.status
    || passed !== manifest.historicalBrowserAcceptance.passed
    || browser.checks.length !== manifest.historicalBrowserAcceptance.total) {
    fail(`${sampleId} 旧浏览器失败证据被改变`);
  }
  const ledgerIds = report.agents.flatMap(agent => agent.modelCalls.map(call => call.modelCallId));
  const exchangeIds = listFiles(join(diagnosticsRoot, "match")).map(path => readJson(path).modelCallId);
  if (ledgerIds.length !== manifest.inventory.diagnostics.matchFiles
    || new Set(ledgerIds).size !== ledgerIds.length
    || JSON.stringify([...ledgerIds].sort()) !== JSON.stringify([...exchangeIds].sort())) {
    fail("Match ledger 与 raw exchanges 的 modelCallId 不一致");
  }
}

function verifyRedaction(context) {
  const { diagnosticsRoot } = context;
  const credentialField = /^(?:authorization|proxy[-_]?authorization|api[-_]?key|x[-_]?api[-_]?key|cookie|set[-_]?cookie|password|passwd|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|session[-_]?token|private[-_]?key|credential|credentials)$/iu;
  const leakedToken = /\bBearer\s+(?!\[REDACTED\])\S+|(?:^|[^A-Za-z0-9_-])(?:sk|rk)-[A-Za-z0-9_-]{8,}\b|(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/iu;
  function walk(value, path) {
    if (typeof value === "string") {
      if (leakedToken.test(value)) fail(`疑似未脱敏凭据：${path}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (credentialField.test(key) && item !== "[REDACTED]") fail(`凭据字段未脱敏：${path}.${key}`);
      walk(item, `${path}.${key}`);
    }
  }
  for (const path of listFiles(diagnosticsRoot)) walk(readJson(path), relative(root, path));
}

function verifyShowcaseSample(context) {
  const { sampleId, sampleReplayPath, runnerRoot, manifest } = context;
  const sample = catalog.samples.find(item => item.id === sampleId);
  if (!sample?.ready) fail(`${sampleId} 未在 Showcase catalog 标记 ready`);
  if (sample.replayPath !== `${sampleId}/replay.json`
    || sample.runTrack !== manifest.runTrack
    || sample.matchId !== manifest.matchId) {
    fail(`${sampleId} catalog 身份与冻结清单不一致`);
  }
  const sampleEntries = readdirSync(dirname(sampleReplayPath), { withFileTypes: true });
  if (sampleEntries.length !== 1
    || sampleEntries[0].name !== "replay.json"
    || !sampleEntries[0].isFile()) {
    fail(`samples/${sampleId} 只能持久保存白名单 Replay JSON`);
  }
  const sampleFileHash = sha256File(sampleReplayPath);
  if (sampleFileHash !== sample.replayFileSha256
    || sampleFileHash !== manifest.hashes.replayFile
    || sampleFileHash !== sha256File(join(runnerRoot, "replay.json"))) {
    fail("Showcase Replay 与冻结源不一致");
  }
  const replay = adaptCoreMatchReplay(readJson(sampleReplayPath));
  if (replay.executionMode !== "direct"
    || replay.competitionAudit?.runTrack !== manifest.runTrack
    || replay.agentProfiles.length !== 5
    || replay.days.length !== 40
    || replay.matchId !== manifest.matchId
    || replay.replayHash !== sample.replayHash
    || replay.factLayerHash !== sample.factHash) {
    fail(`Showcase Replay 的 Adapter 结果不符合 ${sampleId} 冻结身份`);
  }
  const enrichment = generateReplayEnrichment(replay);
  if (enrichment.enrichmentHash !== sample.expectedEnrichmentHash
    || enrichment.enrichmentHash !== manifest.hashes.expectedEnrichment) {
    fail(`${sampleId} Enrichment 不再确定`);
  }
  if (manifest.outcome) {
    const statuses = replay.finalResults.map(result => result.status);
    const completedAgents = statuses.filter(status => status === "completed").length;
    const gameFailureAgents = statuses.filter(status => status === "dead" || status === "bankrupt").length;
    const technicalDnfAgents = statuses.length - completedAgents - gameFailureAgents;
    if (completedAgents !== manifest.outcome.completedAgents
      || gameFailureAgents !== manifest.outcome.gameFailureAgents
      || technicalDnfAgents !== manifest.outcome.technicalDnfAgents) {
      fail(`${sampleId} 终局状态与冻结清单不一致`);
    }
  }
  return { replay, enrichment };
}

if (Number(process.versions.node.split(".")[0]) !== 24) fail(`冻结校验固定使用 Node 24；当前为 ${process.version}`);
const expectedSampleIds = ["gold-001", "gold-002"];
if (!Array.isArray(catalog.samples)
  || catalog.samples.length !== expectedSampleIds.length
  || JSON.stringify(catalog.samples.map(sample => sample.id).sort()) !== JSON.stringify(expectedSampleIds)
  || !Array.isArray(catalog.pendingSources)
  || catalog.pendingSources.length !== 0) {
  fail("Showcase catalog 必须且只能包含两个 ready 金样，且无 pending source");
}
const results = expectedSampleIds.map(sampleId => {
  const context = sampleContext(sampleId);
  verifySha256Sums(context);
  verifyInventory(context);
  verifyArtifactLinks(context);
  verifyRedaction(context);
  const { replay, enrichment } = verifyShowcaseSample(context);
  return {
    sampleId,
    matchId: replay.matchId,
    replayHash: replay.replayHash,
    factHash: replay.factLayerHash,
    enrichmentHash: enrichment.enrichmentHash,
    runnerOutputFiles: context.manifest.inventory.runnerOutput.files,
    diagnosticFiles: context.manifest.inventory.diagnostics.files,
  };
});
process.stdout.write(`${JSON.stringify({
  status: "passed",
  samples: results,
  pendingSources: 0,
}, null, 2)}\n`);
