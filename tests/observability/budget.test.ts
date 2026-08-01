import { createTokenBudget, recordUsage, totalUsed, isBudgetExceeded } from "../../src/observability/budget.js";

describe("Observability - Token Budget", () => {
  it("tracks token input and output usage correctly", () => {
    const budget = createTokenBudget(1000);
    recordUsage(budget, 200, 300);

    expect(budget.usedInput).toBe(200);
    expect(budget.usedOutput).toBe(300);
    expect(totalUsed(budget)).toBe(500);
    expect(isBudgetExceeded(budget)).toBe(false);
  });

  it("detects when token budget limit is exceeded", () => {
    const budget = createTokenBudget(500);
    recordUsage(budget, 300, 300);

    expect(isBudgetExceeded(budget)).toBe(true);
  });

  it("returns false for unlimited budget (limit <= 0)", () => {
    const budget = createTokenBudget(0);
    recordUsage(budget, 1000, 1000);

    expect(isBudgetExceeded(budget)).toBe(false);
  });
});
