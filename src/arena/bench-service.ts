import { DEFAULT_SCENARIO } from "../core/scenario.js";
import { integrityHash } from "../core/stable-value.js";
import { findPotentialSecrets } from "../core/secret-scan.js";
import { DirectModelDriver, DEFAULT_DIRECT_AGENT_SPECS } from "./direct-driver.js";
import { createDirectProviderAdapter, normalizeAgentProviderConfig, type ArenaAgentProviderConfig } from "./providers/provider-factory.js";
import { computeProbeConfigFingerprint, probeProviders } from "./provider-probe.js";
import { buildProviderStabilityResult, STABILITY_ACTION_TARGET } from "./stability-probe.js";
import { runMatch } from "./match-runner.js";
import { buildDirectRunReport } from "./run-report.js";
import type { EpisodeProgressEvent } from "./episode-runner.js";

export interface BenchConfig {
  matchId: string;
  seed: number;
  agents: readonly ArenaAgentProviderConfig[];
  completionAssisted: boolean;
  slotRotationIndex: number;
  maxActionsPerAgent: number;
  decisionTimeoutMs: number;
  totalWallClockMs: number;
  providerTimeBudgetMs: number;
  maxOutputTokens: number;
}

export interface BenchHooks {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (event: EpisodeProgressEvent) => void;
  onStage?: (stage: string) => void;
  onArtifact?: (name: string, artifact: unknown) => void;
}

export function createBenchDrivers(config: BenchConfig, hooks: BenchHooks = {}) {
  return DEFAULT_DIRECT_AGENT_SPECS.map((spec, index) => new DirectModelDriver({
    id: spec.id,
    slot: (index + config.slotRotationIndex) % 5,
    completionAssisted: config.completionAssisted,
    provider: createDirectProviderAdapter(normalizeAgentProviderConfig(config.agents[index]), {
      completionAssisted: config.completionAssisted,
      ...(hooks.fetchImpl ? { fetchImpl: hooks.fetchImpl } : {}),
    }),
  }));
}

/** Shared, UI-independent pipeline. It never builds HTML or reads process.env. */
export async function executeBench(config: BenchConfig, hooks: BenchHooks = {}) {
  hooks.signal?.throwIfAborted();
  if (config.agents.length !== 5) throw new Error("必须配置五个模型");
  const agents = config.agents.map(agent => normalizeAgentProviderConfig(agent));
  if (new Set(agents.map(agent => `${agent.provider}\0${agent.model}`)).size !== 5) throw new Error("五组 Provider + Model 不能重复");
  const drivers = createBenchDrivers(config, hooks);
  const fingerprint = computeProbeConfigFingerprint({
    ...config, scenario: DEFAULT_SCENARIO, maxDailyDecisionsPerAgent: DEFAULT_SCENARIO.totalDays,
    agents: drivers.map((driver, entryIndex) => ({
      entryIndex, provider: driver.descriptor.provider!, model: driver.descriptor.model!,
      providerAdapterVersion: driver.descriptor.providerAdapterVersion!,
      endpointFingerprint: integrityHash({ provider: agents[entryIndex].provider, baseUrl: agents[entryIndex].baseUrl }),
      declaredModelRevision: agents[entryIndex].modelRevision ?? null,
      thinkingMode: agents[entryIndex].thinkingMode, reasoningEffort: agents[entryIndex].reasoningEffort,
    })),
  });
  const artifact = (name: string, data: unknown) => {
    hooks.signal?.throwIfAborted();
    if (findPotentialSecrets(data).length) throw new Error("产物包含疑似敏感信息");
    hooks.onArtifact?.(name, data);
  };
  hooks.onStage?.("probe");
  const probe = await probeProviders({ ...config, scenario: DEFAULT_SCENARIO, drivers,
    configFingerprint: fingerprint, signal: hooks.signal });
  artifact("probe-summary.json", probe);
  if (!probe.passed) throw new Error("Provider Probe 未全部通过");
  hooks.onStage?.("stability");
  const stableOutput = await runMatch({ ...config, scenario: DEFAULT_SCENARIO,
    drivers: createBenchDrivers(config, hooks), signal: hooks.signal, onProgress: hooks.onProgress,
    ...(config.completionAssisted
      ? { maxDailyDecisionsPerAgent: STABILITY_ACTION_TARGET }
      : { maxActionsPerAgent: STABILITY_ACTION_TARGET, totalWallClockMs: Math.min(config.totalWallClockMs, STABILITY_ACTION_TARGET * config.decisionTimeoutMs) }),
  });
  const stability = buildProviderStabilityResult(stableOutput, fingerprint, probe);
  artifact("stability-summary.json", stability);
  if (!stability.passed) throw new Error("十步 Stability 未全部通过");
  hooks.onStage?.("match");
  const output = await runMatch({ ...config, scenario: DEFAULT_SCENARIO,
    drivers: createBenchDrivers(config, hooks), signal: hooks.signal, onProgress: hooks.onProgress,
    ...(config.completionAssisted ? { maxDailyDecisionsPerAgent: DEFAULT_SCENARIO.totalDays } : {}),
  });
  hooks.signal?.throwIfAborted();
  hooks.onStage?.("finalize");
  const report = buildDirectRunReport({ ...config,
    ...(config.completionAssisted ? { maxDailyDecisionsPerAgent: DEFAULT_SCENARIO.totalDays } : {}),
    probeSummaryHash: probe.probeSummaryHash, probeCreatedAt: probe.createdAt, probePassed: probe.passed,
    stabilitySummaryHash: stability.stabilitySummaryHash, stabilityCreatedAt: stability.createdAt,
    stabilityPassed: stability.passed, stabilitySkipped: false,
  }, output);
  artifact("replay.json", output.replay);
  artifact("episode-traces.json", output.traces);
  artifact("run-report.json", report);
  return { replay: output.replay, report };
}
