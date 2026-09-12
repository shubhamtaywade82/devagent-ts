import {
  BudgetTracker,
  CostBudgetError,
  ModelCallBudgetError,
  TokenBudgetError,
  ToolCallBudgetError,
  WallClockBudgetError,
} from "../../src/runtime/budget/budget-tracker.js";
import { ExecutionBudget } from "../../src/core/types.js";
import { GateRegistry } from "../../src/core/concurrency/gate-registry.js";
import { ConcurrencyGate } from "../../src/core/concurrency/gate.js";

describe("BudgetTracker", () => {
  const budget = (b: ExecutionBudget) => new BudgetTracker({ runId: "r", sessionId: "s", budget: b });

  it("tracks tool calls and throws past the ceiling", () => {
    const t = budget({ maxToolCalls: 2 });
    t.consumeToolCall();
    t.consumeToolCall();
    expect(() => t.consumeToolCall()).toThrow(ToolCallBudgetError);
    expect(t.snapshot().toolCalls).toBe(3);
  });

  it("tracks model calls and token totals", () => {
    const t = budget({ maxModelCalls: 2, maxTotalTokens: 200 });
    t.consumeModelCall({ promptTokens: 40, completionTokens: 20 });
    t.consumeModelCall({ promptTokens: 30, completionTokens: 20 });
    expect(() => t.consumeModelCall({ promptTokens: 10 })).toThrow(ModelCallBudgetError);
    expect(t.snapshot().totalTokens).toBe(110); // third call threw before recording tokens
  });

  it("throws TokenBudgetError independently of call count", () => {
    const t = budget({ maxTotalTokens: 50 });
    expect(() => t.consumeModelCall({ promptTokens: 60 })).toThrow(TokenBudgetError);
  });

  it("accumulates cost and enforces the ceiling", () => {
    const t = budget({ maxCostUsd: 1 });
    t.consumeModelCall({ costUsd: 0.4 });
    t.consumeModelCall({ costUsd: 0.4 });
    expect(() => t.consumeModelCall({ costUsd: 0.4 })).toThrow(CostBudgetError);
    expect(t.snapshot().costUsd).toBeCloseTo(1.2, 5);
  });

  it("enforces wall-clock deadlines via assertTimeLeft", () => {
    let now = 0;
    const t = new BudgetTracker({ budget: { deadlineMs: 100 }, now: () => now });
    t.assertTimeLeft();
    now = 150;
    expect(() => t.assertTimeLeft()).toThrow(WallClockBudgetError);
    expect(t.elapsedMs).toBe(150);
  });

  it("is unrestricted when no budget dimensions are set", () => {
    const t = budget({});
    for (let i = 0; i < 100; i++) t.consumeToolCall();
    t.consumeModelCall({ promptTokens: 10_000_000 });
    t.assertTimeLeft();
    expect(t.snapshot().modelCalls).toBe(1);
  });
});

describe("GateRegistry", () => {
  it("creates gates lazily per scope+key with scope defaults", async () => {
    const registry = new GateRegistry();
    const seen: number[] = [];
    await Promise.all(
      Array.from({ length: 6 }, () =>
        registry.run("domain", "trading", async () => {
          seen.push(1);
          await new Promise((r) => setTimeout(r, 10));
        }),
      ),
    );
    expect(seen).toHaveLength(6);
    const snapshot = registry.snapshot().find((g) => g.scope === "domain" && g.key === "trading");
    expect(snapshot?.maxConcurrent).toBe(1); // domain default: strictly serialized
  });

  it("respects configured defaults", () => {
    const registry = new GateRegistry({ defaults: { model: 2 } });
    const gate = registry.gate("model", "local");
    expect(gate.maxConcurrent).toBe(2);
    expect(gate.label).toBe("model:local");
  });

  it("reuses the same gate instance per scope+key", () => {
    const registry = new GateRegistry();
    expect(registry.gate("agent", "devagent")).toBe(registry.gate("agent", "devagent"));
  });

  it("wraps a ConcurrencyGate-compatible primitive", async () => {
    const registry = new GateRegistry();
    expect(registry.gate("global")).toBeInstanceOf(ConcurrencyGate);
    await expect(registry.run("global", "default", async () => 42)).resolves.toBe(42);
  });
});
