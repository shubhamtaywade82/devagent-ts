/**
 * Persistence state model (review item 32) — one ownership map for every
 * durable record in Nexum.
 *
 *   Tenant
 *     └─ Session                       (runtime/session.ts — SessionStore)
 *          └─ Run                      (runs/<runId>.jsonl — ExecutionEventStore)
 *               ├─ Task                (control plane; persisted in run events)
 *               │    └─ Step
 *               ├─ ToolInvocation      (tool.started/completed/failed events)
 *               ├─ ModelCall           (model.answered events)
 *               ├─ PolicyDecision      (policy.decision events)
 *               ├─ Checkpoint          (checkpoints/<runId>.json — CheckpointStore)
 *               ├─ Approval            (approval.requested/resolved events)
 *               └─ Event               (EventEnvelope records, seq-ordered)
 *
 * Every entity id comes from core/identity (prefixed UUIDs) so records
 * correlate unambiguously (review item 33). Domain stores (memory, docs,
 * lessons, rails-index) hang off the workspace, not the run tree — they are
 * domain-scoped caches, not execution history.
 *
 * The record types below are the durable projections the
 * ExecutionEventStore reconstructs on replay.
 */

import type {
  AgentId,
  CheckpointId,
  CorrelationIds,
  EventId,
  RunId,
  SessionId,
  TaskId,
  ToolCallId,
  ModelCallId,
  TraceId,
  DelegationId,
  IdempotencyKey,
  TenantId,
} from "../../core/identity.js";
import type { ExecutionStatus } from "../../core/types.js";

// ── Entity records ──────────────────────────────────────────────────────────

export interface RunRecord {
  runId: RunId;
  traceId: TraceId;
  parentRunId?: RunId;
  sessionId: SessionId;
  tenantId?: TenantId;
  agentId: AgentId;
  taskId?: TaskId;
  goal: string;
  strategy?: string;
  status: ExecutionStatus | "running";
  startedAt: number;
  endedAt?: number;
  eventCount: number;
}

export interface TaskInvocationSummary {
  taskId: TaskId;
  goal: string;
  status: string;
  runId?: RunId;
}

export interface ToolInvocationRecord {
  toolCallId: ToolCallId;
  runId: RunId;
  tool: string;
  args: Record<string, unknown>;
  status: "started" | "completed" | "failed";
  result?: Record<string, unknown>;
  error?: string;
  ts: number;
  durationMs?: number;
  correlation: CorrelationIds;
}

export interface ModelCallRecord {
  modelCallId: ModelCallId;
  runId: RunId;
  tier: string;
  model: string;
  ts: number;
  correlation: CorrelationIds;
}

export interface PolicyDecisionRecord {
  runId: RunId;
  tool: string;
  allowed: boolean;
  requireConfirmation: boolean;
  reason: string;
  rule?: string;
  ts: number;
  correlation: CorrelationIds;
}

export interface ApprovalRecord {
  runId: RunId;
  approvalId: string;
  summary: string;
  approved: boolean | null; // null = still pending
  requestedAt: number;
  resolvedAt?: number;
  correlation: CorrelationIds;
}

export interface CheckpointRecord {
  checkpointId: CheckpointId;
  runId: RunId;
  ts: number;
  steps?: unknown;
  metadata?: Record<string, unknown>;
}

export interface DelegationRecord {
  delegationId: DelegationId;
  parentRunId: RunId;
  childRunId: RunId;
  childAgentId: AgentId;
  goal: string;
  ts: number;
}

export interface IdempotencyRecord {
  idempotencyKey: IdempotencyKey;
  tool: string;
  runId: RunId;
  firstSeenTs: number;
  result?: Record<string, unknown>;
  status: "recorded" | "completed" | "failed";
}

// ── Ownership contract ──────────────────────────────────────────────────────

/**
 * Which store owns which entity. Enforced by convention + tests: a store
 * may READ anything, but only its owned entities are written by it.
 */
export const PERSISTENCE_OWNERSHIP = {
  tenant: "workspace (platform/workspace.ts)",
  session: "SessionStore (runtime/session.ts)",
  run: "ExecutionEventStore (runtime/persistence/execution-event-store.ts)",
  task: "run events (control plane writes via recorder)",
  step: "run events (control plane writes via recorder)",
  toolInvocation: "run events (ExecutionRecorder)",
  modelCall: "run events (ExecutionRecorder)",
  policyDecision: "run events (ExecutionRecorder)",
  checkpoint: "CheckpointStore (runtime/checkpoint.ts)",
  approval: "run events (ExecutionRecorder)",
  event: "ExecutionEventStore (append-only)",
  delegation: "run events (Delegator)",
  idempotency: "IdempotencyManager (tools/idempotency.ts)",
} as const;

export type PersistenceEntity = keyof typeof PERSISTENCE_OWNERSHIP;

/** Directory layout for durable execution history (under `.nexum/`). */
export const RUN_STATE_LAYOUT = {
  runsDir: "runs", // .nexum/runs/<runId>.events.jsonl
  runEventsFile: (runId: RunId) => `${runId}.events.jsonl`,
  runIndexFile: "runs/index.jsonl",
  checkpointsDir: "checkpoints", // .nexum/checkpoints/
  sessionsDir: "sessions", // .nexum/sessions/
} as const;

// ── Replay projection (review item 13) ──────────────────────────────────────

/** Everything reconstructible from one run's event log. */
export interface RunReplay {
  run: RunRecord;
  envelopes: Array<{ id: EventId; seq: number; ts: number; type: string; correlation: CorrelationIds }>;
  toolInvocations: ToolInvocationRecord[];
  modelCalls: ModelCallRecord[];
  approvals: ApprovalRecord[];
  delegations: DelegationRecord[];
}

/** Progressively fold envelopes into the replay projection. */
export class ReplayProjector {
  private readonly tools = new Map<string, ToolInvocationRecord>();
  private readonly models: ModelCallRecord[] = [];
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly delegations: DelegationRecord[] = [];

  constructor(private readonly run: RunRecord) {}

  fold(event: { type: string } & Record<string, any>, correlation: CorrelationIds, ts: number, seq: number): void {
    switch (event.type) {
      case "tool.started":
        this.tools.set(event.id, {
          toolCallId: event.id,
          runId: this.run.runId,
          tool: event.name,
          args: event.args ?? {},
          status: "started",
          ts,
          correlation,
        });
        break;
      case "tool.completed": {
        const prior = this.tools.get(event.id);
        if (prior) {
          prior.status = "completed";
          prior.result = event.result;
          prior.durationMs = ts - prior.ts;
        } else {
          this.tools.set(event.id, {
            toolCallId: event.id,
            runId: this.run.runId,
            tool: "(unknown)",
            args: {},
            status: "completed",
            result: event.result,
            ts,
            correlation,
          });
        }
        break;
      }
      case "tool.failed": {
        const prior = this.tools.get(event.id);
        if (prior) {
          prior.status = "failed";
          prior.error = event.error;
          prior.durationMs = ts - prior.ts;
        } else {
          this.tools.set(event.id, {
            toolCallId: event.id,
            runId: this.run.runId,
            tool: "(unknown)",
            args: {},
            status: "failed",
            error: event.error,
            ts,
            correlation,
          });
        }
        break;
      }
      case "model.answered":
        this.models.push({
          modelCallId: `mc_${this.models.length + 1}`,
          runId: this.run.runId,
          tier: event.tier,
          model: event.model,
          ts,
          correlation,
        });
        break;
      case "approval.requested":
        this.approvals.set(event.request?.id ?? `ap_${seq}`, {
          runId: this.run.runId,
          approvalId: event.request?.id ?? `ap_${seq}`,
          summary: event.request?.summary ?? event.request?.command ?? "(approval)",
          approved: null,
          requestedAt: ts,
          correlation,
        });
        break;
      case "approval.resolved": {
        // match by id when present, else the latest pending approval
        const key = event.id ?? this.lastPendingApprovalId();
        const rec = this.approvals.get(key);
        if (rec) {
          rec.approved = event.approved;
          rec.resolvedAt = ts;
        }
        break;
      }
      case "node.start":
        if (event.kind === "delegation" && event.parentId) {
          this.delegations.push({
            delegationId: event.id,
            parentRunId: this.run.runId,
            childRunId: event.id,
            childAgentId: String(event.details?.agentId ?? "unknown"),
            goal: event.title,
            ts,
          });
        }
        break;
      default:
        break;
    }
  }

  private lastPendingApprovalId(): string {
    let pending = "";
    for (const [id, rec] of this.approvals) if (rec.approved === null) pending = id;
    return pending;
  }

  finish(endedAt?: number, status: ExecutionStatus | "running" = "completed"): RunReplay {
    return {
      run: { ...this.run, status, endedAt, eventCount: this.run.eventCount },
      envelopes: [],
      toolInvocations: [...this.tools.values()],
      modelCalls: this.models,
      approvals: [...this.approvals.values()],
      delegations: this.delegations,
    };
  }
}
