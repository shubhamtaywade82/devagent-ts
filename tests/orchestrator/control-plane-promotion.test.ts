/**
 * Control Plane promotion tests — the Orchestrator onto kernel ports.
 *
 * Covers the roadmap lever "promote the ControlPlane onto the kernel ports":
 *
 *   1. RuntimeStepRunner — the kernel-native delegator: PlanStep →
 *      ExecutionRequest through AgentRuntime.execute, ExecutionResult →
 *      StepOutcome mapping, and the signal/context contract.
 *   2. Orchestrator kernel wiring — GateRegistry-derived plan gate,
 *      mission.step events on the kernel EventSink, and cooperative abort
 *      semantics (no new steps, in-flight cancelled, no replan/rollback,
 *      checkpoint kept for resume).
 */

import { Orchestrator } from "@nemesis-oss/nexum-devagent/orchestrator/orchestrator";
import {
  RuntimeStepRunner,
  mapOutcome,
  type StepContextFactory,
} from "@nemesis-oss/nexum-devagent/orchestrator/runtime-step-runner";
import { PlanStep, Planner, StepOutcome, StepRunner } from "@nemesis-oss/nexum-devagent/orchestrator/types";
import type { ExecutionContext, ExecutionRequest, ExecutionResult } from "@nemesis-oss/nexum-core/kernel/types";
import { GateRegistry } from "@nemesis-oss/nexum-core/kernel/concurrency/gate-registry";
import type { EventSink } from "@nemesis-oss/nexum-core/kernel/types";
import { CheckpointStore } from "@nemesis-oss/nexum-core/runtime/checkpoint";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const noopLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeStep(id: string, dependencies: string[] = [], rollbackCommand?: string): PlanStep {
  return { id, description: `do ${id}`, status: "pending", dependencies, retryCount: 0, rollbackCommand };
}

// ── RuntimeStepRunner ─────────────────────────────────────────────────────

describe("RuntimeStepRunner", () => {
  type ExecuteSpy = jest.Mock<Promise<ExecutionResult>, [ExecutionRequest, ExecutionContext, unknown?]>;

  function stubRuntime(status: ExecutionResult["status"], extra: Partial<ExecutionResult> = {}) {
    const executes: Array<{ request: ExecutionRequest; context: ExecutionContext }> = [];
    const execute: ExecuteSpy = jest.fn(async (request, context) => {
      executes.push({ request, context });
      return {
        status,
        runId: "run_1",
        agentId: request.agentId,
        strategy: "react",
        output: "step answer",
        usage: { toolCalls: 1, modelCalls: 2, totalTokens: 30, costUsd: 0, elapsedMs: 5 },
        error: status === "completed" ? undefined : "boom",
        ...extra,
      } as ExecutionResult;
    });
    const runtime = { execute } as unknown as ConstructorParameters<typeof RuntimeStepRunner>[0]["runtime"];
    return { runtime, execute, executes };
  }

  function fakeFactory(signal?: AbortSignal): StepContextFactory {
    return jest.fn(
      (_step, request) =>
        ({
          runId: "run_1",
          sessionId: "sess_1",
          agentId: request.agentId,
          task: request.task,
          signal: signal ?? new AbortController().signal,
        }) as unknown as ExecutionContext,
    );
  }

  function makeRunner(runtime: ReturnType<typeof stubRuntime>["runtime"], factory: StepContextFactory) {
    return new RuntimeStepRunner({ runtime, agentId: "devagent", createContext: factory });
  }

  it("projects the PlanStep onto ExecutionRequest and runs through the kernel runtime", async () => {
    const { runtime, executes } = stubRuntime("completed");
    const factory = fakeFactory();
    const runner = makeRunner(runtime, factory);

    const step = makeStep("s1");
    step.priority = "critical";
    step.retryCount = 2;

    const outcome = await runner.run(step);

    expect(outcome.kind).toBe("success");
    expect(executes).toHaveLength(1);
    expect(executes[0].request.agentId).toBe("devagent");
    expect(executes[0].request.task.goal).toBe("do s1");
    expect(executes[0].request.task.metadata).toEqual({ stepId: "s1", priority: "critical", attempt: 2 });
    // The embedding app owns the context; the runner only supplies the request.
    expect(factory).toHaveBeenCalledWith(step, executes[0].request);
  });

  it("maps failed and timeout results to retryable", async () => {
    for (const status of ["failed", "timeout"] as const) {
      const { runtime } = stubRuntime(status);
      const runner = makeRunner(runtime, fakeFactory());
      const outcome = await runner.run(makeStep("s1"));
      expect(outcome).toEqual({ kind: "retryable", error: "boom" });
    }
  });

  it("maps cancelled and budget_exhausted results to blocking", async () => {
    for (const status of ["cancelled", "budget_exhausted"] as const) {
      const { runtime } = stubRuntime(status);
      const runner = makeRunner(runtime, fakeFactory());
      const outcome = await runner.run(makeStep("s1"));
      expect(outcome.kind).toBe("blocking");
    }
  });

  it("reports success with the run's output, runId, and usage", async () => {
    const { runtime } = stubRuntime("completed");
    const runner = makeRunner(runtime, fakeFactory());

    const outcome = await runner.run(makeStep("s1"));

    expect(outcome).toMatchObject({
      kind: "success",
      output: { text: "step answer", runId: "run_1", usage: { modelCalls: 2 } },
    });
  });

  it("classifies a throwing context factory or runtime as retryable (defensive)", async () => {
    const { runtime } = stubRuntime("completed");
    const throwingFactory: StepContextFactory = () => {
      throw new Error("no gateways configured");
    };
    const runner = makeRunner(runtime, throwingFactory);
    expect(await runner.run(makeStep("s1"))).toEqual({ kind: "retryable", error: "no gateways configured" });

    const exploding = {
      execute: jest.fn(async () => {
        throw new Error("kernel blew up");
      }),
    } as unknown as typeof runtime;
    const runner2 = makeRunner(exploding, fakeFactory());
    expect(await runner2.run(makeStep("s1"))).toEqual({ kind: "retryable", error: "kernel blew up" });
  });

  it("mapOutcome is a pure status → outcome mapping", () => {
    const base = {
      runId: "r",
      agentId: "devagent",
      strategy: "react" as const,
      output: "",
      usage: { toolCalls: 0, modelCalls: 0, totalTokens: 0, costUsd: 0, elapsedMs: 0 },
    };
    expect(mapOutcome({ ...base, status: "completed" }).kind).toBe("success");
    expect(mapOutcome({ ...base, status: "failed" }).kind).toBe("retryable");
    expect(mapOutcome({ ...base, status: "timeout" }).kind).toBe("retryable");
    expect(mapOutcome({ ...base, status: "cancelled" }).kind).toBe("blocking");
    expect(mapOutcome({ ...base, status: "budget_exhausted" }).kind).toBe("blocking");
  });
});

// ── Orchestrator kernel wiring ───────────────────────────────────────────

describe("Orchestrator kernel wiring", () => {
  function successRunner(): StepRunner {
    return { run: async () => ({ kind: "success", output: {} }) };
  }

  function stubPlanner(next: (remaining: PlanStep[]) => PlanStep[] = () => []): Planner {
    return {
      async replan(remaining) {
        return next(remaining);
      },
    };
  }

  it("derives the plan gate from the kernel GateRegistry (global:control-plane)", async () => {
    const gates = new GateRegistry();
    const steps = [makeStep("a"), makeStep("b", ["a"])];

    const orchestrator = new Orchestrator({
      steps,
      runner: successRunner(),
      planner: stubPlanner(),
      runRollback: async () => {},
      gates,
      logger: noopLogger,
    });
    await orchestrator.run();

    const gate = gates.gate("global", "control-plane");
    expect(gate.maxConcurrent).toBe(4); // default ceiling, no concurrencyLimit given
    // The shared registry observes the work the plan ran through it.
    expect(gates.snapshot().map((g) => `${g.scope}:${g.key}`)).toContain("global:control-plane");
  });

  it("honours concurrencyLimit as the registry gate's ceiling", async () => {
    const gates = new GateRegistry();
    const inFlight = new Set<string>();
    let maxConcurrent = 0;
    const runner: StepRunner = {
      async run(step) {
        inFlight.add(step.id);
        maxConcurrent = Math.max(maxConcurrent, inFlight.size);
        await new Promise((r) => setTimeout(r, 10));
        inFlight.delete(step.id);
        return { kind: "success", output: {} };
      },
    };
    const steps = [makeStep("a"), makeStep("b"), makeStep("c")];
    const orchestrator = new Orchestrator({
      steps,
      runner,
      planner: stubPlanner(),
      runRollback: async () => {},
      gates,
      concurrencyLimit: 1,
      logger: noopLogger,
    });
    await orchestrator.run();
    expect(maxConcurrent).toBe(1);
    expect(gates.gate("global", "control-plane").maxConcurrent).toBe(1);
  });

  it("publishes mission.step events to the kernel EventSink on every transition", async () => {
    const published: Array<{ type: string; step?: PlanStep }> = [];
    const sink: EventSink = { publish: (e) => published.push(e as { type: string; step?: PlanStep }) };
    const steps = [makeStep("s1")];
    const transitions: string[] = [];

    const orchestrator = new Orchestrator({
      steps,
      runner: successRunner(),
      planner: stubPlanner(),
      runRollback: async () => {},
      events: sink,
      onStepChange: (step) => transitions.push(step.status),
      logger: noopLogger,
    });
    await orchestrator.run();

    expect(transitions).toEqual(["analyzing", "planning", "implementing", "testing", "reviewing", "completed"]);
    expect(published.map((e) => e.type)).toEqual([
      "mission.step",
      "mission.step",
      "mission.step",
      "mission.step",
      "mission.step",
      "mission.step",
    ]);
    // Snapshotted, not live-mutating: each event carries the status at publish time.
    expect(published.map((e) => e.step?.status)).toEqual(transitions);
  });

  it("aborts before the first batch: nothing runs, everything is cancelled, checkpoint kept", async () => {
    let dir: string;
    dir = await mkdtemp(join(tmpdir(), "orch-abort-"));
    try {
      const checkpointPath = join(dir, "checkpoint.json");
      const checkpoint = new CheckpointStore(checkpointPath);
      const controller = new AbortController();
      controller.abort();

      const executed: string[] = [];
      const replanner = jest.fn();
      const planner: Planner = {
        async replan(remaining) {
          replanner(remaining);
          return [];
        },
      };
      const rollback = jest.fn(async () => {});

      const orchestrator = new Orchestrator({
        steps: [makeStep("a"), makeStep("b", ["a"])],
        runner: {
          async run(step) {
            executed.push(step.id);
            return { kind: "success", output: {} };
          },
        },
        planner,
        runRollback: rollback,
        signal: controller.signal,
        checkpoint,
        logger: noopLogger,
      });
      const result = await orchestrator.run();

      expect(executed).toEqual([]);
      expect(replanner).not.toHaveBeenCalled();
      expect(rollback).not.toHaveBeenCalled();
      expect(result.map((s) => `${s.id}:${s.status}`)).toEqual(["a:cancelled", "b:cancelled"]);
      // The checkpoint is kept so the aborted plan can be resumed later.
      expect(checkpoint.load()).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("aborts mid-plan: in-flight step cancelled (not failed), queued steps never start, no replan/rollback", async () => {
    const controller = new AbortController();
    const executed: string[] = [];
    const rollback = jest.fn(async () => {});
    const replanner = jest.fn();
    const planner: Planner = {
      async replan(remaining) {
        replanner(remaining);
        return [];
      },
    };

    const runner: StepRunner = {
      async run(step) {
        executed.push(step.id);
        // Step "a" is cut short: the product run observes the operator's
        // abort and unwinds as cancelled → the runner reports blocking.
        controller.abort();
        return { kind: "blocking", error: "execution cancelled" };
      },
    };

    const orchestrator = new Orchestrator({
      steps: [makeStep("a"), makeStep("b", ["a"]), makeStep("c")],
      runner,
      planner,
      runRollback: rollback,
      signal: controller.signal,
      logger: noopLogger,
    });
    const result = await orchestrator.run();

    // "a" started and was aborted; its batch sibling "c" hits the entry
    // check with the signal already aborted, so it never starts; "b" is
    // dependency-blocked and never scheduled either.
    expect(executed).toEqual(["a"]);
    expect(replanner).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
    const byId = Object.fromEntries(result.map((s) => [s.id, s.status]));
    expect(byId.a).toBe("cancelled"); // in-flight: cancelled, NOT failed
    expect(byId.b).toBe("cancelled"); // never started
    expect(byId.c).toBe("cancelled");
  });

  it("queued steps never start once the abort lands during a batch", async () => {
    const controller = new AbortController();
    const steps = [makeStep("a"), makeStep("b"), makeStep("c"), makeStep("d")];
    const started: string[] = [];
    let runs = 0;

    const orchestrator = new Orchestrator({
      steps,
      planner: stubPlanner(),
      runRollback: async () => {},
      gates: new GateRegistry({ defaults: { global: 2 } }),
      concurrencyLimit: 2,
      signal: controller.signal,
      logger: noopLogger,
      runner: {
        async run(step) {
          started.push(step.id);
          runs += 1;
          if (runs === 1) controller.abort(); // abort while the first of four runs
          return { kind: "success", output: {} };
        },
      },
    });
    await orchestrator.run();

    expect(started.length).toBeLessThan(4);
    const statuses = Object.fromEntries(steps.map((s) => [s.id, s.status]));
    expect(statuses.d).toBe("cancelled");
  });

  it("does not skip rollback when there is no signal (back-compat failure path intact)", async () => {
    const rolledBack: string[] = [];
    const orchestrator = new Orchestrator({
      steps: [makeStep("a", [], "undo-a"), makeStep("b", ["a"])],
      runner: {
        async run(step) {
          return step.id === "b" ? { kind: "blocking", error: "x" } : { kind: "success", output: {} };
        },
      },
      planner: stubPlanner(),
      runRollback: async (cmd) => {
        rolledBack.push(cmd);
      },
      logger: noopLogger,
    });
    await orchestrator.run();
    expect(rolledBack).toEqual(["undo-a"]);
  });

  it("still records history for steps that completed before the abort", async () => {
    const controller = new AbortController();
    const priorHistory: StepOutcome[] = [];
    const orchestrator = new Orchestrator({
      steps: [makeStep("a"), makeStep("b", ["a"])],
      planner: stubPlanner(),
      runRollback: async () => {},
      signal: controller.signal,
      logger: noopLogger,
      runner: {
        async run(step) {
          if (step.id === "a") {
            const outcome: StepOutcome = { kind: "success", output: {} };
            priorHistory.push(outcome);
            controller.abort();
            return outcome;
          }
          return { kind: "success", output: {} };
        },
      },
    });
    const result = await orchestrator.run();
    // "a" completed before the abort was observed at the batch boundary.
    expect(result.find((s) => s.id === "a")?.status).toBe("completed");
    expect(result.find((s) => s.id === "b")?.status).toBe("cancelled");
  });
});
