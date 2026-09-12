/**
 * ExecutionEventStore — durable execution history (review item 13).
 *
 * Persists every ExecutionEvent as an append-only, seq-ordered JSONL log
 * per run (`.nexum/runs/<runId>.events.jsonl`), plus a run index for
 * discovery. Supports replay/recovery: `replay(runId)` folds the log back
 * into run / tool-invocation / model-call / approval / delegation
 * projections without ambient state.
 *
 * Events are recorded by the ExecutionRecorder, which stamps envelopes
 * with correlation ids (traceId → runId → taskId → toolCallId / modelCallId
 * + parentRunId) — see core/observability/correlation.ts (review item 33).
 *
 * Why JSONL and not sqlite: execution history is append-heavy,
 * replay-shaped, and per-run scoped; one file per run keeps crash
 * recovery trivial (partial last line = dropped, seq keeps order) and
 * pruning a directory delete. Domain caches (memory, docs, lessons) stay
 * in sqlite where query shape demands it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import {
  EventEnvelope,
  fromPersistedRecord,
  isPersistedEventRecord,
  PersistedEventRecord,
  toPersistedRecord,
} from "../../core/events/envelope.js";
import type { ExecutionEvent } from "../events/execution-events.js";
import type { CorrelationIds, RunId } from "../../core/identity.js";
import {
  ReplayProjector,
  RUN_STATE_LAYOUT,
  RunRecord,
  RunReplay,
} from "./state-model.js";
import type { ExecutionStatus } from "../../core/types.js";

export interface ExecutionEventStoreOptions {
  /** Directory that holds run logs (e.g. `<workspace>/.nexum`). */
  rootDir: string;
  /** Disable fs writes (tests / in-memory use). */
  inMemory?: boolean;
}

export class ExecutionEventStore {
  private readonly runsDir: string;
  private readonly indexFile: string;
  private readonly inMemory = new Map<RunId, PersistedEventRecord[]>();
  private readonly inMemoryIndex = new Map<RunId, RunRecord>();
  private readonly memos = new Map<RunId, number>(); // last seq per run

  constructor(private readonly opts: ExecutionEventStoreOptions) {
    this.runsDir = join(opts.rootDir, RUN_STATE_LAYOUT.runsDir);
    this.indexFile = join(opts.rootDir, RUN_STATE_LAYOUT.runIndexFile);
    if (!opts.inMemory) {
      mkdirSync(this.runsDir, { recursive: true });
    }
  }

  // ── append ─────────────────────────────────────────────────────────────

  /** Append one envelope to the run's log. Assigns nothing — the recorder owns seq. */
  append(envelope: EventEnvelope<ExecutionEvent>): void {
    const record = toPersistedRecord(envelope);
    if (this.opts.inMemory) {
      const list = this.inMemory.get(envelope.runId) ?? [];
      list.push(record);
      this.inMemory.set(envelope.runId, list);
      return;
    }
    const file = this.runFile(envelope.runId);
    if (!existsSync(file)) {
      mkdirSync(this.runsDir, { recursive: true });
      writeFileSync(file, "", { flag: "wx" });
    }
    appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
    this.memos.set(envelope.runId, envelope.seq);
  }

  /** Persist/refresh the run's summary record in the index. */
  upsertRun(run: RunRecord): void {
    if (this.opts.inMemory) {
      this.inMemoryIndex.set(run.runId, run);
      return;
    }
    const lines = this.readIndex();
    const next = lines.filter((r) => r.runId !== run.runId);
    next.push(run);
    this.writeIndexAtomic(next);
  }

  // ── read ───────────────────────────────────────────────────────────────

  /** Full envelope log for one run (oldest first). Tolerates a torn tail line. */
  eventsForRun(runId: RunId): EventEnvelope<ExecutionEvent>[] {
    const records = this.recordsForRun(runId);
    return records.map(fromPersistedRecord as (r: PersistedEventRecord) => EventEnvelope<ExecutionEvent>);
  }

  /** Replay: fold the run's log into durable projections (review item 13). */
  replay(runId: RunId): RunReplay | null {
    const records = this.recordsForRun(runId);
    if (records.length === 0) return null;
    const base = this.runRecord(runId, records);
    const projector = new ReplayProjector(base);
    for (const r of records) {
      projector.fold(r.payload as Record<string, unknown> & { type: string }, r.correlation, r.ts, r.seq);
    }
    const replay = projector.finish(
      base.endedAt,
      inferStatus(records),
    );
    replay.envelopes = records.map((r) => ({
      id: r.id,
      seq: r.seq,
      ts: r.ts,
      type: r.eventType,
      correlation: r.correlation,
    }));
    return replay;
  }

  /** All known runs (from the index; falls back to a directory scan). */
  listRuns(): RunRecord[] {
    if (this.opts.inMemory) return [...this.inMemoryIndex.values()];
    return this.readIndex();
  }

  /** Drop runs beyond the newest N (directory delete + index rewrite). */
  prune(keepRuns: number): number {
    const runs = this.listRuns().sort((a, b) => b.startedAt - a.startedAt);
    const keep = new Set(runs.slice(0, keepRuns).map((r) => r.runId));
    const drop = runs.filter((r) => !keep.has(r.runId));
    if (this.opts.inMemory) {
      for (const r of drop) this.inMemory.delete(r.runId);
      return drop.length;
    }
    for (const r of drop) {
      const file = this.runFile(r.runId);
      if (existsSync(file)) renameSync(file, `${file}.pruned`);
    }
    this.writeIndexAtomic(runs.slice(0, keepRuns));
    return drop.length;
  }

  // ── internals ──────────────────────────────────────────────────────────

  private runFile(runId: RunId): string {
    return join(this.runsDir, RUN_STATE_LAYOUT.runEventsFile(runId));
  }

  private recordsForRun(runId: RunId): PersistedEventRecord[] {
    if (this.opts.inMemory) return [...(this.inMemory.get(runId) ?? [])];
    const file = this.runFile(runId);
    if (!existsSync(file)) return [];
    const out: PersistedEventRecord[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isPersistedEventRecord(parsed)) out.push(parsed);
      } catch {
        // torn tail line from a crash mid-append: drop it (seq keeps order)
      }
    }
    return out;
  }

  private runRecord(runId: RunId, records: PersistedEventRecord[]): RunRecord {
    const indexed = this.opts.inMemory
      ? this.inMemoryIndex.get(runId)
      : this.readIndex().find((r) => r.runId === runId);
    const first = records[0];
    const last = records[records.length - 1];
    const corr: CorrelationIds = first.correlation;
    return {
      runId,
      traceId: corr.traceId,
      parentRunId: corr.parentRunId,
      sessionId: corr.sessionId ?? "sess_unknown",
      agentId: corr.agentId ?? "agent_unknown",
      taskId: corr.taskId,
      goal: indexed?.goal ?? "(reconstructed from events)",
      strategy: indexed?.strategy,
      status: inferStatus(records),
      startedAt: indexed?.startedAt ?? first.ts,
      endedAt: indexed?.endedAt ?? last.ts,
      eventCount: records.length,
    };
  }

  private readIndex(): RunRecord[] {
    if (this.opts.inMemory) return [...this.inMemoryIndex.values()];
    if (!existsSync(this.indexFile)) return [];
    const out: RunRecord[] = [];
    for (const line of readFileSync(this.indexFile, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as RunRecord;
        if (parsed && typeof parsed.runId === "string") out.push(parsed);
      } catch {
        /* torn line */
      }
    }
    return out;
  }

  private writeIndexAtomic(runs: RunRecord[]): void {
    if (this.opts.inMemory) {
      this.inMemoryIndex.clear();
      for (const r of runs) this.inMemoryIndex.set(r.runId, r);
      return;
    }
    const tmp = `${this.indexFile}.tmp`;
    writeFileSync(tmp, runs.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    renameSync(tmp, this.indexFile);
  }

  /** Directory scan fallback for orphaned run files (no index entry). */
  orphanedRunIds(): RunId[] {
    if (this.opts.inMemory) return [];
    if (!existsSync(this.runsDir)) return [];
    const indexed = new Set(this.readIndex().map((r) => r.runId));
    return readdirSync(this.runsDir)
      .filter((f) => f.endsWith(".events.jsonl"))
      .map((f) => f.replace(".events.jsonl", ""))
      .filter((id) => !indexed.has(id));
  }
}

function inferStatus(records: PersistedEventRecord[]): ExecutionStatus | "running" {
  const types = records.map((r) => r.eventType);
  const terminal = [...types].reverse().find((t) => t.startsWith("run."));
  if (terminal === "run.completed") return "completed";
  if (terminal === "run.failed") return "failed";
  if (terminal === "run.cancelled") return "cancelled";
  if (terminal === "run.budget_exhausted") return "budget_exhausted";
  if (terminal === "run.timeout") return "timeout";
  return "running";
}
