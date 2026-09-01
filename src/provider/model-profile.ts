import { Capability } from "./catalog.js";

/**
 * Optional per-model metadata for cost- and quality-aware routing. Every
 * field is optional and, when absent, routing/cost behavior is unchanged
 * from today — Ollama has no published per-token price (subscription/GPU-
 * time billing), so nothing here is guessed; it only takes effect when the
 * user supplies real numbers (config file, see CliConfig.modelPricing).
 */
export interface ModelProfile {
  name: string;
  contextWindow?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cachedInputCostPerMillion?: number;
  /** Reuses Capability as the task-type key instead of inventing a parallel
   * taxonomy — the catalog already classifies every model by Capability. */
  qualityScores?: Partial<Record<Capability, number>>;
  /** Relative latency hint, lower is faster. Unitless — only meaningful to
   * compare models the caller has scored consistently. */
  latencyScore?: number;
}

export type ModelProfileTable = Record<string, ModelProfile>;

export function getModelProfile(table: ModelProfileTable | undefined, name: string): ModelProfile | undefined {
  return table?.[name];
}
