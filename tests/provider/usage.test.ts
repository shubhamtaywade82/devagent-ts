import { UsageTracker } from "../../src/provider/usage.js";

describe("UsageTracker", () => {
  it("accumulates calls per (tier, model)", () => {
    const tracker = new UsageTracker();
    tracker.record("local", "qwen3:8b", 100, 50, 200);
    tracker.record("local", "qwen3:8b", 40, 20, 80);

    expect(tracker.forModel("local", "qwen3:8b")).toEqual({
      tier: "local",
      model: "qwen3:8b",
      calls: 2,
      promptTokens: 140,
      completionTokens: 70,
      latencyMs: 280,
    });
  });

  it("keeps separate records per tier for the same model name", () => {
    const tracker = new UsageTracker();
    tracker.record("local", "qwen3:8b", 10, 5, 10);
    tracker.record("cloud", "qwen3:8b", 20, 10, 20);

    expect(tracker.forModel("local", "qwen3:8b")?.calls).toBe(1);
    expect(tracker.forModel("cloud", "qwen3:8b")?.calls).toBe(1);
  });

  it("returns undefined for a model never recorded", () => {
    const tracker = new UsageTracker();
    expect(tracker.forModel("local", "nope")).toBeUndefined();
  });

  it("snapshot returns independent copies", () => {
    const tracker = new UsageTracker();
    tracker.record("local", "a", 1, 1, 1);
    const snap = tracker.snapshot();
    snap[0].calls = 999;
    expect(tracker.forModel("local", "a")?.calls).toBe(1);
  });

  it("totals sums across all models", () => {
    const tracker = new UsageTracker();
    tracker.record("local", "a", 10, 5, 1);
    tracker.record("cloud", "b", 20, 10, 1);
    expect(tracker.totals()).toEqual({ calls: 2, promptTokens: 30, completionTokens: 15 });
  });

  it("reset clears all records", () => {
    const tracker = new UsageTracker();
    tracker.record("local", "a", 10, 5, 1);
    tracker.reset();
    expect(tracker.totals()).toEqual({ calls: 0, promptTokens: 0, completionTokens: 0 });
    expect(tracker.snapshot()).toEqual([]);
  });
});
