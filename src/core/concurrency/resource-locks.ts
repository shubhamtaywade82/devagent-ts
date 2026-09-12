/**
 * Resource locks (review item 34) — dependency-aware concurrency beyond
 * plain DAG ordering.
 *
 * Nodes declare named resources ("git", "database", "workspace-write",
 * "browser"): two nodes holding the same resource serialize, nodes with
 * disjoint resources run in parallel. Exclusive semantics = hold every
 * lock. Starvation is bounded: critical-priority waiters are served
 * first, normal waiters still win when no critical waiter's set is free.
 */

export type LockPriority = "critical" | "normal";

interface Waiter {
  resources: string[];
  priority: LockPriority;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
}

export class LockAcquireTimeoutError extends Error {
  constructor(resources: string[], timeoutMs: number) {
    super(`timed out (${timeoutMs}ms) acquiring resource locks [${resources.join(", ")}]`);
    this.name = "LockAcquireTimeoutError";
  }
}

export class ResourceLockRegistry {
  private readonly holders = new Map<string, Set<number>>(); // resource → holder ids
  private readonly heldBy = new Map<number, Set<string>>(); // holder id → resources
  private nextHolderId = 1;
  private readonly waiters: Waiter[] = [];

  /** Resources currently held (observability / debugging). */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [resource, holders] of this.holders) out[resource] = holders.size;
    return out;
  }

  isFree(resource: string): boolean {
    return (this.holders.get(resource)?.size ?? 0) === 0;
  }

  /**
   * Acquire ALL resources atomically (all-or-nothing) or queue.
   * Resolves with a release function. `timeoutMs` rejects the acquisition
   * so a node's deadline can bail it out of a long queue.
   */
  acquire(
    resources: string[],
    opts: { priority?: LockPriority; timeoutMs?: number } = {},
  ): Promise<() => void> {
    if (resources.length === 0) return Promise.resolve(() => undefined);
    const priority = opts.priority ?? "normal";
    return new Promise<() => void>((resolve, reject) => {
      const fast = this.tryAcquire(resources);
      if (fast) {
        resolve(fast);
        return;
      }
      const waiter: Waiter = { resources, priority, resolve, reject };
      if (opts.timeoutMs && opts.timeoutMs > 0) {
        const timer = setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) {
            this.waiters.splice(idx, 1);
            reject(new LockAcquireTimeoutError(resources, opts.timeoutMs!));
          }
        }, opts.timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
        waiter.timer = timer;
      }
      this.waiters.push(waiter);
    });
  }

  /**
   * Synchronous try-acquire: returns the release function when every
   * resource is free, undefined when the set is contended.
   */
  tryAcquire(resources: string[]): (() => void) | undefined {
    if (resources.length === 0) return () => undefined;
    const contended = resources.some((r) => (this.holders.get(r)?.size ?? 0) > 0);
    if (contended) return undefined;
    return this.grant(resources);
  }

  private grant(resources: string[]): () => void {
    const holderId = this.nextHolderId++;
    const held = new Set<string>();
    this.heldBy.set(holderId, held);
    for (const r of resources) {
      let set = this.holders.get(r);
      if (!set) {
        set = new Set();
        this.holders.set(r, set);
      }
      set.add(holderId);
      held.add(r);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const r of held) {
        this.holders.get(r)?.delete(holderId);
        if ((this.holders.get(r)?.size ?? 0) === 0) this.holders.delete(r);
      }
      this.heldBy.delete(holderId);
      this.pump();
    };
  }

  /** Grant queued waiters whose resource sets are now free (critical first). */
  private pump(): void {
    if (this.waiters.length === 0) return;
    // critical waiters jump the queue (bounded starvation)
    const order = [...this.waiters].sort((a, b) =>
      a.priority === b.priority ? 0 : a.priority === "critical" ? -1 : 1,
    );
    for (const waiter of order) {
      if (!this.isFreeSet(waiter.resources)) continue;
      const idx = this.waiters.indexOf(waiter);
      this.waiters.splice(idx, 1);
      const release = this.grant(waiter.resources);
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(release);
      return; // one grant per pump; the release chain pumps again
    }
  }

  private isFreeSet(resources: string[]): boolean {
    return resources.every((r) => this.isFree(r));
  }

  /** Are any waiters queued? (deadlock diagnostics) */
  queuedWaiters(): number {
    return this.waiters.length;
  }
}
