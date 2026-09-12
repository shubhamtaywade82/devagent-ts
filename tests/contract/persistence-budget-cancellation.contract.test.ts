/**
 * CONTRACT TESTS — durable execution history + replay/recovery
 * (review items 13, 32, 33, 37).
 */

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionEventStore } from "../../src/runtime/persistence/execution-event-store.js";
import { ExecutionRecorder } from "../../src/runtime/persistence/execution-recorder.js";
import { correlationFrom } from "../../src/core/observability/correlation.js";
import { newRunId, newTraceId } from "../../src/core/identity.js";
import { BudgetManager } from "../../src/runtime/budget/budget-manager.js";
import {
  CancellationRegistry,
  CancellationScope,
  linkedSignal,
  throwIfAborted,
  isAbortError,
} from "../../src/core/cancellation/cancellation.js";

describe("ExecutionEventStore contract (items 13, 32)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexum-runs-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists seq-ordered envelopes and replays projections (item 13)", () => {
    const store = new ExecutionEventStore({ rootDir: dir });
    const runId = newRunId();
    const correlation = correlationFrom({ runId, traceId: newTraceId(), agentId: "devagent" });
    const recorder = new ExecutionRecorder({ store }).forRun(correlation);

    recorder.start("ship the feature", "devagent", "react");
    recorder.publish({ type: "tool.started", id: "tc_1", name: "apply_patch", args: { path: "a.ts" } });
    recorder.publish({ type: "tool.completed", id: "tc_1", result: { applied: true } });
    recorder.publish({ type: "model.answered", tier: "local", model: "qwen" });
    recorder.publish({
      type: "approval.requested",
      request: { id: "ap_1", title: "confirm", summary: "s", filesChanged: 0, additions: 0, deletions: 0 },
    });
    recorder.publish({ type: "approval.resolved", id: "ap_1", approved: true });
    recorder.finish({ status: "completed", output: "done" });

    const replay = store.replay(runId);
    expect(replay).not.toBeNull();
    expect(replay!.run.runId).toBe(runId);
    expect(replay!.run.goal).toBe("ship the feature");
    expect(replay!.run.status).toBe("completed");
    expect(replay!.toolInvocations).toHaveLength(1);
    expect(replay!.toolInvocations[0].tool).toBe("apply_patch");
    expect(replay!.toolInvocations[0].status).toBe("completed");
    expect(replay!.modelCalls).toHaveLength(1);
    expect(replay!.approvals[0].approved).toBe(true);
  });

  it("run index lists runs; prune drops old ones (item 13)", () => {
    const store = new ExecutionEventStore({ rootDir: dir });
    for (let i = 0; i < 3; i++) {
      const runId = newRunId();
      const recorder = new ExecutionRecorder({ store }).forRun(correlationFrom({ runId, traceId: newTraceId() }));
      recorder.start(`run ${i}`, "devagent");
      recorder.finish({ status: "completed" });
    }
    expect(store.listRuns()).toHaveLength(3);
    const dropped = store.prune(1);
    expect(dropped).toBe(2);
    expect(store.listRuns()).toHaveLength(1);
  });

  it("torn tail lines are tolerated (crash mid-append, item 13)", () => {
    const store = new ExecutionEventStore({ rootDir: dir });
    const runId = newRunId();
    const recorder = new ExecutionRecorder({ store }).forRun(correlationFrom({ runId }));
    recorder.start("goal", "devagent");
    recorder.finish({ status: "completed" });
    // simulate a torn write: half a JSON line
    appendFileSync(join(dir, "runs", `${runId}.events.jsonl`), '{"id":"evt_x","seq":99,"ts":1');
    const events = store.eventsForRun(runId);
    expect(events.length).toBeGreaterThan(0); // the torn line is dropped, not fatal
    expect(store.replay(runId)).not.toBeNull();
  });

  it("correlation ids propagate into every record (item 33)", () => {
    const store = new ExecutionEventStore({ rootDir: dir });
    const runId = newRunId();
    const traceId = newTraceId();
    const correlation = correlationFrom({ runId, traceId, agentId: "devagent", parentRunId: "run_parent" });
    const recorder = new ExecutionRecorder({ store }).forRun(correlation);
    recorder.start("goal", "devagent");
    recorder.finish({ status: "completed" });

    const record = store.listRuns().find((r) => r.runId === runId)!;
    expect(record.traceId).toBe(traceId);
    expect(record.parentRunId).toBe("run_parent");
    expect(record.agentId).toBe("devagent");
  });
});

describe("BudgetManager contract (item 14)", () => {
  it("enforces the new dimensions: iterations, cloud calls, cloud spend, parallel slots", () => {
    const manager = new BudgetManager({ budget: { maxIterations: 2, maxCloudCalls: 1, maxCloudSpendUsd: 0.01 } });
    manager.consumeIteration();
    manager.consumeIteration();
    expect(() => manager.consumeIteration()).toThrow(/Budget exhausted/);
    manager.consumeModelCall({ cloud: true, costUsd: 0.005 });
    expect(() => manager.consumeModelCall({ cloud: true, costUsd: 0.02 })).toThrow(/Budget exhausted/);
  });

  it("parallel slots throw when exceeded (item 14/34)", () => {
    const manager = new BudgetManager({ budget: { maxParallelExecutions: 1 } });
    const release = manager.acquireParallelSlot();
    expect(() => manager.acquireParallelSlot()).toThrow(/Budget exhausted/);
    release();
    const again = manager.acquireParallelSlot();
    again();
  });

  it("child consumption propagates upward (item 14/26)", () => {
    const parent = new BudgetManager({ budget: { maxToolCalls: 3, maxModelCalls: 3 } });
    const child = parent.deriveChild({ share: 1 });
    child.consumeToolCall();
    child.consumeToolCall();
    child.consumeToolCall();
    // the parent's budget burned through the child's calls
    expect(() => parent.consumeToolCall()).toThrow(/Budget exhausted/);
    expect(parent.runUsage().descendantToolCalls).toBe(3);
  });

  it("child wall-clock deadline can never exceed the parent's remaining time (item 26)", () => {
    const parent = new BudgetManager({ budget: { deadlineMs: 10_000 } });
    const child = parent.deriveChild({ budget: { deadlineMs: 999_999 } });
    expect(child.budget.deadlineMs ?? 0).toBeLessThanOrEqual(10_000);
  });
});

describe("Cancellation contract (item 16)", () => {
  it("linked signals chain parent → child with timeout", async () => {
    const parent = new AbortController();
    const linked = linkedSignal({ parent: parent.signal, timeoutMs: 5_000, label: "child" });
    parent.abort();
    expect(linked.signal.aborted).toBe(true);
    linked.dispose();
  });

  it("throwIfAborted names the operation; isAbortError recognizes abort shapes", () => {
    const controller = new AbortController();
    controller.abort();
    try {
      throwIfAborted(controller.signal, "tool:run_shell");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("tool:run_shell");
      expect(isAbortError(e)).toBe(true);
    }
  });

  it("CancellationRegistry cancels every scope under a run (item 16)", () => {
    const registry = new CancellationRegistry();
    const modelScope = new CancellationScope("model-call");
    const toolScope = new CancellationScope("tool-call");
    const shellScope = new CancellationScope("shell");
    const un1 = registry.register("run_1", modelScope);
    registry.register("run_1", toolScope);
    registry.register("run_1", shellScope);
    registry.register("run_2", new CancellationScope("other-run"));

    const cancelled = registry.cancel("run_1", "test cancel");
    expect(cancelled).toBe(3);
    expect(modelScope.aborted).toBe(true);
    expect(toolScope.aborted).toBe(true);
    expect(shellScope.aborted).toBe(true);
    expect(registry.activeScopeCount("run_1")).toBeGreaterThanOrEqual(0);
    un1();
  });
});
