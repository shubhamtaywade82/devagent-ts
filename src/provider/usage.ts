import { Tier } from "./provider.js";

export interface UsageRecord {
  tier: Tier;
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** Sum of per-call latency, ms — divide by `calls` for the average. */
  latencyMs: number;
}

export interface UsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

function key(tier: Tier, model: string): string {
  return `${tier}|${model}`;
}

/**
 * Per-(tier, model) call accounting for a session. Pure in-memory —
 * whoever owns the Agent decides whether/how to persist a snapshot.
 */
export class UsageTracker {
  private readonly records = new Map<string, UsageRecord>();

  record(tier: Tier, model: string, promptTokens: number, completionTokens: number, latencyMs: number): void {
    const k = key(tier, model);
    const existing = this.records.get(k);
    if (existing) {
      existing.calls += 1;
      existing.promptTokens += promptTokens;
      existing.completionTokens += completionTokens;
      existing.latencyMs += latencyMs;
      return;
    }
    this.records.set(k, { tier, model, calls: 1, promptTokens, completionTokens, latencyMs });
  }

  forModel(tier: Tier, model: string): UsageRecord | undefined {
    const entry = this.records.get(key(tier, model));
    return entry ? { ...entry } : undefined;
  }

  snapshot(): UsageRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  totals(): UsageTotals {
    let calls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    for (const r of this.records.values()) {
      calls += r.calls;
      promptTokens += r.promptTokens;
      completionTokens += r.completionTokens;
    }
    return { calls, promptTokens, completionTokens };
  }

  reset(): void {
    this.records.clear();
  }
}
