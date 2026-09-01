import { BudgetExhaustedError } from "./errors.js";
import { UsageTracker } from "./usage.js";
import { CostTracker } from "./cost.js";

export interface BudgetLimits {
  maxCostUsd?: number;
  maxTokens?: number;
  maxCalls?: number;
}

export interface BudgetCheckResult {
  exceeded: boolean;
  dimension?: "cost" | "tokens" | "calls";
  consumed?: number;
  limit?: number;
}

/**
 * Session-level spend/usage guard. Every limit is optional and unset by
 * default — a BudgetManager with no limits configured never trips, matching
 * this codebase's honest-default convention (cost tracking is off unless
 * the user supplies real numbers).
 *
 * Checked at loop-iteration boundaries (see Agent.runUserMessage's toolTurn
 * loop), the same place maxToolTurns is enforced — this is a between-calls
 * guard, not a mid-call preemption, since token/cost totals for the current
 * call aren't known until it returns.
 */
export class BudgetManager {
  constructor(private readonly limits: BudgetLimits) {}

  check(usage: UsageTracker, cost: CostTracker): BudgetCheckResult {
    const totals = usage.totals();

    if (this.limits.maxCalls !== undefined && totals.calls >= this.limits.maxCalls) {
      return { exceeded: true, dimension: "calls", consumed: totals.calls, limit: this.limits.maxCalls };
    }

    const totalTokens = totals.promptTokens + totals.completionTokens;
    if (this.limits.maxTokens !== undefined && totalTokens >= this.limits.maxTokens) {
      return { exceeded: true, dimension: "tokens", consumed: totalTokens, limit: this.limits.maxTokens };
    }

    if (this.limits.maxCostUsd !== undefined) {
      const totalCost = cost.totalCostUsd() ?? 0;
      if (totalCost >= this.limits.maxCostUsd) {
        return { exceeded: true, dimension: "cost", consumed: totalCost, limit: this.limits.maxCostUsd };
      }
    }

    return { exceeded: false };
  }

  assertWithinBudget(usage: UsageTracker, cost: CostTracker): void {
    const result = this.check(usage, cost);
    if (result.exceeded) {
      throw new BudgetExhaustedError(result.dimension!, result.consumed!, result.limit!);
    }
  }
}
