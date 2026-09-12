/**
 * IdempotencyManager — dedupe side-effecting tool mutations (review item 28).
 *
 * Applies to tools whose ToolExecutionSpec.idempotencyKey is "required" or
 * "auto": git commit, git push, GitHub mutations, trading, external API
 * mutations. The gateway asks the manager BEFORE executing:
 *
 *   - "new"       → record the key, execute, then complete(key, result)
 *   - "completed" → return the recorded result WITHOUT re-executing
 *   - "recorded"  → a prior attempt is in flight/unfinished → the gateway
 *                   refuses a second concurrent execution of the same key
 *
 * Keys are deterministic: sha256 over (tool name + canonical args), so a
 * model retrying the exact same mutation after a transport error is safe,
 * while any argument change produces a new key.
 *
 * Storage: in-memory map + optional JSON file under the workspace state
 * dir (crash-tolerant: unfinished "recorded" entries expire).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export interface IdempotencyEntry {
  key: string;
  tool: string;
  runId?: string;
  firstSeenTs: number;
  status: "recorded" | "completed" | "failed";
  result?: Record<string, unknown>;
}

export interface IdempotencyManagerOptions {
  /** JSON file for durable dedupe (e.g. .nexum/idempotency.json). */
  file?: string;
  /** How long an unfinished "recorded" entry blocks retries (ms). Default 5 min. */
  pendingTtlMs?: number;
  /** Max entries kept (LRU-ish trim by firstSeenTs). Default 1000. */
  maxEntries?: number;
}

export type IdempotencyStatus = "new" | "recorded" | "completed" | "failed";

export interface IdempotencyCheck {
  status: IdempotencyStatus;
  /** Present when status === "completed": the recorded result to reuse. */
  result?: Record<string, unknown>;
}

/** Stable stringify: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Deterministic idempotency key for a tool call. */
export function idempotencyKeyFor(tool: string, args: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${tool}::${stableStringify(args)}`)
    .digest("hex")
    .slice(0, 32);
}

export class IdempotencyManager {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private readonly pendingTtlMs: number;
  private readonly maxEntries: number;
  private readonly file?: string;

  constructor(opts: IdempotencyManagerOptions = {}) {
    this.file = opts.file;
    this.pendingTtlMs = opts.pendingTtlMs ?? 5 * 60_000;
    this.maxEntries = opts.maxEntries ?? 1000;
    if (this.file) this.load();
  }

  /** Deterministic key for a (tool, canonical args) pair. */
  keyFor(tool: string, args: Record<string, unknown>): string {
    return idempotencyKeyFor(tool, args);
  }

  /**
   * Check a key BEFORE execution. "recorded" entries older than the
   * pending TTL are treated as failed attempts (crash recovery) and
   * re-allowed.
   */
  check(tool: string, args: Record<string, unknown>, _runId?: string): IdempotencyCheck {
    const key = this.keyFor(tool, args);
    const entry = this.entries.get(key);
    if (!entry) return { status: "new" };
    if (entry.status === "recorded" && Date.now() - entry.firstSeenTs > this.pendingTtlMs) {
      // crashed mid-flight: allow one retry
      this.entries.delete(key);
      return { status: "new" };
    }
    if (entry.status === "completed") return { status: "completed", result: entry.result };
    return { status: entry.status };
  }

  /** Record the intent to execute (before running the tool). */
  record(tool: string, args: Record<string, unknown>, runId?: string): string {
    const key = this.keyFor(tool, args);
    this.entries.set(key, {
      key,
      tool,
      runId,
      firstSeenTs: Date.now(),
      status: "recorded",
    });
    this.persist();
    return key;
  }

  /** Mark the execution finished with its result. */
  complete(key: string, result?: Record<string, unknown>, failed = false): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.status = failed ? "failed" : "completed";
    if (result) entry.result = result;
    this.persist();
  }

  /** Drop keys for completed entries older than ttl (housekeeping). */
  prune(): number {
    const before = this.entries.size;
    for (const [key, entry] of [...this.entries]) {
      if (entry.status !== "recorded" && Date.now() - entry.firstSeenTs > this.pendingTtlMs * 4) {
        this.entries.delete(key);
      }
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = [...this.entries.values()].sort((a, b) => a.firstSeenTs - b.firstSeenTs)[0];
      if (!oldest) break;
      this.entries.delete(oldest.key);
    }
    this.persist();
    return before - this.entries.size;
  }

  snapshot(): IdempotencyEntry[] {
    return [...this.entries.values()];
  }

  // ── persistence ────────────────────────────────────────────────────────

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as IdempotencyEntry[];
      if (Array.isArray(parsed)) {
        for (const e of parsed) {
          if (e && typeof e.key === "string") this.entries.set(e.key, e);
        }
      }
    } catch {
      // torn write: start fresh (dedupe is best-effort durability)
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.snapshot()), "utf8");
      renameSync(tmp, this.file);
    } catch {
      // best-effort: in-memory dedupe still works this session
    }
  }
}
