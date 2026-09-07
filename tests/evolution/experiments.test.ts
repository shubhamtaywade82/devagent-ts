import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExperimentController, StartExperimentInput } from "../../src/evolution/experiments/experiment-controller.js";
import { ExperimentStore } from "../../src/evolution/experiments/experiment-store.js";
import { validateExperimentRecord } from "../../src/evolution/experiments/experiment-schema.js";
import { formatExperimentProvenanceYaml, renderYaml } from "../../src/evolution/experiments/provenance.js";
import { GitDeliveryEngine } from "../../src/evolution/delivery.js";
import { ComparisonResult, HarnessHypothesis } from "../../src/evolution/types.js";

function startInput(over: Partial<StartExperimentInput> = {}): StartExperimentInput {
  return {
    id: "exp-00142",
    parentHarness: "H17",
    parentCommit: "abc123",
    candidateHarness: "H18",
    candidateCommit: "def456",
    targetId: "target-tool_utilization-1",
    targetCapability: "tool_utilization",
    desiredOutcome: "Tool error rate drops while efficiency stays flat",
    hypothesisId: "hyp-tools-1",
    hypothesisStatement: "Pruning tool schemas reduces tool error rate",
    predictedEffect: "capability +6%, reliability +10%",
    executorPrimary: "qwen3-coder",
    executorTransfer: ["gemini-2.5", "claude-x"],
    ...over,
  };
}

function comparison(): ComparisonResult {
  return {
    candidateId: "H18",
    baselineId: "H17",
    decision: "promote",
    scoreDeltas: { capability: 0.06, reliability: 0.1, efficiency: 0.02, generalization: 0.04 },
    rationale: "Valid experiment with genuine improvement",
  };
}

function hypothesis(): HarnessHypothesis {
  return {
    id: "hyp-tools-1",
    targetComponent: "tools",
    statement: "Pruning tool schemas reduces tool error rate",
    predictedEffect: "reliability +10%",
    evaluationPlan: "tool-calling suite",
    createdAt: Date.now(),
  };
}

describe("ExperimentController lifecycle", () => {
  it("starts an experiment at CANDIDATE after OBSERVED→…→CANDIDATE", () => {
    const controller = new ExperimentController();
    const { record, state } = controller.startExperiment(startInput());
    expect(state).toBe("CANDIDATE");
    expect(record.parent).toEqual({ harness: "H17", commit: "abc123" });
    expect(record.candidate).toEqual({ harness: "H18", commit: "def456" });
    expect(record.executor).toEqual({ primary: "qwen3-coder", transfer: ["gemini-2.5", "claude-x"] });
    expect(validateExperimentRecord(record)).toEqual([]);
  });

  it("advances through the full scientific path to ACTIVE", () => {
    const controller = new ExperimentController();
    controller.startExperiment(startInput());
    controller.advance("exp-00142", "EVALUATING");
    controller.advance("exp-00142", "VALIDATED", "two-stage passed");
    controller.advance("exp-00142", "GENERALIZED", "held-out verified");
    controller.advance("exp-00142", "ELIGIBLE");
    controller.advance("exp-00142", "DELIVERED", "PR prepared");
    controller.advance("exp-00142", "CI_PENDING", "CI started");
    controller.advance("exp-00142", "CI_PASSED", "CI green");
    controller.advance("exp-00142", "REVIEW_PENDING", "awaiting review");
    controller.advance("exp-00142", "APPROVED", "review approved");
    controller.advance("exp-00142", "ACCEPTED", "acceptance finalized");
    controller.advance("exp-00142", "ACTIVE");
    expect(controller.record("exp-00142").lifecycle.state).toBe("ACTIVE");
    const counts = controller.acceptanceCounts();
    expect(counts.accepted).toBe(1);
    expect(counts.eligible).toBe(1);
  });

  it("routes CI failure through DELIVERED → CI_PENDING → CI_FAILED → CANDIDATE recovery", () => {
    const controller = new ExperimentController();
    controller.startExperiment(startInput());
    controller.advance("exp-00142", "EVALUATING");
    controller.advance("exp-00142", "VALIDATED");
    controller.advance("exp-00142", "GENERALIZED");
    controller.advance("exp-00142", "ELIGIBLE");
    controller.advance("exp-00142", "DELIVERED");
    controller.reportCiResult("exp-00142", "failed", "https://ci/run/1");
    expect(controller.record("exp-00142").lifecycle.state).toBe("CI_FAILED");
    expect(controller.record("exp-00142").ci.status).toBe("failed");
    controller.advance("exp-00142", "CANDIDATE", "rework");
    expect(controller.machine("exp-00142").current()).toBe("CANDIDATE");
  });

  it("a passing CI verdict ALWAYS advances the lifecycle: → CI_PASSED → REVIEW_PENDING", () => {
    const controller = new ExperimentController();
    controller.startExperiment(startInput());
    controller.advance("exp-00142", "EVALUATING");
    controller.advance("exp-00142", "VALIDATED");
    controller.advance("exp-00142", "GENERALIZED");
    controller.advance("exp-00142", "ELIGIBLE");
    controller.advance("exp-00142", "DELIVERED");
    controller.reportCiResult("exp-00142", "passed", "https://ci/run/2");
    // The v2.0 bug (CI pass leaving the lifecycle parked at DELIVERED) is fixed.
    expect(controller.record("exp-00142").lifecycle.state).toBe("REVIEW_PENDING");
    expect(controller.record("exp-00142").ci.status).toBe("passed");
  });

  it("routes review changes-requested through the failure path from REVIEW_PENDING", () => {
    const controller = new ExperimentController();
    controller.startExperiment(startInput());
    controller.advance("exp-00142", "EVALUATING");
    controller.advance("exp-00142", "VALIDATED");
    controller.advance("exp-00142", "GENERALIZED");
    controller.advance("exp-00142", "ELIGIBLE");
    controller.advance("exp-00142", "DELIVERED");
    controller.advance("exp-00142", "CI_PENDING");
    controller.advance("exp-00142", "CI_PASSED");
    controller.advance("exp-00142", "REVIEW_PENDING");
    controller.reportReviewOutcome("exp-00142", "changes_requested", "reviewer-a");
    expect(controller.record("exp-00142").lifecycle.state).toBe("CHANGES_REQUESTED");
  });

  it("routes review approval to APPROVED, ready for finalizeAcceptance", () => {
    const controller = new ExperimentController();
    controller.startExperiment(startInput());
    controller.advance("exp-00142", "EVALUATING");
    controller.advance("exp-00142", "VALIDATED");
    controller.advance("exp-00142", "GENERALIZED");
    controller.advance("exp-00142", "ELIGIBLE");
    controller.advance("exp-00142", "DELIVERED");
    controller.advance("exp-00142", "CI_PENDING");
    controller.advance("exp-00142", "CI_PASSED");
    controller.advance("exp-00142", "REVIEW_PENDING");
    controller.reportReviewOutcome("exp-00142", "approved", "reviewer-b");
    expect(controller.record("exp-00142").lifecycle.state).toBe("APPROVED");
  });

  it("handles the post-deployment regression path ACTIVE → REGRESSED → ROLLBACK", () => {
    const controller = new ExperimentController();
    controller.startExperiment(startInput());
    // Walk the full happy path to ACTIVE first — regression monitoring only
    // applies once the candidate is live.
    controller.advance("exp-00142", "EVALUATING");
    controller.advance("exp-00142", "VALIDATED");
    controller.advance("exp-00142", "GENERALIZED");
    controller.advance("exp-00142", "ELIGIBLE");
    controller.advance("exp-00142", "DELIVERED");
    controller.advance("exp-00142", "CI_PENDING");
    controller.advance("exp-00142", "CI_PASSED");
    controller.advance("exp-00142", "REVIEW_PENDING");
    controller.advance("exp-00142", "APPROVED");
    controller.advance("exp-00142", "ACCEPTED");
    controller.advance("exp-00142", "ACTIVE");

    controller.reportRegression("exp-00142", "held-out success dropped 8% after deploy");
    expect(controller.record("exp-00142").lifecycle.state).toBe("REGRESSED");
    controller.completeRollback("exp-00142", "H17");
    expect(controller.record("exp-00142").lifecycle.state).toBe("ROLLBACK");
  });

  it("persists provenance records in the store", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "experiment-store-"));
    const store = new ExperimentStore(join(tmpDir, "experiments.db"));
    const controller = new ExperimentController({ store });
    controller.startExperiment(startInput());
    const loaded = store.get("exp-00142");
    expect(loaded).not.toBeNull();
    expect(loaded!.parent.harness).toBe("H17");
    expect(store.listByLifecycleState("CANDIDATE")).toHaveLength(1);
    expect(store.count()).toBe(1);
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("Experiment provenance YAML", () => {
  it("renders the full experiment record as the specified YAML schema", () => {
    const controller = new ExperimentController();
    controller.startExperiment(startInput());
    const record = controller.record("exp-00142");
    const yaml = formatExperimentProvenanceYaml(record);

    expect(yaml).toContain("experiment:");
    expect(yaml).toContain("id: exp-00142");
    expect(yaml).toContain("harness: H17");
    expect(yaml).toContain("commit: abc123");
    expect(yaml).toContain("harness: H18");
    expect(yaml).toContain("commit: def456");
    expect(yaml).toContain("capability: tool_utilization");
    expect(yaml).toContain("primary: qwen3-coder");
    expect(yaml).toContain("gemini-2.5");
    expect(yaml).toContain("visible:");
    expect(yaml).toContain("held_out:");
    expect(yaml).toContain("transfer:");
    expect(yaml).toContain("generalization:");
    expect(yaml).toContain("result: inconclusive");
    expect(yaml).toContain("status: pending");
    expect(yaml).toContain("state: pending");
    expect(yaml).toContain("state: CANDIDATE");
  });

  it("quotes strings that would be ambiguous YAML scalars", () => {
    expect(renderYaml({ s: "true" })).toBe('s: "true"');
    expect(renderYaml({ s: "plain" })).toBe("s: plain");
    expect(renderYaml({ s: "with: colon" })).toBe('s: "with: colon"');
    expect(renderYaml({ n: 42 })).toBe("n: 42");
    expect(renderYaml({ b: true })).toBe("b: true");
    expect(renderYaml([])).toBe("[]");
    expect(renderYaml({})).toBe("{}");
  });
});

describe("GitDeliveryEngine.prepareExperimentDelivery", () => {
  it("embeds the machine-readable provenance block into the PR body", () => {
    const controller = new ExperimentController();
    controller.startExperiment(startInput());
    const record = controller.record("exp-00142");
    const delivery = new GitDeliveryEngine().prepareExperimentDelivery(record, comparison(), hypothesis());

    expect(delivery.branchName).toContain("evolution/");
    expect(delivery.prBody).toContain("### 4. Experiment Provenance (machine-readable)");
    expect(delivery.prBody).toContain("```yaml");
    expect(delivery.prBody).toContain("id: exp-00142");
    expect(delivery.prBody).toContain("held_out:");
  });
});
