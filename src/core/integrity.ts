import type { EpisodeConfig, ScenarioConfig } from "./contracts.js";
import {
  ARENA_SCHEMA_VERSION,
  RULESET_VERSION,
  SETTLEMENT_RULE_VERSION,
  TOOL_SCHEMA_VERSION,
} from "./contracts.js";
import { RNG_VERSION } from "./random/seeded-rng.js";
import { integrityHash } from "./stable-value.js";

export function scenarioIntegrityHash(scenario: ScenarioConfig): string {
  return integrityHash(scenario);
}

export function episodeConfigIntegrityHash(config: EpisodeConfig): string {
  return integrityHash({
    matchId: config.matchId,
    episodeId: config.episodeId,
    agentId: config.agentId,
    agentSlot: config.agentSlot,
    seed: config.seed,
    scenarioId: config.scenario.id,
    scenarioHash: scenarioIntegrityHash(config.scenario),
    versions: {
      schema: ARENA_SCHEMA_VERSION,
      ruleset: RULESET_VERSION,
      toolSchema: TOOL_SCHEMA_VERSION,
      rng: RNG_VERSION,
      settlement: SETTLEMENT_RULE_VERSION,
    },
  });
}

