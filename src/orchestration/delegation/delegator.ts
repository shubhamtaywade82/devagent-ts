/**
 * Delegator — delegation as a first-class runtime primitive
 * (review items 25 + 26).
 *
 *   DelegationRequest    what the parent wants done (goal, capabilities,
 *                         optional child agent, budget share, context handoff)
 *   DelegationPolicy     who may delegate to whom, max children, what
 *                         inherits (budget, context, policy, cancellation)
 *   ChildExecution       the isolated child run: own runId, budget,
 *                         context, cancellation, permissions, checkpoint
 *   ResultAggregation    how child results fold back into the parent
 *                         observation
 *
 * Capability-driven (review item 24): when the request does not pin a
 * child agent id, the delegator ASKS the AgentRegistry which registered
 * agent's capabilities satisfy the request, instead of name matching.
 */

import type {
  AgentRuntime,
  ContextManager,
  EventSink,
  ExecutionRequest,
  ExecutionContext,
  ExecutionResult,
} from "../../core/types.js";
import { childExecutionContext } from "../../runtime/context/execution-context.js";
import { BudgetManager } from "../../runtime/budget/budget-manager.js";
import type { AgentRegistry } from "../../runtime/agent/agent-runtime.js";
import { newDelegationId } from "../../core/identity.js";
import type { RunRecorder } from "../../runtime/persistence/execution-recorder.js";

// ── Contracts ───────────────────────────────────────────────────────────────

export interface DelegationRequest {
  /** What the child should accomplish. */
  goal: string;
  /** Capabilities the child must have (drives agent selection). */
  requiredCapabilities?: string[];
  /** Pin a specific child agent (skips capability matching). */
  childAgentId?: string;
  /** Inputs handed to the child (context handoff). */
  input?: string;
  /** Fraction of the parent's remaining budget granted to the child (default 0.5). */
  budgetShare?: number;
  /** Max tool turns for the child run. */
  maxToolTurns?: number;
  /** Transcript seeds the child starts from (usually a distilled summary). */
  contextHandoff?: string[];
  metadata?: Record<string, unknown>;
}

export interface DelegationPolicy {
  /** Which agents this parent may delegate to (empty = any registered). */
  allowedChildAgents?: string[];
  /** Hard cap on concurrent children per parent (default 2). */
  maxConcurrentChildren?: number;
  /** Hard cap on total children per parent run (default 8). */
  maxTotalChildren?: number;
  /** Child inherits the parent's policy engine (default true — policies narrow, never widen). */
  inheritPolicy?: boolean;
  /** Cancel children when the parent aborts (default true). */
  cancelWithParent?: boolean;
}

export interface DelegationPolicyDecision {
  allowed: boolean;
  reason: string;
  childAgentId?: string;
}

export interface ChildExecution {
  delegationId: string;
  childRunId: string;
  childAgentId: string;
  request: DelegationRequest;
  promise: Promise<ExecutionResult>;
  /** Abort just this child (not the parent). */
  cancel(): void;
}

export interface DelegatedResult {
  delegationId: string;
  childRunId: string;
  childAgentId: string;
  status: ExecutionResult["status"];
  output: string;
  error?: string;
}

/** ResultAggregation — how child results become the parent observation. */
export interface ResultAggregation {
  /** Fold one completed child into an observation string. */
  observe(child: DelegatedResult, all: DelegatedResult[]): string;
}

export const defaultAggregation: ResultAggregation = {
  observe(child, all) {
    const header = `[delegated ${child.childAgentId}] ${child.status}`;
    if (child.status === "completed") {
      return `${header}\n${child.output}`;
    }
    const others = all.filter((r) => r.delegationId !== child.delegationId && r.status === "completed");
    const lines = [header, child.error ?? ""];
    if (others.length > 0) {
      lines.push(`other completed children (${others.length}):`);
      for (const o of others.slice(0, 3)) lines.push(`- ${o.childAgentId}: ${(o.output ?? "").slice(0, 200)}`);
    }
    const stillRunning = all.length - others.length - 1;
    if (stillRunning > 0) lines.push(`(${stillRunning} children still running)`);
    return lines.filter(Boolean).join("\n");
  },
};

// ── Delegator ───────────────────────────────────────────────────────────────

export interface DelegatorOptions {
  runtime: AgentRuntime;
  agents: AgentRegistry;
  /** Where delegated child runs report events (usually the parent sink). */
  events?: EventSink;
  /** Durable recorder for delegation links (review item 13). */
  recorder?: RunRecorder;
  aggregation?: ResultAggregation;
}

interface ChildRecord {
  execution: ChildExecution;
  done: boolean;
}

export class Delegator {
  private readonly children = new Map<string, ChildRecord>();
  private totalChildren = 0;

  constructor(private readonly opts: DelegatorOptions) {}

  /** Decide (without executing) whether a delegation is permitted + who serves it. */
  review(parent: ExecutionContext, request: DelegationRequest, policy: DelegationPolicy = {}): DelegationPolicyDecision {
    const maxTotal = policy.maxTotalChildren ?? 8;
    if (this.totalChildren >= maxTotal) {
      return { allowed: false, reason: `delegation budget exhausted (${this.totalChildren}/${maxTotal} children)` };
    }
    const maxConcurrent = policy.maxConcurrentChildren ?? 2;
    const active = [...this.children.values()].filter((c) => !c.done).length;
    if (active >= maxConcurrent) {
      return { allowed: false, reason: `too many concurrent children (${active}/${maxConcurrent})` };
    }

    let childAgentId = request.childAgentId;
    if (!childAgentId) {
      childAgentId = this.matchByCapability(request);
      if (!childAgentId) {
        return {
          allowed: false,
          reason: `no registered agent satisfies capabilities [${(request.requiredCapabilities ?? []).join(", ")}]`,
        };
      }
    }
    if (
      policy.allowedChildAgents &&
      policy.allowedChildAgents.length > 0 &&
      !policy.allowedChildAgents.includes(childAgentId)
    ) {
      return { allowed: false, reason: `agent "${childAgentId}" is not an allowed delegation target` };
    }
    void parent;
    return { allowed: true, reason: "capability match", childAgentId };
  }

  /**
   * Delegate: derive an isolated child context (own runId, budget, context,
   * cancellation, permissions — review item 26), execute through the
   * AgentRuntime, record the delegation link, and return a ChildExecution
   * handle whose promise resolves with the child's result.
   */
  delegate(
    parent: ExecutionContext,
    request: DelegationRequest,
    policy: DelegationPolicy = {},
    options?: {
      context?: ContextManager;
      events?: EventSink;
    },
  ): ChildExecution {
    const review = this.review(parent, request, policy);
    if (!review.allowed || !review.childAgentId) {
      throw new Error(`delegation refused: ${review.reason}`);
    }
    const childAgentId = review.childAgentId;
    const delegationId = newDelegationId();
    this.totalChildren += 1;

    // child budget: derived from the parent's (inherits ceilings; child
    // consumption propagates upward — review items 14 + 26)
    const parentManager = parent.budget instanceof BudgetManager ? parent.budget : undefined;
    const childManager = parentManager?.deriveChild({
      budget: undefined,
      share: request.budgetShare ?? 0.5,
    });

    const childRequest: ExecutionRequest = {
      agentId: childAgentId,
      task: {
        goal: request.goal,
        input: request.input,
        constraints: [],
        metadata: {
          ...(request.metadata ?? {}),
          delegationId,
          parentRunId: parent.runId,
          delegated: true,
        },
      },
    };

    const context = childExecutionContext(parent, childRequest, {
      budgetManager: childManager,
      context: options?.context,
      events: options?.events ?? parent.events,
      metadata: { delegationId, delegated: true },
    });

    this.opts.recorder?.delegationStarted(delegationId, childAgentId, request.goal);

    const promise = this.opts.runtime
      .execute(childRequest, context, { maxToolTurns: request.maxToolTurns })
      .then((result) => {
        this.opts.recorder?.delegationCompleted(delegationId, result.runId, result.status, result.output);
        const record = this.children.get(delegationId);
        if (record) record.done = true;
        return result;
      })
      .catch((e) => {
        const record = this.children.get(delegationId);
        if (record) record.done = true;
        throw e;
      });

    const execution: ChildExecution = {
      delegationId,
      childRunId: context.runId,
      childAgentId,
      request,
      promise,
      // child cancellation: the runtime's cancel(runId) is the sanctioned
      // path; it aborts the child's signal without touching the parent.
      cancel: () => {
        this.opts.runtime.cancel?.(context.runId);
      },
    };
    this.children.set(delegationId, { execution, done: false });
    return execution;
  }

  /** Await a child and fold its result into a parent observation. */
  async observe(child: ChildExecution): Promise<DelegatedResult> {
    try {
      const result = await child.promise;
      return {
        delegationId: child.delegationId,
        childRunId: child.childRunId,
        childAgentId: child.childAgentId,
        status: result.status,
        output: result.output,
        error: result.error,
      };
    } catch (e) {
      return {
        delegationId: child.delegationId,
        childRunId: child.childRunId,
        childAgentId: child.childAgentId,
        status: "failed",
        output: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** Aggregate several children into one observation (ResultAggregation). */
  aggregate(results: DelegatedResult[]): string {
    const agg = this.opts.aggregation ?? defaultAggregation;
    return results.map((r) => agg.observe(r, results)).join("\n\n");
  }

  activeChildren(): ChildExecution[] {
    return [...this.children.values()].filter((c) => !c.done).map((c) => c.execution);
  }

  /** Capability-driven matching (review item 24). */
  private matchByCapability(request: DelegationRequest): string | undefined {
    const required = request.requiredCapabilities ?? [];
    if (required.length === 0) return undefined;
    for (const descriptor of this.opts.agents.all()) {
      const caps = descriptor.capabilities ?? [];
      if (required.every((r) => caps.includes(r))) return descriptor.id;
    }
    return undefined;
  }
}
