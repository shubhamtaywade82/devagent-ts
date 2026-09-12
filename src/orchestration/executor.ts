/**
 * Executor — runs what the Scheduler claims (review item 2).
 *
 * Maps a TaskNode onto a kernel ExecutionRequest and drives it through
 * the AgentRuntime (cancellation, budgets, policy, events all ride the
 * kernel context). The control plane's orchestrator is expressed on top:
 * Planner → TaskGraph → Scheduler → Executor → AgentRuntime.
 *
 * Outcome mapping (mirrors the proven runtime-step-runner semantics):
 *   completed            → success
 *   failed / timeout     → failure (retryable via the node's retry budget)
 *   cancelled / budget   → blocked (needs operator attention, not a retry)
 */

import type {
  AgentRuntime,
  ExecutionRequest,
  ExecutionResult,
  StrategyExecuteOptions,
} from "../core/types.js";
import type { TaskNode } from "../core/tasks/task-graph.js";
import { RunId, TaskSpec } from "../core/types.js";
import type { EventSink } from "../core/types.js";

export interface ExecutorOptions {
  runtime: AgentRuntime;
  /** Fixed agent id for all nodes (default "devagent"). */
  agentId?: string;
  /** Strategy override (default: the agent descriptor's). */
  strategy?: ExecutionRequest["strategy"];
  /** Events sink for execution.* projections (optional). */
  events?: EventSink;
  /** Per-node strategy options (hooks, maxToolTurns). */
  strategyOptions?: StrategyExecuteOptions;
  /** Mark node results with the parent run id (correlation). */
  parentRunId?: RunId;
}

export interface NodeExecution {
  nodeId: string;
  runId?: RunId;
  outcome: "success" | "failure" | "blocked";
  result?: ExecutionResult;
  durationMs?: number;
}

/** The unit the Executor hands the runtime. */
export interface NodeTaskSpec extends TaskSpec {
  metadata?: Record<string, unknown>;
}

export class Executor {
  constructor(private readonly opts: ExecutorOptions) {}

  /** Execute one scheduled node through the AgentRuntime. */
  async executeNode(
    node: TaskNode,
    contextFactory: (node: TaskNode) => Parameters<AgentRuntime["execute"]>[1],
  ): Promise<NodeExecution> {
    const startedAt = Date.now();
    const request: ExecutionRequest = {
      agentId: (node.metadata.agentId as string) ?? this.opts.agentId ?? "devagent",
      task: {
        goal: node.goal,
        constraints: [],
        metadata: {
          ...(node.metadata ?? {}),
          nodeId: node.id,
          nodePriority: node.priority,
          parentRunId: this.opts.parentRunId,
        },
      },
      strategy: (node.metadata.strategy as ExecutionRequest["strategy"]) ?? this.opts.strategy,
      capabilities: (node.metadata.capabilities as string[] | undefined) ?? undefined,
      mode: node.metadata.mode as string | undefined,
    };

    this.opts.events?.publish({ type: "node.start", id: node.id, kind: "task", title: node.goal });

    try {
      const result = await this.opts.runtime.execute(
        request,
        contextFactory(node),
        this.opts.strategyOptions,
      );
      const outcome = mapOutcome(result);
      if (outcome === "success") {
        this.opts.events?.publish({
          type: "node.complete",
          id: node.id,
          durationMs: Date.now() - startedAt,
          details: { output: (result.output ?? "").slice(0, 400) },
        });
      } else {
        this.opts.events?.publish({
          type: "node.fail",
          id: node.id,
          error: result.error ?? result.status,
          details: { status: result.status },
        });
      }
      return {
        nodeId: node.id,
        runId: result.runId,
        outcome,
        result,
        durationMs: Date.now() - startedAt,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.opts.events?.publish({ type: "node.fail", id: node.id, error });
      return { nodeId: node.id, outcome: "failure", durationMs: Date.now() - startedAt };
    }
  }
}

export function mapOutcome(result: ExecutionResult): "success" | "failure" | "blocked" {
  switch (result.status) {
    case "completed":
      return "success";
    case "failed":
    case "timeout":
      return "failure";
    case "cancelled":
    case "budget_exhausted":
      return "blocked";
  }
}
