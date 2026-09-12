/**
 * Planner — the control plane's decomposition port (review item 2).
 *
 * Input: a task (goal + constraints). Output: an ordered TaskGraph.
 * Implementations: LlmPlanner (delegates to a model via the legacy
 * generatePlan), StaticPlanner (deterministic single-node graph),
 * products may register their own.
 *
 * The orchestrator/ASL machinery (steps + rollback commands) is expressed
 * on top of TaskGraph nodes now: a PlanStep is a TaskNode with
 * `rollbackCommand` metadata.
 */

import type { TaskSpec } from "../core/types.js";
import { TaskGraph, TaskNode } from "../core/tasks/task-graph.js";
import type { ChatMessage, ChatOptions, ChatResponse } from "../models/adapters/provider.js";

export interface Planner {
  plan(task: TaskSpec, opts?: PlannerOptions): Promise<TaskGraph>;
  /** Replan the remaining work after a failure (keeps completed history). */
  replan(task: TaskSpec, graph: TaskGraph, history: PlannerHistoryEntry[]): Promise<TaskGraph>;
}

export interface PlannerOptions {
  /** Model-capability hint for LLM planners. */
  capability?: string;
  /** Max nodes the planner may emit (safety). */
  maxNodes?: number;
}

export interface PlannerHistoryEntry {
  nodeId: string;
  goal: string;
  outcome: "success" | "failure" | "skipped";
  error?: string;
}

/**
 * Static single-node planner: one node, no dependencies. The honest
 * default for products that don't plan (a ReAct run IS one node).
 */
export class StaticPlanner implements Planner {
  async plan(task: TaskSpec): Promise<TaskGraph> {
    const graph = new TaskGraph();
    graph.add({ id: "root", goal: task.goal, metadata: { static: true } });
    return graph;
  }

  async replan(task: TaskSpec, graph: TaskGraph): Promise<TaskGraph> {
    const failed = graph
      .all()
      .filter((n) => n.status === "failed" || n.status === "pending" || n.status === "ready" || n.status === "blocked");
    if (failed.length === 0) return graph;
    const retry = new TaskGraph();
    retry.add({ id: "root", goal: `${task.goal} (retry: ${failed.map((n) => n.goal).join("; ")})` });
    return retry;
  }
}

/** Chat surface an LLM planner needs (satisfied by Provider or ModelGateway adapters). */
export interface PlannerChatClient {
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
}

/**
 * LLM-backed planner: prompts the model to decompose the goal into
 * ordered steps with dependencies, parses defensively (JSON array with
 * fallback to numbered lines — mirroring the legacy generatePlan
 * behavior), and compiles a TaskGraph.
 */
export class LlmPlanner implements Planner {
  constructor(
    private readonly chat: PlannerChatClient,
    private readonly maxNodes = 12,
  ) {}

  async plan(task: TaskSpec, opts?: PlannerOptions): Promise<TaskGraph> {
    const maxNodes = opts?.maxNodes ?? this.maxNodes;
    const prompt: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are a task planner. Decompose the goal into ordered steps. Reply ONLY with a JSON array like " +
          '[{"goal": "step description", "dependencies": ["ids of prior steps"], "priority": "normal", ' +
          '"exclusive": false, "resourceLocks": ["git"], "rollbackCommand": "optional shell"}]. ' +
          `Use at most ${maxNodes} steps. Use short ids ("s1", "s2"). ` +
          "Mark steps that must run alone as exclusive. Declare resourceLocks " +
          '("git", "database", "browser", "workspace-write") only when the step truly needs the resource.',
      },
      {
        role: "user",
        content: task.goal + (task.constraints?.length ? `\n\nConstraints:\n- ${task.constraints.join("\n- ")}` : ""),
      },
    ];
    const response = await this.chat.chat(prompt, {});
    return parsePlanIntoGraph(response.message?.content ?? "", this.maxNodes);
  }

  async replan(task: TaskSpec, graph: TaskGraph, history: PlannerHistoryEntry[]): Promise<TaskGraph> {
    const remaining = graph
      .all()
      .filter((n) => ["pending", "ready", "blocked", "failed"].includes(n.status))
      .map((n) => ({ goal: n.goal, id: n.id }));
    const prompt: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are replanning a partially-executed task graph. The steps listed failed or are unfinished. " +
          "Reply ONLY with a JSON array of replacement steps (same shape: goal, dependencies, priority, exclusive, resourceLocks).",
      },
      {
        role: "user",
        content: `Original goal: ${task.goal}\n\nCompleted: ${history
          .filter((h) => h.outcome === "success")
          .map((h) => `- ${h.goal}`)
          .join("\n")}\n\nUnfinished:\n${remaining.map((r) => `- ${r.id}: ${r.goal}`).join("\n")}`,
      },
    ];
    const response = await this.chat.chat(prompt, {});
    return parsePlanIntoGraph(response.message?.content ?? "", this.maxNodes);
  }
}

/** Defensive plan parsing: JSON array, then numbered lines, then one node. */
export function parsePlanIntoGraph(raw: string, maxNodes = 12): TaskGraph {
  const graph = new TaskGraph();
  const trimmed = (raw ?? "").trim();

  // strip markdown fences
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    parsed = undefined;
  }

  if (Array.isArray(parsed)) {
    let index = 0;
    for (const item of parsed) {
      if (index >= maxNodes) break;
      if (typeof item === "string") {
        graph.add({ id: `s${index + 1}`, goal: item, dependencies: index > 0 ? [`s${index}`] : [] });
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        graph.add({
          id: typeof obj.id === "string" ? obj.id : `s${index + 1}`,
          goal: typeof obj.goal === "string" ? obj.goal : `step ${index + 1}`,
          dependencies: Array.isArray(obj.dependencies)
            ? obj.dependencies.filter((d): d is string => typeof d === "string")
            : index > 0
              ? [`s${index}`]
              : [],
          priority: obj.priority === "critical" ? "critical" : "normal",
          exclusive: obj.exclusive === true,
          resourceLocks: Array.isArray(obj.resourceLocks)
            ? obj.resourceLocks.filter((r): r is string => typeof r === "string")
            : undefined,
          metadata: {
            rollbackCommand: typeof obj.rollbackCommand === "string" ? obj.rollbackCommand : undefined,
          },
        });
      }
      index += 1;
    }
  } else if (unfenced) {
    // numbered-line fallback
    const lines = unfenced
      .split("\n")
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
      .filter((l) => l.length > 3);
    lines.slice(0, maxNodes).forEach((line, i) => {
      graph.add({ id: `s${i + 1}`, goal: line, dependencies: i > 0 ? [`s${i}`] : [] });
    });
  }

  if (graph.size() === 0) {
    graph.add({ id: "s1", goal: trimmed.slice(0, 200) || "(unparsed plan — single step)" });
  }

  const problems = graph.validate();
  if (problems.length > 0) {
    // cycles are collapsed into serial execution (drop the offending edges)
    for (const node of graph.all()) {
      node.dependencies = node.dependencies.filter((d) => d !== node.id);
    }
  }
  return graph;
}

/** Compile the legacy PlanStep[] shape into a TaskGraph (migration bridge). */
export function graphFromPlanSteps(
  steps: Array<{ id: string; goal: string; description?: string; dependencies?: string[]; priority?: string }>,
): TaskGraph {
  const graph = new TaskGraph();
  for (const step of steps) {
    graph.add({
      id: step.id,
      goal: step.goal ?? step.description ?? step.id,
      dependencies: step.dependencies,
      priority: step.priority === "critical" ? "critical" : "normal",
    });
  }
  return graph;
}

/** Project a TaskGraph back into the legacy PlanStep shape (TUI compat). */
export function planStepsFromGraph(graph: TaskGraph): TaskNode[] {
  return graph.all();
}
