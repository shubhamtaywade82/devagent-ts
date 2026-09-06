import { TaskExecutionResult } from "../../src/evolution/evaluator.js";
import { FixedExecutorMatrix, ExecutorArm, ratesFor } from "../../src/evolution/evaluation/fixed-executor.js";

function result(taskId: string, success: boolean, isHeldOut = false): TaskExecutionResult {
  return {
    taskId,
    success,
    verificationPassed: success,
    toolCalls: 3,
    toolErrors: success ? 0 : 1,
    tokens: 1000,
    latencyMs: 500,
    loopAborted: false,
    isHeldOut,
  };
}

describe("FixedExecutorMatrix", () => {
  const h0 = {
    qwen: [result("v1", true), result("v2", true), result("h1", false, true), result("h2", false, true)],
    gemini: [result("v1", true), result("v2", false), result("h1", false, true), result("h2", false, true)],
  };
  const h1 = {
    qwen: [result("v1", true), result("v2", true), result("h1", true, true), result("h2", true, true)],
    gemini: [result("v1", true), result("v2", true), result("h1", true, true), result("h2", false, true)],
  };

  const arms: ExecutorArm[] = [
    { model: "qwen", run: () => [] },
    { model: "gemini", run: () => [] },
  ];

  it("rates visible and held-out splits independently", () => {
    const visible = ratesFor(h0.qwen, "visible");
    expect(visible.taskSuccessRate).toBe(1);
    const held = ratesFor(h0.qwen, "held_out");
    expect(held.taskSuccessRate).toBe(0);
    expect(held.runs).toBe(2);
  });

  it("builds the harness × executor matrix with frozen executors", async () => {
    const cells = await FixedExecutorMatrix.build(["H0", "H1"], arms, {
      H0: h0,
      H1: h1,
    });
    // 2 harnesses × 2 executors × 2 splits = 8 cells
    expect(cells).toHaveLength(8);
    const qwenHeld = cells.find((c) => c.harnessId === "H1" && c.executorModel === "qwen" && c.split === "held_out")!;
    expect(qwenHeld.taskSuccessRate).toBe(1);
  });

  it("heldOutSeries freezes the executor and compares harness versions", async () => {
    const cells = await FixedExecutorMatrix.build(["H0", "H1"], arms, { H0: h0, H1: h1 });
    const series = FixedExecutorMatrix.heldOutSeries(cells, "qwen");
    // Under the frozen qwen executor, H1 improves held-out 0 → 1.
    expect(series.get("H0")).toBe(0);
    expect(series.get("H1")).toBe(1);
  });

  it("computes direction agreement across executors (research metric)", async () => {
    const cells = await FixedExecutorMatrix.build(["H0", "H1"], arms, { H0: h0, H1: h1 });
    const { agreementRate, perExecutor } = FixedExecutorMatrix.directionAgreement(cells, "H0", "H1");
    // Both qwen and gemini improved on held-out → full agreement.
    expect(agreementRate).toBe(1);
    expect(perExecutor["qwen"]).toBeCloseTo(1);
    expect(perExecutor["gemini"]).toBeCloseTo(0.5);
  });

  it("detects disagreement when an improvement is executor-specific", async () => {
    const h1executorSpecific = {
      qwen: [result("v1", true), result("h1", true, true), result("h2", true, true)],
      gemini: [result("v1", false), result("h1", false, true), result("h2", false, true)],
    };
    const cells = await FixedExecutorMatrix.build(["H0", "H1"], arms, {
      H0: h0,
      H1: h1executorSpecific,
    });
    const { agreementRate } = FixedExecutorMatrix.directionAgreement(cells, "H0", "H1");
    // Only qwen improves; gemini regresses → 0.5 agreement = noisy improvement.
    expect(agreementRate).toBeCloseTo(0.5);
  });
});
