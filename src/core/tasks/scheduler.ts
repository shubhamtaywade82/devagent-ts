/**
 * Scheduler — dependency-aware, resource-locked, deadline-bound execution
 * ordering (review items 2 + 34).
 *
 * Wraps a TaskGraph and decides what may run NOW:
 *
 *   parallel       ready nodes with disjoint resource locks run together,
 *                  bounded by maxParallel (from the run's BudgetManager
 *                  when present)
 *   serial         nodes sharing a resource lock (or an exclusive node)
 *                  serialize
 *   deadlines      a node whose deadline passed is failed fast
 *   priorities     critical nodes acquire locks ahead of normal ones
 *                  (two-lane, anti-starvation)
 *   retries        failed nodes with retry budget re-enter the ready set
 *                  (with capped attempts)
 *
 * The Scheduler is pure ordering — the Executor runs what it hands out.
 */

import { TaskGraph, TaskNode, TaskPriority } from "./task-graph.js";
import { ResourceLockRegistry } from "../concurrency/resource-locks.js";

export interface SchedulerOptions {
  graph: TaskGraph;
  locks?: ResourceLockRegistry;
  /** Max nodes in flight (default 4). */
  maxParallel?: number;
  /** Signal cancels scheduling: pending nodes become cancelled. */
  signal?: AbortSignal;
  /** Clock for deadline checks (tests). */
  now?: () => number;
}

/** What the scheduler hands the executor. */
export interface ScheduledNode {
  node: TaskNode;
  /** Release when the node finishes (releases its resource locks). */
  release: () => void;
}

export class Scheduler {
  private readonly graph: TaskGraph;
  private readonly locks: ResourceLockRegistry;
  private readonly maxParallel: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly signal?: AbortSignal;
  private inFlight = 0;

  constructor(private readonly opts: SchedulerOptions) {
    this.graph = opts.graph;
    this.locks = opts.locks ?? new ResourceLockRegistry();
    this.maxParallel = opts.maxParallel ?? 4;
    this.now = opts.now ?? (() => Date.now());
    this.startedAt = this.now();
    this.signal = opts.signal;
  }

  get graphRef(): TaskGraph {
    return this.graph;
  }

  /** How many nodes are currently in flight. */
  activeCount(): number {
    return this.inFlight;
  }

  /**
   * Claim the next runnable node, or null when the graph is blocked
   * (nothing ready, or parallel/lock limits). Transition the node to
   * running and acquire its locks.
   */
  claimNext(): ScheduledNode | null {
    if (this.signal?.aborted) {
      this.cancelPending();
      return null;
    }
    if (this.inFlight >= this.maxParallel) return null;

    // deadline sweep: fail nodes whose per-node deadline has passed
    this.failExpiredNodes();

    // an exclusive node in flight blocks everything else; an exclusive
    // candidate needs total isolation
    const anyRunning = this.graph.runningNodes();
    const exclusiveRunning = anyRunning.some((n) => n.exclusive);
    if (exclusiveRunning) return null;

    const ready = this.graph.readyNodes();
    if (ready.length === 0) return null;

    // critical first, then FIFO by addedAt
    const sorted = [...ready].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === "critical" ? -1 : 1;
      return a.addedAt - b.addedAt;
    });

    for (const node of sorted) {
      if (node.exclusive && anyRunning.length > 0) continue; // must run alone
      const resources = node.exclusive
        ? this.allKnownResources() // exclusive = hold everything
        : node.resourceLocks;
      const release = this.locks.tryAcquire(resources);
      if (!release) continue; // contended: try the next candidate
      // pending → ready → running (the state machine's legal path)
      this.graph.transition(node.id, "ready");
      this.graph.transition(node.id, "running");
      this.inFlight += 1;
      return { node, release: () => this.finishClaim(release) };
    }
    return null;
  }

  /**
   * Drain the graph to completion with an executor callback. Each claimed
   * node is passed to `run(node)`; the returned outcome drives transitions:
   *   "success" → completed (dependents may become ready)
   *   "failure" → failed (retry if budget remains, else cascade-skip deps)
   *   "blocked" → blocked (needs replan or manual unblock)
   */
  async drain(run: (node: TaskNode) => Promise<"success" | "failure" | "blocked">): Promise<void> {
    // concurrent claims: run as many in parallel as allowed
    const workers: Promise<void>[] = [];
    const launch = (): void => {
      while (workers.length < this.maxParallel) {
        const claimed = this.claimNext();
        if (!claimed) break;
        const task = (async () => {
          try {
            const outcome = await run(claimed.node);
            this.complete(claimed.node.id, outcome);
          } finally {
            claimed.release();
          }
        })();
        const wrapped = task.then(() => undefined);
        workers.push(wrapped);
        void wrapped.finally(() => {
          const idx = workers.indexOf(wrapped);
          if (idx >= 0) workers.splice(idx, 1);
          launch();
        });
      }
    };
    launch();
    while (workers.length > 0 || this.hasRunnableWork()) {
      if (workers.length === 0 && this.hasRunnableWork()) {
        // all runnable work is lock-contended or parallel-capped: wait for
        // an in-flight completion… but nothing is in flight → deadlock-ish
        // (cycles are validated away, so this means unsatisfiable locks);
        // fail the blocked nodes rather than spinning forever.
        const stuck = this.graph.all().filter((n) => ["pending", "ready"].includes(n.status));
        for (const node of stuck) this.graph.transition(node.id, "blocked");
        if (!this.hasRunnableWork()) break;
        await new Promise((r) => setTimeout(r, 5));
      } else {
        await Promise.race([Promise.all(workers), new Promise((r) => setTimeout(r, 10))]);
      }
      launch();
    }
    await Promise.allSettled(workers);
  }

  /** Apply a terminal outcome for a node. */
  complete(nodeId: string, outcome: "success" | "failure" | "blocked"): void {
    const node = this.graph.get(nodeId);
    if (!node) return;
    if (outcome === "success") {
      this.graph.transition(nodeId, "completed");
    } else if (outcome === "failure") {
      this.graph.transition(nodeId, "failed");
      // retry budget?
      if (node.attempt <= node.maxRetries) {
        this.graph.transition(nodeId, "ready"); // failed → ready
      } else {
        this.graph.cascadeSkip(nodeId, `dependency "${node.goal}" failed after ${node.attempt} attempts`);
      }
    } else {
      this.graph.transition(nodeId, "blocked");
    }
  }

  /** Cancel every non-terminal node. */
  cancelPending(): TaskNode[] {
    const cancelled: TaskNode[] = [];
    for (const node of this.graph.all()) {
      if (["pending", "ready", "blocked", "running"].includes(node.status)) {
        this.graph.transition(node.id, "cancelled");
        cancelled.push(node);
      }
    }
    return cancelled;
  }

  private finishClaim(release: () => void): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    release();
  }

  private hasRunnableWork(): boolean {
    if (this.signal?.aborted) return false;
    return this.graph.readyNodes().length > 0;
  }

  private allKnownResources(): string[] {
    const resources = new Set<string>();
    for (const node of this.graph.all()) {
      for (const r of node.resourceLocks) resources.add(r);
    }
    return [...resources];
  }

  private failExpiredNodes(): void {
    for (const node of this.graph.all()) {
      if (node.deadlineMs === undefined) continue;
      if (!["pending", "ready"].includes(node.status)) continue;
      if (this.now() - this.startedAt > node.deadlineMs) {
        this.graph.transition(node.id, "failed");
        node.metadata.deadlineExceeded = true;
      }
    }
  }

  /** Priority of a node (observability). */
  priorityOf(nodeId: string): TaskPriority | undefined {
    return this.graph.get(nodeId)?.priority;
  }

  locksSnapshot(): Record<string, number> {
    return this.locks.snapshot();
  }
}
