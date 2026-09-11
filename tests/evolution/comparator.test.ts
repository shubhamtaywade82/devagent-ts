import { CandidateComparator, computeDeltas } from "@nemesis-oss/nexum-devagent/evolution/comparator";
import { EvaluationMetrics } from "@nemesis-oss/nexum-devagent/evolution/types";

const baselineMetrics: EvaluationMetrics = {
  capability: { taskSuccessRate: 0.7, verificationPassRate: 0.7 },
  reliability: { toolErrorRate: 0.1, falseSuccessRate: 0.1, loopAbortRate: 0.05 },
  efficiency: { avgTokens: 10000, avgLatencyMs: 3000 },
  generalization: { heldOutScore: 0.68, transferScore: 0.65 },
};

describe("CandidateComparator", () => {
  const comparator = new CandidateComparator();

  it("computes accurate dimensional deltas", () => {
    const candidateMetrics: EvaluationMetrics = {
      capability: { taskSuccessRate: 0.8, verificationPassRate: 0.8 },
      reliability: { toolErrorRate: 0.05, falseSuccessRate: 0.05, loopAbortRate: 0.02 },
      efficiency: { avgTokens: 11000, avgLatencyMs: 3200 },
      generalization: { heldOutScore: 0.72, transferScore: 0.7 },
    };

    const deltas = computeDeltas(candidateMetrics, baselineMetrics);
    expect(deltas.capability).toBeCloseTo(0.1);
    expect(deltas.reliability).toBeGreaterThan(0);
    expect(deltas.efficiency).toBeCloseTo(-0.1); // 10% more tokens
  });

  it("promotes candidate with significant capability gain and acceptable cost", () => {
    const candidateMetrics: EvaluationMetrics = {
      capability: { taskSuccessRate: 0.78, verificationPassRate: 0.78 },
      reliability: { toolErrorRate: 0.08, falseSuccessRate: 0.08, loopAbortRate: 0.04 },
      efficiency: { avgTokens: 10500, avgLatencyMs: 3100 },
      generalization: { heldOutScore: 0.7, transferScore: 0.67 },
    };

    const result = comparator.compare("H1", candidateMetrics, "H0", baselineMetrics);
    expect(result.decision).toBe("promote");
    expect(result.rationale).toContain("Promoted");
  });

  it("rejects candidate when reliability regresses", () => {
    const candidateMetrics: EvaluationMetrics = {
      capability: { taskSuccessRate: 0.85, verificationPassRate: 0.85 },
      reliability: { toolErrorRate: 0.25, falseSuccessRate: 0.25, loopAbortRate: 0.15 }, // worse reliability
      efficiency: { avgTokens: 10000, avgLatencyMs: 3000 },
      generalization: { heldOutScore: 0.7, transferScore: 0.65 },
    };

    const result = comparator.compare("H1", candidateMetrics, "H0", baselineMetrics);
    expect(result.decision).toBe("reject");
    expect(result.rationale).toContain("reliability regression");
  });

  it("rejects candidate when held-out generalization drops", () => {
    const candidateMetrics: EvaluationMetrics = {
      capability: { taskSuccessRate: 0.9, verificationPassRate: 0.9 }, // overfitted
      reliability: { toolErrorRate: 0.05, falseSuccessRate: 0.05, loopAbortRate: 0.02 },
      efficiency: { avgTokens: 10000, avgLatencyMs: 3000 },
      generalization: { heldOutScore: 0.55, transferScore: 0.5 }, // dropped
    };

    const result = comparator.compare("H1", candidateMetrics, "H0", baselineMetrics);
    expect(result.decision).toBe("reject");
    expect(result.rationale).toContain("generalization regression");
  });
});
