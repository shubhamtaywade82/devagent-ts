/**
 * Observability correlation (review items 33 + 13).
 *
 * Every execution artifact carries a `CorrelationIds` record so any
 * single event can be traced to its run, task, agent, model call, tool
 * call, and parent run. `CorrelationTracker` stamps envelopes as events
 * flow through the execution runtime; `ExecutionEventStore` persists the
 * stamped envelopes (runtime/persistence).
 */

import {
  CorrelationIds,
  newEventId,
  newTraceId,
  PartialCorrelation,
  RunId,
} from "../identity.js";
import type { EventEnvelope, TypeTaggedEvent } from "../events/envelope.js";

/**
 * Per-run correlation stamper. Owns the trace context for one run and
 * enriches events with ids that were not carried by the producer.
 *
 * Usage inside the runtime:
 *   const tracker = new CorrelationTracker({ traceId, runId, agentId });
 *   const envelope = tracker.envelope(seq, event);   // → persist + publish
 */
export class CorrelationTracker {
  readonly correlation: CorrelationIds;

  constructor(base: PartialCorrelation & { runId: RunId }) {
    this.correlation = {
      traceId: base.traceId ?? newTraceId(),
      runId: base.runId,
      sessionId: base.sessionId,
      tenantId: base.tenantId,
      parentRunId: base.parentRunId,
      taskId: base.taskId,
      stepId: base.stepId,
      agentId: base.agentId,
    };
  }

  /** Derive a child tracker (delegation): inherits trace + parent link. */
  child(partial: PartialCorrelation & { runId: RunId }): CorrelationTracker {
    return new CorrelationTracker({
      ...this.correlation,
      parentRunId: this.correlation.runId,
      ...partial,
    });
  }

  /** Stamp an execution event into a durable envelope. */
  envelope<E extends TypeTaggedEvent>(seq: number, event: E, ts: number = Date.now()): EventEnvelope<E> {
    return {
      id: newEventId(),
      seq,
      ts,
      runId: this.correlation.runId,
      correlation: this.correlation,
      event,
    };
  }
}

/**
 * Create a correlation record from ambient context values, filling a fresh
 * trace id when none is known (top-level run started by a user action).
 */
export function correlationFrom(partial: PartialCorrelation & { runId: RunId }): CorrelationIds {
  return {
    traceId: partial.traceId ?? newTraceId(),
    runId: partial.runId,
    parentRunId: partial.parentRunId,
    sessionId: partial.sessionId,
    tenantId: partial.tenantId,
    taskId: partial.taskId,
    stepId: partial.stepId,
    agentId: partial.agentId,
    toolCallId: partial.toolCallId,
    modelCallId: partial.modelCallId,
    delegationId: partial.delegationId,
  };
}
