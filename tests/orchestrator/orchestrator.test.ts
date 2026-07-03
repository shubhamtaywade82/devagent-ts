import { Orchestrator, OrchestratorError } from "../../src/orchestrator/orchestrator";
import { PlanStep, StepRunner, Planner, StepOutcome } from "../../src/orchestrator/types";

const noopLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeStep(id: string, dependencies: string[] = [], rollbackCommand?: string): PlanStep {
  return { id, description: id, status: "pending", dependencies, retryCount: 0, rollbackCommand };
}

class StubPlanner implements Planner {
  constructor(private readonly next: (remaining: PlanStep[]) => PlanStep[] = () => []) {}
  async replan(remaining: PlanStep[]): Promise<PlanStep[]> {
    return this.next(remaining);
  }
}

describe("Orchestrator", () => {
  it("executes steps in dependency order", async () => {
    const steps = [makeStep("b", ["a"]), makeStep("a")];
    const executed: string[] = [];
    const runner: StepRunner = {
      async run(step) {
        executed.push(step.id);
        return { kind: "success", output: {} };
      },
    };

    const orchestrator = new Orchestrator({
      steps,
      runner,
      planner: new StubPlanner(),
      runRollback: async () => {},
      logger: noopLogger,
    });
    await orchestrator.run();

    expect(executed).toEqual(["a", "b"]);
  });

  it("retries a retryable failure up to the cap, then triggers a re-plan", async () => {
    const steps = [makeStep("a")];
    let attempts = 0;
    const runner: StepRunner = {
      async run(): Promise<StepOutcome> {
        attempts += 1;
        return { kind: "retryable", error: "transient" };
      },
    };
    let replanCalled = false;
    const planner = new StubPlanner((_remaining) => {
      replanCalled = true;
      return [];
    });

    const orchestrator = new Orchestrator({ steps, runner, planner, runRollback: async () => {}, logger: noopLogger });
    await orchestrator.run();

    expect(attempts).toBe(4);
    expect(replanCalled).toBe(true);
  });

  it("cascades a failure to dependent steps as skipped", async () => {
    const steps = [makeStep("a"), makeStep("b", ["a"]), makeStep("c", ["b"])];
    const runner: StepRunner = {
      async run(step): Promise<StepOutcome> {
        if (step.id === "a") return { kind: "blocking", error: "missing file" };
        return { kind: "success", output: {} };
      },
    };

    const orchestrator = new Orchestrator({
      steps,
      runner,
      planner: new StubPlanner(),
      runRollback: async () => {},
      logger: noopLogger,
    });
    const result = await orchestrator.run();

    const byId = Object.fromEntries(result.map((s) => [s.id, s.status]));
    expect(byId.a).toBe("failed");
    expect(byId.b).toBe("skipped");
    expect(byId.c).toBe("skipped");
  });

  it("rolls back completed steps in reverse chronological order when a later step fails", async () => {
    const steps = [makeStep("a", [], "rollback-a"), makeStep("b", ["a"], "rollback-b"), makeStep("c", ["b"])];
    const runner: StepRunner = {
      async run(step): Promise<StepOutcome> {
        if (step.id === "c") return { kind: "blocking", error: "cannot generate file" };
        return { kind: "success", output: {} };
      },
    };
    const rolledBack: string[] = [];

    const orchestrator = new Orchestrator({
      steps,
      runner,
      planner: new StubPlanner(),
      runRollback: async (cmd) => {
        rolledBack.push(cmd);
      },
      logger: noopLogger,
    });
    await orchestrator.run();

    expect(rolledBack).toEqual(["rollback-b", "rollback-a"]);
  });

  it("throws on a dependency cycle", async () => {
    const steps = [makeStep("a", ["b"]), makeStep("b", ["a"])];
    const orchestrator = new Orchestrator({
      steps,
      runner: { run: async () => ({ kind: "success", output: {} }) },
      planner: new StubPlanner(),
      runRollback: async () => {},
      logger: noopLogger,
    });

    await expect(orchestrator.run()).rejects.toThrow(OrchestratorError);
  });

  it("aborts after exceeding the max re-plan count instead of looping forever", async () => {
    let counter = 0;
    const runner: StepRunner = { async run(): Promise<StepOutcome> { return { kind: "blocking", error: "stuck" }; } };
    const planner = new StubPlanner(() => {
      counter += 1;
      return [makeStep(`a${counter}`)];
    });

    const orchestrator = new Orchestrator({
      steps: [makeStep("a")],
      runner,
      planner,
      runRollback: async () => {},
      logger: noopLogger,
      maxReplans: 2,
    });

    await expect(orchestrator.run()).rejects.toThrow(/re-plans/);
  });
});
