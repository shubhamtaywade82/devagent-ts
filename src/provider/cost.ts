import { Tier } from "./provider.js";
import { UsageRecord, UsageTracker } from "./usage.js";

export interface FlatPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
}

export type ModelPricingTable = Record<string, FlatPricing>;

export interface ModelCostBreakdown {
  tier: Tier;
  model: string;
  /** null when no pricing is configured for this model (no per-model rate,
   * no flat fallback) — never a guessed number. */
  costUsd: number | null;
}

/**
 * Turns UsageTracker's token counts into a dollar figure — but only for
 * models with a configured rate. Ollama has no published per-token price
 * (subscription/GPU-time billing), so absent any user-supplied rate this
 * stays null throughout, same honest-default behavior as the existing
 * flat-rate calc in layout/strips.ts, generalized to per-model pricing.
 */
export class CostTracker {
  constructor(
    private readonly usage: UsageTracker,
    private readonly perModel?: ModelPricingTable,
    private readonly fallback?: FlatPricing,
  ) {}

  private rateFor(model: string): FlatPricing | undefined {
    return this.perModel?.[model] ?? this.fallback;
  }

  private costForRecord(record: UsageRecord): number | null {
    const rate = this.rateFor(record.model);
    if (!rate) return null;
    return (
      (record.promptTokens / 1_000_000) * rate.inputPerMillion +
      (record.completionTokens / 1_000_000) * rate.outputPerMillion
    );
  }

  costForModel(tier: Tier, model: string): number | null {
    const record = this.usage.forModel(tier, model);
    return record ? this.costForRecord(record) : null;
  }

  /** Sum of every priced model's cost. Unpriced models are silently
   * excluded from the sum (not treated as zero) — see `breakdown()` to see
   * which ones those are. null only when nothing at all could be priced. */
  totalCostUsd(): number | null {
    let total = 0;
    let anyPriced = false;
    for (const record of this.usage.snapshot()) {
      const cost = this.costForRecord(record);
      if (cost === null) continue;
      total += cost;
      anyPriced = true;
    }
    return anyPriced ? total : null;
  }

  breakdown(): ModelCostBreakdown[] {
    return this.usage.snapshot().map((r) => ({ tier: r.tier, model: r.model, costUsd: this.costForRecord(r) }));
  }
}
