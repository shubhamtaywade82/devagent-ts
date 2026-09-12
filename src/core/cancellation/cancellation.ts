/**
 * Cancellation propagation (review item 16).
 *
 * One AbortSignal must reach every layer that can do work:
 *
 *   planner → agent → model call → tool call → shell process
 *                       └→ MCP call, browser action, child agents
 *
 * The kernel already chains signals run→strategy; the gaps this module
 * closes:
 *
 *   1. `linkedSignal` — compose a parent signal with a timeout into a new
 *      controller, so every child scope aborts when EITHER the parent
 *      aborts or its own deadline passes.
 *   2. `throwIfAborted` — one cooperative check with a precise error
 *      message naming the operation that observed the abort.
 *   3. `CancellationScope` — a named handle (runId/taskId) that tool
 *      executors, MCP adapters and shell runners accept; scopes form a
 *      tree, so cancelling a parent cancels every in-flight child.
 *   4. `CancellationRegistry` — the runtime's bookkeeping of active
 *      scopes: `cancel(runId)` reaches model calls, tool calls, shell
 *      processes, MCP calls, browser actions and delegated child runs.
 */

/** The error thrown when a scope observes its abort signal. */
export class CancelledError extends Error {
  constructor(
    public readonly operation: string,
    public readonly reason?: string,
  ) {
    super(reason ? `operation "${operation}" cancelled: ${reason}` : `operation "${operation}" cancelled`);
    this.name = "CancelledError";
  }
}

/** DOMException-style abort detection (works for node AbortErrors too). */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  const message = (error as { message?: string }).message ?? "";
  return name === "AbortError" || name === "CancelledError" || /abort|cancelled|canceled/i.test(message);
}

/** Cooperative check: throws CancelledError when the signal is aborted. */
export function throwIfAborted(signal: AbortSignal | undefined, operation: string): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    const reasonText = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : undefined;
    throw new CancelledError(operation, reasonText);
  }
}

/**
 * Compose a (possibly absent) parent signal and an optional timeout into
 * one child controller. Returns the controller, its signal, and a dispose
 * function — callers MUST dispose to clear the timeout timer.
 */
export interface LinkedSignal {
  signal: AbortSignal;
  controller: AbortController;
  dispose(): void;
}

export function linkedSignal(opts: { parent?: AbortSignal; timeoutMs?: number; label?: string }): LinkedSignal {
  const controller = new AbortController();
  const label = opts.label ?? "linked-scope";
  const timers: NodeJS.Timeout[] = [];

  if (opts.parent) {
    if (opts.parent.aborted) {
      controller.abort(new CancelledError(label, "parent already aborted"));
    } else {
      const onAbort = () => {
        const reason = opts.parent!.reason;
        controller.abort(
          reason instanceof Error ? reason : new CancelledError(label, String(reason ?? "parent aborted")),
        );
      };
      opts.parent.addEventListener("abort", onAbort, { once: true });
    }
  }
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    const t = setTimeout(() => {
      controller.abort(new CancelledError(label, `timeout after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);
    if (typeof t.unref === "function") t.unref();
    timers.push(t);
  }

  return {
    signal: controller.signal,
    controller,
    dispose() {
      for (const t of timers) clearTimeout(t);
    },
  };
}

/**
 * A named cancellation handle. Executors (tool calls, model calls, shell,
 * MCP, browser, child agents) receive a scope, not a bare signal, so the
 * runtime can label what got cancelled in errors and telemetry. The scope
 * owns its controller: `abort()` fires the signal while `dispose()` only
 * drops timers.
 */
export class CancellationScope {
  readonly signal: AbortSignal;
  private readonly controller: AbortController;
  private readonly disposeLinked: () => void;

  constructor(
    public readonly name: string,
    parentOrSignal?: AbortSignal | CancellationScope,
  ) {
    const parent = parentOrSignal instanceof CancellationScope ? parentOrSignal.signal : parentOrSignal;
    const linked = linkedSignal({ parent, label: name });
    this.signal = linked.signal;
    this.controller = linked.controller;
    this.disposeLinked = linked.dispose;
  }

  get aborted(): boolean {
    return this.signal.aborted;
  }

  /** Abort this scope (and transitively every child linked to it). */
  abort(reason?: string): void {
    if (this.signal.aborted) return;
    this.controller.abort(reason ? new CancelledError(this.name, reason) : new CancelledError(this.name));
  }

  /** Throws when aborted (cooperative check inside executors). */
  check(operation: string): void {
    throwIfAborted(this.signal, `${this.name}:${operation}`);
  }

  /** Drop owned timers (does NOT abort). Safe to call twice. */
  dispose(): void {
    this.disposeLinked();
  }
}

/**
 * Runtime-wide registry of active cancellation scopes, keyed by runId.
 * `cancel(runId)` aborts every scope registered under that run — model
 * calls in flight, queued tool calls, shell containers, MCP requests,
 * browser actions, delegated child agents.
 */
export class CancellationRegistry {
  private readonly scopes = new Map<string, Set<{ scope: CancellationScope; dispose: () => void }>>();

  /**
   * Register a scope under a run. Returns an unregister function — the
   * executor calls it when the operation completes.
   */
  register(runId: string, scope: CancellationScope): () => void {
    let set = this.scopes.get(runId);
    if (!set) {
      set = new Set();
      this.scopes.set(runId, set);
    }
    const entry = { scope, dispose: () => set!.delete(entry) };
    set.add(entry);
    return () => {
      entry.dispose();
      if (set!.size === 0) this.scopes.delete(runId);
    };
  }

  /** Abort every scope under one run. Returns how many were aborted. */
  cancel(runId: string, reason?: string): number {
    const set = this.scopes.get(runId);
    if (!set) return 0;
    let n = 0;
    for (const { scope } of [...set]) {
      if (!scope.signal.aborted) {
        scope.abort(reason);
        n += 1;
      }
    }
    return n;
  }

  activeScopeCount(runId: string): number {
    return this.scopes.get(runId)?.size ?? 0;
  }

  activeRunIds(): string[] {
    return [...this.scopes.keys()];
  }
}
