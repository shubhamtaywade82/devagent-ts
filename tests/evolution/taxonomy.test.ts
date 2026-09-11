import { classifyFailure, TaxonomySignals } from "@nemesis-oss/nexum-devagent/evolution/taxonomy";

describe("Failure Taxonomy", () => {
  it("classifies premature completion when tests fail but agent answered", () => {
    const signals: TaxonomySignals = {
      terminal: "answered",
      testsRan: true,
      testsPassed: false,
      toolErrorRate: 0,
      retriedSameToolMax: 0,
      loopAborted: false,
      turnCount: 5,
    };
    const res = classifyFailure(signals);
    expect(res.failureClass).toBe("premature_completion");
    expect(res.component).toBe("verification");
    expect(res.confidence).toBeGreaterThan(0.9);
  });

  it("classifies verification gap when files modified without running tests", () => {
    const signals: TaxonomySignals = {
      terminal: "answered",
      testsRan: false,
      testsPassed: null,
      toolErrorRate: 0,
      retriedSameToolMax: 0,
      loopAborted: false,
      turnCount: 4,
      filesModified: 3,
    };
    const res = classifyFailure(signals);
    expect(res.failureClass).toBe("verification_gap");
    expect(res.component).toBe("verification");
  });

  it("classifies loop failure on loop_abort", () => {
    const signals: TaxonomySignals = {
      terminal: "loop_abort",
      testsRan: false,
      testsPassed: null,
      toolErrorRate: 0.1,
      retriedSameToolMax: 2,
      loopAborted: true,
      turnCount: 8,
    };
    const res = classifyFailure(signals);
    expect(res.failureClass).toBe("loop_failure");
    expect(res.component).toBe("execution");
  });

  it("classifies retry failure on high repeated tool retries", () => {
    const signals: TaxonomySignals = {
      terminal: "error",
      testsRan: false,
      testsPassed: null,
      toolErrorRate: 0.3,
      retriedSameToolMax: 4,
      loopAborted: false,
      turnCount: 6,
    };
    const res = classifyFailure(signals);
    expect(res.failureClass).toBe("retry_failure");
    expect(res.component).toBe("lifecycle");
  });

  it("classifies tool argument errors on high error rate with argument label", () => {
    const signals: TaxonomySignals = {
      terminal: "error",
      testsRan: false,
      testsPassed: null,
      toolErrorRate: 0.5,
      retriedSameToolMax: 1,
      loopAborted: false,
      turnCount: 4,
      lastErrorLabel: "ArgumentError: missing path",
    };
    const res = classifyFailure(signals);
    expect(res.failureClass).toBe("tool_argument_error");
    expect(res.component).toBe("tools");
  });

  it("classifies context overflow on turn budget ceiling", () => {
    const signals: TaxonomySignals = {
      terminal: "turn_budget",
      testsRan: false,
      testsPassed: null,
      toolErrorRate: 0.1,
      retriedSameToolMax: 1,
      loopAborted: false,
      turnCount: 30,
    };
    const res = classifyFailure(signals);
    expect(res.failureClass).toBe("context_overflow");
    expect(res.component).toBe("context");
  });
});
