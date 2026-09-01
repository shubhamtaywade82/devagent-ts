import { UsageTracker } from "../../src/provider/usage.js";
import { CostTracker } from "../../src/provider/cost.js";

describe("CostTracker", () => {
  it("returns null everywhere when no pricing is configured", () => {
    const usage = new UsageTracker();
    usage.record("local", "qwen3:8b", 1_000_000, 1_000_000, 10);
    const cost = new CostTracker(usage);

    expect(cost.totalCostUsd()).toBeNull();
    expect(cost.costForModel("local", "qwen3:8b")).toBeNull();
    expect(cost.breakdown()).toEqual([{ tier: "local", model: "qwen3:8b", costUsd: null }]);
  });

  it("prices a model using its per-model rate", () => {
    const usage = new UsageTracker();
    usage.record("cloud", "gpt-oss:120b", 1_000_000, 500_000, 10);
    const cost = new CostTracker(usage, { "gpt-oss:120b": { inputPerMillion: 2, outputPerMillion: 8 } });

    // 1M prompt tokens * $2/M + 0.5M completion tokens * $8/M = $2 + $4 = $6
    expect(cost.costForModel("cloud", "gpt-oss:120b")).toBeCloseTo(6);
    expect(cost.totalCostUsd()).toBeCloseTo(6);
  });

  it("falls back to the flat rate when no per-model entry exists", () => {
    const usage = new UsageTracker();
    usage.record("local", "some-model", 500_000, 500_000, 10);
    const cost = new CostTracker(usage, undefined, { inputPerMillion: 1, outputPerMillion: 1 });

    expect(cost.costForModel("local", "some-model")).toBeCloseTo(1);
  });

  it("sums only priced models, excluding unpriced ones from the total", () => {
    const usage = new UsageTracker();
    usage.record("local", "priced", 1_000_000, 0, 10);
    usage.record("local", "unpriced", 1_000_000, 0, 10);
    const cost = new CostTracker(usage, { priced: { inputPerMillion: 3, outputPerMillion: 3 } });

    expect(cost.totalCostUsd()).toBeCloseTo(3);
    expect(cost.breakdown()).toEqual(
      expect.arrayContaining([
        { tier: "local", model: "priced", costUsd: 3 },
        { tier: "local", model: "unpriced", costUsd: null },
      ]),
    );
  });

  it("returns null for a model with no recorded usage", () => {
    const usage = new UsageTracker();
    const cost = new CostTracker(usage, undefined, { inputPerMillion: 1, outputPerMillion: 1 });
    expect(cost.costForModel("local", "never-called")).toBeNull();
  });
});
