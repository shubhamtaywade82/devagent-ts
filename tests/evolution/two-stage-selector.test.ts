import { TwoStageSelector, DEFAULT_THRESHOLDS } from "../../src/evolution/comparison/two-stage-selector.js";
import { EvaluationMetrics } from "../../src/evolution/types.js";

function metrics(over: {
  success?: number;
  verification?: number;
  toolError?: number;
  falseSuccess?: number;
  loopAbort?: number;
  tokens?: number;
  heldOut?: number;
  transfer?: number;
}): EvaluationMetrics {
  return {
    capability: {
      taskSuccessRate: over.success ?? 0.8,
      verificationPassRate: over.verification ?? 0.8,
    },
    reliability: {
      toolErrorRate: over.toolError ?? 0.1,
      falseSuccessRate: over.falseSuccess ?? 0.05,
      loopAbortRate: over.loopAbort ?? 0.05,
    },
    efficiency: {
      avgTokens: over.tokens ?? 1000,
      avgLatencyMs: 500,
    },
    generalization: {
      heldOutScore: over.heldOut ?? 0.8,
      transferScore: over.transfer ?? 0.8,
    },
  };
}

const VALID_EXPERIMENT = {
  completedRuns: 6,
  verifierCoveredRuns: 6,
  verifierCoverage: 1.0,
  catastrophicRegression: false,
};

describe("TwoStageSelector", () => {
  const selector = new TwoStageSelector();

  it("Stage A rejects experiments with insufficient sample size BEFORE improvement is judged", () => {
    const result = selector.evaluate({
      candidateId: "H1",
      baselineId: "H0",
      candidateMetrics: metrics({ success: 0.95 }),
      baselineMetrics: metrics({}),
      validity: { ...VALID_EXPERIMENT, completedRuns: 2, verifierCoverage: 0 },
    });
    expect(result.decision).toBe("rejected");
    expect(result.stageA.decision).toBe("invalid");
    expect(result.stageB).toBeNull();
    expect(result.stageA.checks.find((c) => c.check === "sample_size_sufficient")?.passed).toBe(false);
  });

  it("Stage A rejects experiments without verifier evidence", () => {
    const result = selector.evaluate({
      candidateId: "H1",
      baselineId: "H0",
      candidateMetrics: metrics({}),
      baselineMetrics: metrics({}),
      validity: { ...VALID_EXPERIMENT, verifierCoveredRuns: 0, verifierCoverage: 0 },
    });
    expect(result.decision).toBe("rejected");
    expect(result.stageA.checks.find((c) => c.check === "verifier_evidence_valid")?.passed).toBe(false);
  });

  it("Stage A rejects catastrophic regressions", () => {
    const result = selector.evaluate({
      candidateId: "H1",
      baselineId: "H0",
      candidateMetrics: metrics({ success: 0.5, toolError: 0.4 }),
      baselineMetrics: metrics({}),
      validity: { ...VALID_EXPERIMENT, catastrophicRegression: true },
    });
    expect(result.decision).toBe("rejected");
    expect(result.rationale).toContain("Stage A");
  });

  it("eligible: valid experiment + genuine held-out improvement", () => {
    const result = selector.evaluate({
      candidateId: "H1",
      baselineId: "H0",
      candidateMetrics: metrics({
        success: 0.9,
        verification: 0.9,
        toolError: 0.05,
        falseSuccess: 0.02,
        heldOut: 0.9,
        transfer: 0.9,
      }),
      baselineMetrics: metrics({}),
      validity: VALID_EXPERIMENT,
    });
    expect(result.stageA.decision).toBe("valid");
    expect(result.stageB?.decision).toBe("improved");
    expect(result.decision).toBe("eligible");
  });

  it("inconclusive: valid experiment but held-out regression blocks promotion", () => {
    const result = selector.evaluate({
      candidateId: "H1",
      baselineId: "H0",
      // Capability improves on visible but held-out drops → NOT promotable.
      candidateMetrics: metrics({ success: 0.95, heldOut: 0.6 }),
      baselineMetrics: metrics({ heldOut: 0.8 }),
      validity: VALID_EXPERIMENT,
      heldOutGain: -0.2,
    });
    expect(result.stageA.decision).toBe("valid");
    expect(result.stageB?.decision).toBe("not_improved");
    expect(result.decision).toBe("inconclusive");
    expect(result.stageB?.checks.find((c) => c.check === "held_out_improvement")?.passed).toBe(false);
  });

  it("inconclusive: excessive token overhead blocks promotion", () => {
    const result = selector.evaluate({
      candidateId: "H1",
      baselineId: "H0",
      candidateMetrics: metrics({ success: 0.9, tokens: 2000 }),
      baselineMetrics: metrics({ tokens: 1000 }),
      validity: VALID_EXPERIMENT,
    });
    expect(result.decision).toBe("inconclusive");
    expect(result.stageB?.checks.find((c) => c.check === "acceptable_cost")?.passed).toBe(false);
  });

  it("exposes explicit Stage A checks for the experiment audit trail", () => {
    const result = selector.evaluate({
      candidateId: "H1",
      baselineId: "H0",
      candidateMetrics: metrics({}),
      baselineMetrics: metrics({}),
      validity: VALID_EXPERIMENT,
    });
    const checkNames = result.stageA.checks.map((c) => c.check);
    expect(checkNames).toEqual([
      "candidate_runs_completed",
      "verifier_coverage_sufficient",
      "verifier_evidence_valid",
      "no_catastrophic_regressions",
      "sample_size_sufficient",
    ]);
  });

  it("supports threshold overrides for stricter loops", () => {
    const strict = new TwoStageSelector({ minCapabilityGain: 0.2 });
    const result = strict.evaluate({
      candidateId: "H1",
      baselineId: "H0",
      candidateMetrics: metrics({ success: 0.85 }),
      baselineMetrics: metrics({ success: 0.8 }),
      validity: VALID_EXPERIMENT,
    });
    expect(result.decision).toBe("inconclusive");
  });

  it("documents default thresholds from the research methodology", () => {
    expect(DEFAULT_THRESHOLDS.minSampleSize).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_THRESHOLDS.catastrophicRegressionThreshold).toBeGreaterThan(0.1);
  });
});
