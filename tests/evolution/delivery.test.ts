import { formatEvolutionCommit, formatPrBody, GitDeliveryEngine } from "@nemesis-oss/nexum-devagent/evolution/delivery";
import { ComparisonResult, HarnessHypothesis, HarnessVersion } from "@nemesis-oss/nexum-devagent/evolution/types";

describe("GitDeliveryEngine", () => {
  const version: HarnessVersion = {
    id: "H1",
    commitSha: "c1a2b3",
    parentId: "H0",
    createdAt: 1000,
    targetComponent: "verification",
    hypothesis: "Mandatory verification pass reduces false successes",
    metrics: {
      capability: { taskSuccessRate: 0.8, verificationPassRate: 0.8 },
      reliability: { toolErrorRate: 0.05, falseSuccessRate: 0.04, loopAbortRate: 0.01 },
      efficiency: { avgTokens: 11000, avgLatencyMs: 3200 },
      generalization: { heldOutScore: 0.75, transferScore: 0.7 },
    },
    status: "promoted",
  };

  const hypothesis: HarnessHypothesis = {
    id: "hyp-1",
    targetComponent: "verification",
    statement: "Mandatory verification prevents premature task completion",
    predictedEffect: "capability +8.0%",
    evaluationPlan: "Run regression and held-out benchmark",
    createdAt: 950,
  };

  const comparison: ComparisonResult = {
    candidateId: "H1",
    baselineId: "H0",
    decision: "promote",
    scoreDeltas: {
      capability: 0.08,
      reliability: 0.12,
      efficiency: -0.04,
      generalization: 0.05,
    },
    rationale: "Promoted: capability delta +8.0%, reliability delta +12.0%",
  };

  it("formats structured commit message with evaluation deltas", () => {
    const commit = formatEvolutionCommit(version, comparison);
    expect(commit).toContain("feat(evolution): promote verification harness mutation (H1)");
    expect(commit).toContain("Capability: +8.0%");
    expect(commit).toContain("Reliability: +12.0%");
    expect(commit).toContain("Decision: PROMOTE");
  });

  it("formats GitHub PR body with complete evidence table", () => {
    const prBody = formatPrBody({ version, hypothesis, comparison });
    expect(prBody).toContain("## Nexum Harness Evolution — Promoted Mutation `H1`");
    expect(prBody).toContain("| **Capability** | `+8.0%` |");
    expect(prBody).toContain("| **Reliability** | `+12.0%` |");
    expect(prBody).toContain("- **Candidate Commit:** `c1a2b3`");
  });

  it("prepares full delivery report", () => {
    const engine = new GitDeliveryEngine();
    const report = engine.prepareDelivery({ version, hypothesis, comparison });
    expect(report.branchName).toBe("evolution/h1-verification");
    expect(report.prTitle).toContain("[H1]");
    expect(report.commitMessage).toBeDefined();
    expect(report.prBody).toBeDefined();
  });
});
