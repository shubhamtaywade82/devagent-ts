import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvolutionEngine } from "../../src/evolution/engine.js";
import { TaskExecutionResult } from "../../src/evolution/evaluator.js";
import { HarnessRegistry } from "../../src/evolution/registry.js";
import { Episode } from "../../src/learning/types.js";

function makeFailureEpisode(): Episode {
  return {
    id: "ep-fail-1",
    goal: "Fix authentication loop",
    startedAt: 1000,
    endedAt: 2000,
    terminal: "loop_abort",
    toolEvents: [
      { name: "read_file", ok: true, durationMs: 50 },
      { name: "run_shell", ok: false, durationMs: 100, errorLabel: "command_failed" },
      { name: "run_shell", ok: false, durationMs: 100, errorLabel: "command_failed" },
      { name: "run_shell", ok: false, durationMs: 100, errorLabel: "command_failed" },
    ],
    skillsInjected: [],
    grade: {
      verdict: "failure",
      score: 0.1,
      signals: {
        testsRan: true,
        testsPassed: false,
        toolErrorRate: 0.75,
        retriedSameToolMax: 3,
        loopAborted: true,
        turnCount: 4,
      },
    },
  };
}

const baselineResults: TaskExecutionResult[] = [
  {
    taskId: "t1",
    success: true,
    verificationPassed: true,
    toolCalls: 5,
    toolErrors: 0,
    tokens: 3000,
    latencyMs: 1000,
    loopAborted: false,
    isHeldOut: false,
  },
  {
    taskId: "t2",
    success: false,
    verificationPassed: false,
    toolCalls: 6,
    toolErrors: 2,
    tokens: 4000,
    latencyMs: 1200,
    loopAborted: true,
    isHeldOut: true,
  },
];

const improvedResults: TaskExecutionResult[] = [
  {
    taskId: "t1",
    success: true,
    verificationPassed: true,
    toolCalls: 4,
    toolErrors: 0,
    tokens: 2500,
    latencyMs: 800,
    loopAborted: false,
    isHeldOut: false,
  },
  {
    taskId: "t2",
    success: true,
    verificationPassed: true,
    toolCalls: 4,
    toolErrors: 0,
    tokens: 2800,
    latencyMs: 900,
    loopAborted: false,
    isHeldOut: true,
  },
];

const regressedResults: TaskExecutionResult[] = [
  {
    taskId: "t1",
    success: false,
    verificationPassed: false,
    toolCalls: 10,
    toolErrors: 6,
    tokens: 8000,
    latencyMs: 2500,
    loopAborted: true,
    isHeldOut: false,
  },
  {
    taskId: "t2",
    success: false,
    verificationPassed: false,
    toolCalls: 8,
    toolErrors: 5,
    tokens: 7500,
    latencyMs: 2200,
    loopAborted: true,
    isHeldOut: true,
  },
];

describe("EvolutionEngine", () => {
  let tmpDir: string;
  let registry: HarnessRegistry;
  let engine: EvolutionEngine;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "engine-test-"));
    registry = new HarnessRegistry(join(tmpDir, "registry.db"));
    engine = new EvolutionEngine({ registry });
  });

  afterEach(async () => {
    registry.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("diagnoses failing episodes into structured plan", () => {
    const episode = makeFailureEpisode();
    const result = engine.diagnoseEpisodes([episode]);

    expect(result.diagnoses).toHaveLength(1);
    expect(result.diagnoses[0].failureClass).toBe("loop_failure");
    expect(result.diagnoses[0].component).toBe("execution");
    expect(result.plan).not.toBeNull();
    expect(result.plan?.targetComponent).toBe("execution");
  });

  it("establishes initial baseline version H0 when no baseline exists", () => {
    const outcome = engine.evaluateCandidate(
      {
        id: "H0",
        commitSha: "sha-000",
        targetComponent: "execution",
        hypothesis: "Initial baseline harness",
      },
      baselineResults,
    );

    expect(outcome.version.id).toBe("H0");
    expect(outcome.version.status).toBe("promoted");
    expect(outcome.comparison.decision).toBe("promote");
    expect(outcome.deliveryReport).toBeDefined();
    expect(engine.getActiveVersion()?.id).toBe("H0");
  });

  it("evaluates and promotes an improved candidate against baseline", () => {
    // 1. Establish baseline H0
    engine.evaluateCandidate(
      {
        id: "H0",
        commitSha: "sha-000",
        targetComponent: "execution",
        hypothesis: "Baseline",
      },
      baselineResults,
    );

    // 2. Evaluate candidate H1
    const outcome = engine.evaluateCandidate(
      {
        id: "H1",
        commitSha: "sha-001",
        targetComponent: "execution",
        hypothesis: "Tighten loop detection thresholds",
      },
      improvedResults,
    );

    expect(outcome.version.id).toBe("H1");
    expect(outcome.version.status).toBe("promoted");
    expect(outcome.comparison.decision).toBe("promote");
    expect(outcome.deliveryReport?.branchName).toBe("evolution/h1-execution");
    expect(engine.getActiveVersion()?.id).toBe("H1");
  });

  it("rejects a regressed candidate and keeps baseline active", () => {
    // 1. Establish baseline H0
    engine.evaluateCandidate(
      {
        id: "H0",
        commitSha: "sha-000",
        targetComponent: "execution",
        hypothesis: "Baseline",
      },
      baselineResults,
    );

    // 2. Evaluate regressed candidate H_bad
    const outcome = engine.evaluateCandidate(
      {
        id: "H_bad",
        commitSha: "sha-bad",
        targetComponent: "execution",
        hypothesis: "Flawed loop detector",
      },
      regressedResults,
    );

    expect(outcome.version.id).toBe("H_bad");
    expect(outcome.version.status).toBe("rejected");
    expect(outcome.comparison.decision).toBe("reject");
    expect(outcome.deliveryReport).toBeUndefined();
    expect(engine.getActiveVersion()?.id).toBe("H0");
  });

  it("supports rolling back to an earlier harness version", () => {
    engine.evaluateCandidate(
      { id: "H0", commitSha: "sha-0", targetComponent: "execution", hypothesis: "Base" },
      baselineResults,
    );
    engine.evaluateCandidate(
      { id: "H1", commitSha: "sha-1", targetComponent: "execution", hypothesis: "Improvement" },
      improvedResults,
    );

    expect(engine.getActiveVersion()?.id).toBe("H1");
    engine.rollback("H0");
    expect(engine.getActiveVersion()?.id).toBe("H0");
  });
});
