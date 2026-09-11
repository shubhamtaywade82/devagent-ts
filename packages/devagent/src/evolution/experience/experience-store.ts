/**
 * SQLite-backed ExperienceStore for evidence-grounded experience learning.
 *
 * Persists ExperienceRecords with full provenance (episode, verifier evidence,
 * executor model, harness version) so that evolution decisions can consult
 * measured experience instead of relying principally on LLM reflection.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ExperienceRecord, Outcome, VerificationEvidence } from "./types.js";

interface ExperienceRow {
  episode_id: string;
  task_class: string;
  failure_mode: string;
  context_snapshot: string;
  action_sequence_json: string;
  outcome_json: string;
  verifier_evidence_json: string;
  executor_model: string;
  harness_version: string;
  transferable: string;
  confidence: number;
  created_at: number;
}

function rowToRecord(row: ExperienceRow): ExperienceRecord {
  let transferable: boolean | "unknown" = "unknown";
  if (row.transferable === "true") transferable = true;
  else if (row.transferable === "false") transferable = false;

  return {
    episodeId: row.episode_id,
    taskClass: row.task_class,
    failureMode: row.failure_mode,
    contextSnapshot: row.context_snapshot,
    actionSequence: JSON.parse(row.action_sequence_json) as string[],
    outcome: JSON.parse(row.outcome_json) as Outcome,
    verifierEvidence: JSON.parse(row.verifier_evidence_json) as VerificationEvidence,
    executorModel: row.executor_model,
    harnessVersion: row.harness_version,
    transferable,
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}

export class ExperienceStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experience_records (
        episode_id TEXT PRIMARY KEY,
        task_class TEXT NOT NULL,
        failure_mode TEXT NOT NULL,
        context_snapshot TEXT NOT NULL,
        action_sequence_json TEXT NOT NULL,
        outcome_json TEXT NOT NULL,
        verifier_evidence_json TEXT NOT NULL,
        executor_model TEXT NOT NULL,
        harness_version TEXT NOT NULL,
        transferable TEXT NOT NULL DEFAULT 'unknown',
        confidence REAL NOT NULL DEFAULT 0.5,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_experience_task_class ON experience_records(task_class);
      CREATE INDEX IF NOT EXISTS idx_experience_harness ON experience_records(harness_version);
    `);
  }

  save(record: ExperienceRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO experience_records (
          episode_id, task_class, failure_mode, context_snapshot, action_sequence_json,
          outcome_json, verifier_evidence_json, executor_model, harness_version,
          transferable, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_id) DO UPDATE SET
          task_class = excluded.task_class,
          failure_mode = excluded.failure_mode,
          transferable = excluded.transferable,
          confidence = excluded.confidence
      `,
      )
      .run(
        record.episodeId,
        record.taskClass,
        record.failureMode,
        record.contextSnapshot,
        JSON.stringify(record.actionSequence),
        JSON.stringify(record.outcome),
        JSON.stringify(record.verifierEvidence),
        record.executorModel,
        record.harnessVersion,
        String(record.transferable),
        record.confidence,
        record.createdAt,
      );
  }

  getByEpisode(episodeId: string): ExperienceRecord | null {
    const row = this.db.prepare("SELECT * FROM experience_records WHERE episode_id = ?").get(episodeId) as
      ExperienceRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  listByTaskClass(taskClass: string, limit = 200): ExperienceRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM experience_records WHERE task_class = ? ORDER BY created_at DESC LIMIT ?")
      .all(taskClass, limit) as ExperienceRow[];
    return rows.map(rowToRecord);
  }

  listByHarnessVersion(harnessVersion: string, limit = 200): ExperienceRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM experience_records WHERE harness_version = ? ORDER BY created_at DESC LIMIT ?")
      .all(harnessVersion, limit) as ExperienceRow[];
    return rows.map(rowToRecord);
  }

  listAll(limit = 1000): ExperienceRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM experience_records ORDER BY created_at DESC LIMIT ?")
      .all(limit) as ExperienceRow[];
    return rows.map(rowToRecord);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM experience_records").get() as { n: number };
    return row.n;
  }

  /** Marks records as transferable/non-transferable after transfer analysis. */
  setTransferable(episodeIds: string[], transferable: boolean): void {
    const stmt = this.db.prepare("UPDATE experience_records SET transferable = ? WHERE episode_id = ?");
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(String(transferable), id);
    });
    tx(episodeIds);
  }

  close(): void {
    this.db.close();
  }
}
