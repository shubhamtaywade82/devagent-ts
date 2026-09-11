import { CandidateEvaluator, TaskExecutionResult } from "@nemesis-oss/nexum-devagent/evolution/evaluator";

describe("CandidateEvaluator", () => {
  const evaluator = new CandidateEvaluator();

  it("aggregates execution results into accurate metrics", () => {
    const results: TaskExecutionResult[] = [
      {
        taskId: "t1",
        success: true,
        verificationPassed: true,
        toolCalls: 4,
        toolErrors: 0,
        tokens: 5000,
        latencyMs: 1200,
        loopAborted: false,
        isHeldOut: false,
      },
      {
        taskId: "t2",
        success: false,
        verificationPassed: false,
        toolCalls: 6,
        toolErrors: 2,
        tokens: 7000,
        latencyMs: 2000,
        loopAborted: false,
        isHeldOut: true,
      },
    ];

    const metrics = evaluator.aggregateResults(results);
    expect(metrics.capability.taskSuccessRate).toBe(0.5);
    expect(metrics.capability.verificationPassRate).toBe(0.5);
    expect(metrics.reliability.toolErrorRate).toBe(2 / 10);
    expect(metrics.efficiency.avgTokens).toBe(6000);
    expect(metrics.efficiency.avgLatencyMs).toBe(1600);
    expect(metrics.generalization.heldOutScore).toBe(0); // t2 is held-out and failed
  });

  it("handles empty results safely", () => {
    const metrics = evaluator.aggregateResults([]);
    expect(metrics.capability.taskSuccessRate).toBe(0);
    expect(metrics.efficiency.avgTokens).toBe(0);
  });
});
