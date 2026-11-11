import type { AgentId } from "./replay-types.ts";

export type ReplayHighlightKind =
  | "public_event"
  | "net_worth_swing"
  | "debt_cleared"
  | "health_crisis"
  | "game_exit"
  | "technical_dnf"
  | "final_result";

export type ReplayEnrichmentGeneratorId = "programmatic-highlights" | "curated-highlights";

export interface ReplayHighlight {
  id: string;
  day: number;
  kind: ReplayHighlightKind;
  title: string;
  summary: string;
  agentIds: AgentId[];
  evidenceEventIds: string[];
  priority: number;
  featured: boolean;
}
export interface ReplayEnrichmentArtifact {
  schemaVersion: "arena-replay-enrichment-v1";
  sourceReplayHash: string;
  sourceFactHash: string;
  generator: {
    id: ReplayEnrichmentGeneratorId;
    version: "1.0.0";
    configHash: string;
  };
  highlights: ReplayHighlight[];
  enrichmentHash: string;
}
