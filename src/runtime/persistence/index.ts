/**
 * Runtime persistence plane — durable execution history (review items 13/32).
 *
 *   ExecutionEventStore   append-only JSONL logs per run + run index
 *   ExecutionRecorder     bridges live events → envelopes → store
 *   state model           Tenant→Session→Run→Task/Step→ToolInvocation/
 *                         ModelCall/PolicyDecision/Checkpoint/Approval/Event
 *
 * Replay/recovery: `store.replay(runId)` folds a log back into
 * projections (tool invocations, model calls, approvals, delegations).
 */

export { ExecutionEventStore, type ExecutionEventStoreOptions } from "./execution-event-store.js";
export { ExecutionRecorder, RunRecorder, type ExecutionRecorderOptions } from "./execution-recorder.js";
export {
  ReplayProjector,
  PERSISTENCE_OWNERSHIP,
  RUN_STATE_LAYOUT,
  type RunRecord,
  type RunReplay,
  type ToolInvocationRecord,
  type ModelCallRecord,
  type PolicyDecisionRecord,
  type ApprovalRecord,
  type CheckpointRecord,
  type DelegationRecord,
  type IdempotencyRecord,
  type TaskInvocationSummary,
  type PersistenceEntity,
} from "./state-model.js";
