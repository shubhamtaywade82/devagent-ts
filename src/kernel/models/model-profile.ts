/**
 * ModelProfile — the rich metadata contract for models, promoting the flat
 * Capability enum from provider/catalog.ts into a queryable registry shape
 * (review recommendation §3):
 *
 *   capability enum  →  numeric capability scores + constraints + cost
 *
 * The registry is the source the ModelGateway routes from; the legacy
 * ModelCatalog stays the discovery transport (it talks to Ollama) and the
 * registry adapts its ModelInfo into profiles until richer metadata is
 * available per provider.
 */

import { Capability, ModelInfo } from "../../provider/catalog.js";
import type { Tier } from "../../provider/provider.js";

export interface ModelCapabilities {
  /** 0..1 qualitative scores; -1 means "unknown" (no metadata yet). */
  reasoning: number;
  coding: number;
  vision: number;
  toolCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;
}

export interface ModelConstraints {
  contextWindow: number;
  maxOutputTokens?: number;
  /** "fast" | "medium" | "slow" | "unknown" */
  latencyClass: string;
}

export interface ModelCost {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

export interface ModelProfile {
  id: string;
  provider: string;
  tier: Tier;
  capabilities: ModelCapabilities;
  constraints: ModelConstraints;
  cost?: ModelCost;
  /** Legacy enum tags preserved for Router compatibility during migration. */
  legacyCapabilities: Capability[];
}

export const UNKNOWN_SCORE = -1;

export function defaultConstraints(overrides?: Partial<ModelConstraints>): ModelConstraints {
  return {
    contextWindow: overrides?.contextWindow ?? 128_000,
    maxOutputTokens: overrides?.maxOutputTokens,
    latencyClass: overrides?.latencyClass ?? "unknown",
  };
}

function scoreFor(legacy: Capability[], target: Capability): number {
  // No per-model scoring metadata exists yet in the transport layer; the
  // registry records presence (1) / absence (0) and leaves refinement to
  // future provider metadata. Embedding-only models get 0 everywhere.
  return legacy.includes(target) ? 1 : 0;
}

/** Adapt a legacy ModelInfo (from provider/catalog.ts) into a profile. */
export function profileFromLegacy(info: ModelInfo, provider = "ollama"): ModelProfile {
  return {
    id: info.name,
    provider,
    tier: info.tier,
    capabilities: {
      reasoning: scoreFor(info.capabilities, "reasoning"),
      coding: scoreFor(info.capabilities, "coding"),
      vision: scoreFor(info.capabilities, "vision"),
      toolCalling: info.capabilities.includes("tools"),
      structuredOutput: false,
      streaming: true,
    },
    constraints: defaultConstraints({ latencyClass: info.capabilities.includes("quick") ? "fast" : "unknown" }),
    legacyCapabilities: info.capabilities,
  };
}
