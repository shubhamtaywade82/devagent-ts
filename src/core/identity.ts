/**
 * Typed identity + correlation primitives (review item 33).
 *
 * Every durable record and every execution event in Nexum correlates
 * through these identifiers:
 *
 *   traceId            one user-facing operation (spans many runs)
 *     └─ runId         one agent execution (parentRunId links children)
 *         ├─ taskId   one scheduled unit of work
 *         │   └─ stepId
 *         ├─ modelCallId  (one model invocation)
 *         └─ toolCallId   (one tool invocation)
 *
 * IDs are prefixed UUIDs: readable in logs, sortable-free, collision-safe
 * across processes (v4), and cheap to spot in a JSONL event stream.
 */

import { randomUUID } from "node:crypto";

export type TraceId = string;
export type TenantId = string;
export type SessionId = string;
export type RunId = string;
export type TaskId = string;
export type StepId = string;
export type AgentId = string;
export type ToolCallId = string;
export type ModelCallId = string;
export type CheckpointId = string;
export type EventId = string;
export type DelegationId = string;
export type IdempotencyKey = string;

const prefixed = (prefix: string) => `${prefix}_${randomUUID()}`;

export const newTraceId = (): TraceId => prefixed("trace");
export const newTenantId = (): TenantId => prefixed("tenant");
export const newSessionId = (): SessionId => prefixed("sess");
export const newRunId = (): RunId => prefixed("run");
export const newTaskId = (): TaskId => prefixed("task");
export const newStepId = (): StepId => prefixed("step");
export const newAgentId = (): AgentId => prefixed("agent");
export const newToolCallId = (): ToolCallId => prefixed("tc");
export const newModelCallId = (): ModelCallId => prefixed("mc");
export const newCheckpointId = (): CheckpointId => prefixed("ckpt");
export const newEventId = (): EventId => prefixed("evt");
export const newDelegationId = (): DelegationId => prefixed("dele");
export const newIdempotencyKey = (): IdempotencyKey => prefixed("idem");

/** Parse-check helpers (accept prefixed UUIDs, refuse empty/garbage). */
export function isValidId(id: string, prefix: string): boolean {
  return typeof id === "string" && id.startsWith(`${prefix}_`) && id.length > prefix.length + 1;
}

/**
 * Correlation record stamped onto every persisted execution event
 * (review item 33). `parentRunId` is what makes delegation trees
 * reconstructible: a child run carries its parent's runId.
 */
export interface CorrelationIds {
  traceId: TraceId;
  runId: RunId;
  parentRunId?: RunId;
  sessionId?: SessionId;
  tenantId?: TenantId;
  taskId?: TaskId;
  stepId?: StepId;
  agentId?: AgentId;
  toolCallId?: ToolCallId;
  modelCallId?: ModelCallId;
  delegationId?: DelegationId;
}

/**
 * Correlation for code that has no full context yet (UI actions, domain
 * producers). Anything set flows into persisted events; anything omitted
 * is filled by the owning runtime layer.
 */
export type PartialCorrelation = Partial<CorrelationIds>;

/** Merge correlation records; earlier wins for defined keys (scope narrows inward). */
export function mergeCorrelation(
  base: PartialCorrelation | undefined,
  overlay: PartialCorrelation,
): PartialCorrelation {
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stripUndefined(overlay))) {
    const existing = base?.[k as keyof CorrelationIds];
    if (existing === undefined) kept[k] = v;
  }
  return { ...stripUndefined(overlay), ...stripUndefined(base ?? {}), ...kept };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

/** Format a correlation record as one log-friendly line. */
export function formatCorrelation(c: PartialCorrelation): string {
  const parts: string[] = [`trace=${c.traceId ?? "-"}`, `run=${c.runId ?? "-"}`];
  if (c.parentRunId) parts.push(`parent=${c.parentRunId}`);
  if (c.taskId) parts.push(`task=${c.taskId}`);
  if (c.agentId) parts.push(`agent=${c.agentId}`);
  if (c.toolCallId) parts.push(`tool=${c.toolCallId}`);
  if (c.modelCallId) parts.push(`model=${c.modelCallId}`);
  return parts.join(" ");
}
