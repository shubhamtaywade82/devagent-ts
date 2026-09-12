/**
 * ExecutionRecorder — the bridge from live execution to durable history
 * (review items 13 + 33).
 *
 * The runtime (strategies, gateways, delegator) publishes events through a
 * RunRecorder as its EventSink. The recorder:
 *
 *   1. forwards every event to the live sink (the EventBus) so the TUI and
 *      state store keep working unchanged;
 *   2. stamps ExecutionEvents into EventEnvelopes with correlation ids
 *      (traceId → runId → taskId/stepId → toolCallId/modelCallId +
 *      parentRunId) and a per-run monotonic seq;
 *   3. appends them to the ExecutionEventStore (JSONL, crash-tolerant);
 *   4. maintains the run index (RunRecord) for discovery and replay.
 *
 * Domain/state/presentation events pass through to the live sink only —
 * only execution acts are persisted (review item 12's payoff).
 */

import { CorrelationTracker } from "../../core/observability/correlation.js";
import type { CorrelationIds, RunId } from "../../core/identity.js";
import type { EventSink } from "../../core/types.js";
import { isExecutionRuntimeEvent } from "../events/execution-events.js";
import type { ExecutionEvent, RuntimeEvent } from "../events/bus.js";
import type { ExecutionEventStore } from "./execution-event-store.js";
import { RunRecord } from "./state-model.js";

export interface ExecutionRecorderOptions {
  store: ExecutionEventStore;
  /** Live fan-out (the app EventBus). Optional for headless runs. */
  live?: EventSink;
}

export class ExecutionRecorder {
  constructor(private readonly opts: ExecutionRecorderOptions) {}

  /** Open a durable recording session for one run. */
  forRun(correlation: CorrelationIds): RunRecorder {
    return new RunRecorder(this.opts, correlation);
  }
}

export class RunRecorder implements EventSink {
  private readonly tracker: CorrelationTracker;
  private seq = 0;
  private started = false;
  private finished = false;
  private readonly baseRecord: RunRecord;

  constructor(
    private readonly opts: ExecutionRecorderOptions,
    correlation: CorrelationIds,
  ) {
    this.tracker = new CorrelationTracker(correlation);
    this.baseRecord = {
      runId: correlation.runId,
      traceId: this.tracker.correlation.traceId,
      parentRunId: correlation.parentRunId,
      sessionId: correlation.sessionId ?? "sess_unknown",
      tenantId: correlation.tenantId,
      agentId: correlation.agentId ?? "agent_unknown",
      taskId: correlation.taskId,
      goal: "",
      status: "running",
      startedAt: Date.now(),
      eventCount: 0,
    };
  }

  get correlation(): CorrelationIds {
    return this.tracker.correlation;
  }

  /**
   * EventSink entry point. Forwards to the live sink; persists execution
   * events as envelopes (seq-ordered).
   */
  publish(event: RuntimeEvent): void {
    this.opts.live?.publish(event);
    if (isExecutionRuntimeEvent(event)) {
      this.persist(event);
    }
  }

  /** Persist an execution event directly (no live forward). */
  persist(event: ExecutionEvent): void {
    if (this.finished) return; // the log is closed
    this.seq += 1;
    const envelope = this.tracker.envelope(this.seq, event);
    this.opts.store.append(envelope);
    this.baseRecord.eventCount = this.seq;
    this.baseRecord.goal = this.baseRecord.goal || extractGoal(event);
  }

  /** Emit + persist run.started (idempotent). */
  start(goal: string, agentId: string, strategy?: string): void {
    if (this.started) return;
    this.started = true;
    this.baseRecord.goal = goal;
    this.baseRecord.agentId = agentId;
    this.baseRecord.strategy = strategy;
    this.opts.store.upsertRun({ ...this.baseRecord, status: "running" });
    this.publish({ type: "run.started", goal, agentId, strategy });
  }

  /** Emit + persist the terminal run event and close the log. */
  finish(result: {
    status: "completed" | "failed" | "cancelled" | "budget_exhausted" | "timeout";
    output?: string;
    error?: string;
    usage?: Record<string, unknown>;
  }): void {
    if (this.finished) return;
    switch (result.status) {
      case "completed":
        this.publish({
          type: "run.completed",
          status: result.status,
          output: result.output,
          usage: result.usage,
        });
        break;
      case "failed":
        this.publish({ type: "run.failed", error: result.error ?? "unknown error" });
        break;
      case "cancelled":
        this.publish({ type: "run.cancelled", reason: result.error });
        break;
      case "budget_exhausted":
        this.publish({ type: "run.budget_exhausted", dimension: result.error ?? "unknown" });
        break;
      case "timeout":
        this.publish({ type: "run.timeout" });
        break;
    }
    this.opts.store.upsertRun({
      ...this.baseRecord,
      status: result.status,
      endedAt: Date.now(),
    });
    // the log is closed only after the terminal event + index update
    this.finished = true;
  }

  /** Record a PolicyEngine decision (review items 7 + 13). */
  policyDecision(decision: {
    tool: string;
    allowed: boolean;
    requireConfirmation: boolean;
    reason: string;
    rule?: string;
  }): void {
    this.publish({ type: "policy.decision", ...decision });
  }

  /** Record a checkpoint save (recovery anchors). */
  checkpoint(stepCount: number, label?: string): void {
    this.publish({ type: "checkpoint.saved", runId: this.correlation.runId, stepCount, label });
  }

  /** Record delegation start (child run link — review items 25/26). */
  delegationStarted(delegationId: string, childAgentId: string, goal: string): void {
    this.publish({
      type: "delegation.started",
      delegationId,
      childAgentId,
      goal,
      parentRunId: this.correlation.runId,
    });
  }

  /** Record delegation completion. */
  delegationCompleted(delegationId: string, childRunId: RunId, status: string, output?: string): void {
    this.publish({ type: "delegation.completed", delegationId, childRunId, status, output });
  }

  /** How many envelopes were persisted for this run. */
  get persistedCount(): number {
    return this.seq;
  }
}

function extractGoal(event: ExecutionEvent): string {
  if (event.type === "run.started") return event.goal;
  if (event.type === "execution.goal") return event.goal;
  if (event.type === "mission.started") return event.goal;
  return "";
}
