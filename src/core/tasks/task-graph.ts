/**
 * TaskGraph — the dependency-aware work graph (review items 2 + 34).
 *
 * A control-plane data structure: nodes (goal + dependencies + scheduling
 * metadata) with a state machine per node. The Scheduler walks it;
 * the Executor runs ready nodes; the GraphStrategy compiles one inside a
 * single run. Deliberately core-level (no I/O, no strategies, no domains)
 * so every plane can consume it.
 *
 * Scheduling metadata (review item 34):
 *   dependencies     DAG edges (serial ordering)
 *   priority         "critical" | "normal" (two-lane queues)
 *   deadlineMs       per-node wall-clock deadline
 *   resourceLocks    named locks (e.g. "git", "db") — nodes sharing a lock
 *                    serialize; enough locks → parallel
 *   exclusive        node must run ALONE (no other node in flight)
 *   maxRetries       retry budget per node
 */

import { newTaskId } from "../identity.js";

export type TaskPriority = "critical" | "normal";

export type GraphNodeStatus =
  "pending" | "ready" | "running" | "blocked" | "completed" | "failed" | "cancelled" | "skipped";

/** Valid transitions (superset of runtime task-machine's 6 states). */
const TRANSITIONS: Record<GraphNodeStatus, GraphNodeStatus[]> = {
  pending: ["ready", "failed", "blocked", "cancelled", "skipped"],
  ready: ["running", "failed", "blocked", "cancelled", "skipped"],
  running: ["completed", "failed", "blocked", "cancelled"],
  blocked: ["ready", "pending", "cancelled", "skipped"],
  failed: ["ready", "pending", "cancelled", "skipped"], // retry path: failed → ready
  completed: [],
  cancelled: [],
  skipped: [],
};

export interface TaskNodeSpec {
  id?: string;
  goal: string;
  /** Node ids that must complete before this one becomes ready. */
  dependencies?: string[];
  priority?: TaskPriority;
  /** Per-node wall-clock deadline (relative to schedule start). */
  deadlineMs?: number;
  /** Named resources this node holds while running (serialize on collision). */
  resourceLocks?: string[];
  /** This node must run alone (no other node in flight). */
  exclusive?: boolean;
  /** Retry budget (default 0). */
  maxRetries?: number;
  /** Extra payload (strategy hints, tool capabilities, agent routing). */
  metadata?: Record<string, unknown>;
}

export interface TaskNode extends Required<Pick<TaskNodeSpec, "goal">> {
  id: string;
  dependencies: string[];
  priority: TaskPriority;
  deadlineMs?: number;
  resourceLocks: string[];
  exclusive: boolean;
  maxRetries: number;
  metadata: Record<string, unknown>;
  status: GraphNodeStatus;
  attempt: number;
  addedAt: number;
}

export class TaskGraph {
  private readonly nodes = new Map<string, TaskNode>();

  add(spec: TaskNodeSpec): TaskNode {
    const id = spec.id ?? newTaskId();
    if (this.nodes.has(id)) {
      throw new Error(`task graph already has a node "${id}"`);
    }
    const node: TaskNode = {
      id,
      goal: spec.goal,
      dependencies: [...(spec.dependencies ?? [])],
      priority: spec.priority ?? "normal",
      deadlineMs: spec.deadlineMs,
      resourceLocks: [...(spec.resourceLocks ?? [])],
      exclusive: spec.exclusive ?? false,
      maxRetries: spec.maxRetries ?? 0,
      metadata: { ...(spec.metadata ?? {}) },
      status: "pending",
      attempt: 0,
      addedAt: Date.now(),
    };
    this.nodes.set(id, node);
    return node;
  }

  get(id: string): TaskNode | undefined {
    return this.nodes.get(id);
  }

  require(id: string): TaskNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`task graph has no node "${id}"`);
    return node;
  }

  all(): TaskNode[] {
    return [...this.nodes.values()];
  }

  size(): number {
    return this.nodes.size;
  }

  /** Detect dependency cycles + unknown deps (fail fast at build time). */
  validate(): string[] {
    const problems: string[] = [];
    for (const node of this.nodes.values()) {
      for (const dep of node.dependencies) {
        if (!this.nodes.has(dep)) problems.push(`node "${node.id}" depends on unknown node "${dep}"`);
      }
    }
    // DFS cycle detection
    const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
    const visit = (id: string, stack: string[]): void => {
      const s = state.get(id);
      if (s === 2) return;
      if (s === 1) {
        problems.push(`dependency cycle: ${[...stack, id].slice(stack.indexOf(id)).join(" → ")}`);
        return;
      }
      state.set(id, 1);
      for (const dep of this.nodes.get(id)?.dependencies ?? []) visit(dep, [...stack, id]);
      state.set(id, 2);
    };
    for (const node of this.nodes.values()) visit(node.id, []);
    return problems;
  }

  /** Node state transition; invalid transitions are ignored (not thrown). */
  transition(id: string, to: GraphNodeStatus): TaskNode {
    const node = this.require(id);
    if (TRANSITIONS[node.status].includes(to)) {
      node.status = to;
      if (to === "running") node.attempt += 1;
    }
    return node;
  }

  /** Mark a node for retry: failed → ready (consumes the retry budget). */
  retry(id: string): boolean {
    const node = this.require(id);
    if (node.status !== "failed") return false;
    if (node.attempt > node.maxRetries) return false;
    this.transition(id, "ready");
    return true;
  }

  /** Nodes whose dependencies are all completed (ready to schedule). */
  readyNodes(): TaskNode[] {
    return this.all().filter((n) => n.status === "pending" && this.depsSatisfied(n));
  }

  /** Nodes currently running. */
  runningNodes(): TaskNode[] {
    return this.all().filter((n) => n.status === "running");
  }

  /** Cascade: mark all transitively-dependent nodes of a failed node skipped. */
  cascadeSkip(fromId: string, reason = "dependency failed"): TaskNode[] {
    const skipped: TaskNode[] = [];
    const queue = [fromId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const node of this.all()) {
        if (node.dependencies.includes(current) && !seen.has(node.id)) {
          seen.add(node.id);
          if (["pending", "ready", "blocked"].includes(node.status)) {
            node.status = "skipped";
            node.metadata.skipReason = reason;
            skipped.push(node);
            queue.push(node.id);
          }
        }
      }
    }
    return skipped;
  }

  /** State summary (terminal + in-flight counts). */
  summary(): {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    cancelled: number;
    blocked: number;
    pending: number;
    running: number;
  } {
    const counts = {
      total: this.nodes.size,
      completed: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      blocked: 0,
      pending: 0,
      running: 0,
    };
    for (const node of this.nodes.values()) {
      if (node.status === "completed") counts.completed++;
      else if (node.status === "failed") counts.failed++;
      else if (node.status === "skipped") counts.skipped++;
      else if (node.status === "cancelled") counts.cancelled++;
      else if (node.status === "blocked") counts.blocked++;
      else if (node.status === "running") counts.running++;
      else counts.pending++;
    }
    return counts;
  }

  /** Whether every node reached a terminal state. */
  settled(): boolean {
    return this.all().every((n) => ["completed", "failed", "skipped", "cancelled"].includes(n.status));
  }

  private depsSatisfied(node: TaskNode): boolean {
    return node.dependencies.every((dep) => {
      const d = this.nodes.get(dep);
      return d?.status === "completed";
    });
  }

  /** Static topological order (ignores state) — used for display and checks. */
  topologicalOrder(): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const dep of this.nodes.get(id)?.dependencies ?? []) visit(dep);
      order.push(id);
    };
    for (const node of this.nodes.values()) visit(node.id);
    return order;
  }

  /** Serialize for checkpoints / the TUI execution DAG overlay. */
  toJSON(): TaskNode[] {
    return this.all();
  }

  static fromJSON(nodes: TaskNode[]): TaskGraph {
    const graph = new TaskGraph();
    for (const n of nodes) {
      graph.nodes.set(n.id, {
        ...n,
        dependencies: [...n.dependencies],
        resourceLocks: [...n.resourceLocks],
        metadata: { ...n.metadata },
      });
    }
    return graph;
  }
}
