import { formulateHypothesis } from "@nemesis-oss/nexum-devagent/evolution/hypothesis";
import { EvolutionPlanner } from "@nemesis-oss/nexum-devagent/evolution/planner";
import { HarnessDiagnosis } from "@nemesis-oss/nexum-devagent/evolution/types";

describe("EvolutionPlanner & Hypothesis", () => {
  const diagnosis: HarnessDiagnosis = {
    failureClass: "premature_completion",
    component: "verification",
    evidence: [{ type: "test", summary: "Tests failed" }],
    confidence: 0.95,
    rootCause: "Task declared finished without tests passing",
    proposedFix: "Enforce verification pass before completion",
    expectedImpact: { capability: 0.1, reliability: 0.2, cost: 0.05 },
  };

  it("formulates hypothesis from diagnosis", () => {
    const hyp = formulateHypothesis(diagnosis);
    expect(hyp.targetComponent).toBe("verification");
    expect(hyp.statement).toContain("Modifying verification");
    expect(hyp.predictedEffect).toContain("capability delta: +10.0%");
  });

  it("creates plan selecting highest-confidence component", () => {
    const planner = new EvolutionPlanner();
    const plan = planner.createPlan([diagnosis]);
    expect(plan).not.toBeNull();
    expect(plan!.targetComponent).toBe("verification");
    expect(plan!.diagnosesCount).toBe(1);
    expect(plan!.recommendedBenchmarkCategories).toContain("tool-calling");
  });

  it("returns null when diagnoses array is empty", () => {
    const planner = new EvolutionPlanner();
    expect(planner.createPlan([])).toBeNull();
  });
});
