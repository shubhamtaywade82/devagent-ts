/**
 * ModelCapabilityRegistry — the formal home for model metadata.
 *
 * Promotes provider/catalog.ts from "a candidate list the router filters"
 * into a queryable registry with dimensions beyond the flat capability enum
 * (scores, tool-calling, context window, latency class, cost). Routing and
 * budget accounting read from here; provider transports refresh it.
 */

import { Capability } from "../../provider/catalog.js";
import {
  ModelProfile,
  ModelCost,
  UNKNOWN_SCORE,
  profileFromLegacy,
} from "./model-profile.js";
import type { ModelInfo } from "../../provider/catalog.js";

export interface ProfileQuery {
  /** Minimum score for a scored capability (ignored when -1). */
  minScore?: number;
  tier?: "local" | "cloud";
  toolCalling?: boolean;
  maxLatencyClass?: "fast" | "medium" | "slow";
  /** Local-first ordering like the legacy catalog (default true). */
  localFirst?: boolean;
}

const LATENCY_ORDER = { fast: 0, medium: 1, slow: 2, unknown: 3 } as const;

export class ModelCapabilityRegistry {
  private readonly profiles = new Map<string, ModelProfile>();

  upsert(profile: ModelProfile): this {
    this.profiles.set(profile.id, profile);
    return this;
  }

  remove(id: string): boolean {
    return this.profiles.delete(id);
  }

  get(id: string): ModelProfile | undefined {
    return this.profiles.get(id);
  }

  has(id: string): boolean {
    return this.profiles.has(id);
  }

  all(): ModelProfile[] {
    return [...this.profiles.values()];
  }

  size(): number {
    return this.profiles.size;
  }

  /** Replace the whole set from a legacy catalog refresh. Returns the registry for chaining. */
  syncFromLegacy(infos: ModelInfo[], provider = "ollama"): this {
    for (const info of infos) this.upsert(profileFromLegacy(info, provider));
    return this;
  }

  query(query: ProfileQuery = {}): ModelProfile[] {
    const minScore = query.minScore ?? 0;
    let result = this.all().filter((p) => {
      if (query.tier && p.tier !== query.tier) return false;
      if (query.toolCalling && !p.capabilities.toolCalling) return false;
      if (
        query.maxLatencyClass &&
        LATENCY_ORDER[p.constraints.latencyClass as keyof typeof LATENCY_ORDER] >
          LATENCY_ORDER[query.maxLatencyClass]
      ) {
        return false;
      }
      return true;
    });

    if (query.minScore !== undefined && query.minScore > UNKNOWN_SCORE) {
      result = result.filter((p) => this.bestScore(p) >= minScore);
    }

    if (query.localFirst !== false) {
      result.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "local" ? -1 : 1));
    }
    return result;
  }

  /** Highest capability score across the scored dimensions. */
  private bestScore(p: ModelProfile): number {
    const { reasoning, coding, vision } = p.capabilities;
    return Math.max(reasoning, coding, vision);
  }

  /**
   * Profiles that satisfy a legacy capability tag — the bridge the Router
   * uses until routing moves fully onto numeric scores.
   */
  withLegacyCapability(capability: Capability): ModelProfile[] {
    return this.all().filter((p) => p.legacyCapabilities.includes(capability));
  }

  /** Rough per-call cost estimate in USD, when cost metadata exists. */
  estimateCostUsd(id: string, promptTokens: number, completionTokens: number): number | undefined {
    const profile = this.profiles.get(id);
    if (!profile?.cost) return undefined;
    const cost: ModelCost = profile.cost;
    return (
      Math.round(((promptTokens / 1_000_000) * cost.input + (completionTokens / 1_000_000) * cost.output) * 1e6) / 1e6
    );
  }
}
