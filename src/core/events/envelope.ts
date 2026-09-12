/**
 * EventEnvelope — the durable form of an execution event (review items 13/33).
 *
 * When the execution runtime persists history it does not persist the raw
 * events: it persists envelopes that carry identity + correlation + timing,
 * so replay/recovery can reconstruct runs, tasks, steps, tool invocations,
 * model calls, policy decisions, checkpoints and approvals without
 * ambient state.
 *
 * The payload type is generic: core only requires `{ type: string }`;
 * runtime/persistence instantiates `EventEnvelope<ExecutionEvent>`.
 */

import type { CorrelationIds, EventId, RunId } from "../identity.js";

/** Any event shape carrying a discriminator. */
export interface TypeTaggedEvent {
  type: string;
}

/**
 * One persisted execution event. `seq` is per-run monotonic (1..n) so
 * replay is deterministic; `ts` is epoch millis; `correlation` carries
 * the full id chain (traceId → runId → taskId/stepId → toolCallId /
 * modelCallId + parentRunId for delegated children).
 */
export interface EventEnvelope<E extends TypeTaggedEvent = TypeTaggedEvent> {
  id: EventId;
  /** Per-run sequence number (replay order). */
  seq: number;
  ts: number;
  runId: RunId;
  correlation: CorrelationIds;
  event: E;
}

/** Row shape written by the ExecutionEventStore (JSONL / sqlite friendly). */
export interface PersistedEventRecord {
  id: EventId;
  seq: number;
  ts: number;
  runId: RunId;
  correlation: CorrelationIds;
  eventType: string;
  payload: unknown;
}

export function toPersistedRecord<E extends TypeTaggedEvent>(envelope: EventEnvelope<E>): PersistedEventRecord {
  return {
    id: envelope.id,
    seq: envelope.seq,
    ts: envelope.ts,
    runId: envelope.runId,
    correlation: envelope.correlation,
    eventType: envelope.event.type,
    payload: envelope.event,
  };
}

export function fromPersistedRecord(record: PersistedEventRecord): EventEnvelope {
  return {
    id: record.id,
    seq: record.seq,
    ts: record.ts,
    runId: record.runId,
    correlation: record.correlation,
    event: record.payload as TypeTaggedEvent,
  };
}

/** Distinguish persisted records from other JSONL lines. */
export function isPersistedEventRecord(value: unknown): value is PersistedEventRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.seq === "number" &&
    typeof v.ts === "number" &&
    typeof v.runId === "string" &&
    typeof v.eventType === "string"
  );
}
