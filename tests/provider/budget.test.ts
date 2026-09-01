import { UsageTracker } from "../../src/provider/usage.js";
import { CostTracker } from "../../src/provider/cost.js";
import { BudgetManager } from "../../src/provider/budget.js";
import { BudgetExhaustedError } from "../../src/provider/errors.js";

describe("BudgetManager", () => {
  it("never exceeds when no limits are configured", () => {
    const usage = new UsageTracker();
    usage.record("local", "a", 1_000_000_000, 1_000_000_000, 1);
    const cost = new CostTracker(usage);
    const budget = new BudgetManager({});

    expect(budget.check(usage, cost)).toEqual({ exceeded: false });
    expect(() => budget.assertWithinBudget(usage, cost)).not.toThrow();
  });

  it("trips on maxCalls", () => {
    const usage = new UsageTracker();
    usage.record("local", "a", 1, 1, 1);
    usage.record("local", "a", 1, 1, 1);
    const cost = new CostTracker(usage);
    const budget = new BudgetManager({ maxCalls: 2 });

    expect(budget.check(usage, cost)).toEqual({ exceeded: true, dimension: "calls", consumed: 2, limit: 2 });
    expect(() => budget.assertWithinBudget(usage, cost)).toThrow(BudgetExhaustedError);
  });

  it("trips on maxTokens", () => {
    const usage = new UsageTracker();
    usage.record("local", "a", 800, 300, 1);
    const cost = new CostTracker(usage);
    const budget = new BudgetManager({ maxTokens: 1000 });

    const result = budget.check(usage, cost);
    expect(result.exceeded).toBe(true);
    expect(result.dimension).toBe("tokens");
    expect(result.consumed).toBe(1100);
  });

  it("trips on maxCostUsd", () => {
    const usage = new UsageTracker();
    usage.record("cloud", "gpt-oss:120b", 1_000_000, 0, 1);
    const cost = new CostTracker(usage, { "gpt-oss:120b": { inputPerMillion: 5, outputPerMillion: 5 } });
    const budget = new BudgetManager({ maxCostUsd: 1 });

    const result = budget.check(usage, cost);
    expect(result.exceeded).toBe(true);
    expect(result.dimension).toBe("cost");
    expect(result.consumed).toBe(5);
  });

  it("does not trip on maxCostUsd when no pricing is configured (treated as $0 spent)", () => {
    const usage = new UsageTracker();
    usage.record("local", "a", 1_000_000_000, 0, 1);
    const cost = new CostTracker(usage);
    const budget = new BudgetManager({ maxCostUsd: 0.01 });

    expect(budget.check(usage, cost)).toEqual({ exceeded: false });
  });

  it("checks calls before tokens before cost, reporting the first breach", () => {
    const usage = new UsageTracker();
    usage.record("local", "a", 10_000, 10_000, 1);
    const cost = new CostTracker(usage, { a: { inputPerMillion: 100, outputPerMillion: 100 } });
    const budget = new BudgetManager({ maxCalls: 1, maxTokens: 1, maxCostUsd: 0.0001 });

    expect(budget.check(usage, cost).dimension).toBe("calls");
  });
});
