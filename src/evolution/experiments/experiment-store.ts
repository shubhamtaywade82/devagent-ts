/**
 * SQLite-backed store for persistent experiment provenance records.
 *
 * One row per harness evolution experiment. The record is written progressively
 * as the experiment advances through the lifecycle state machine, making the
 * store the durable audit log for the closed loop.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ExperimentRecord } from "./experiment-schema.js";
import { EvolutionState } from "../state-machine.js";

interface ExperimentRow {
  id: string;
  parent_harness: string;
  parent_commit: string;
  candidate_harness: string;
  candidate_commit: string;
  payload: string;
  lifecycle_state: string;
  decision_result: string;
  ci_status: string;
  review_state: string;
  created_at: number;
}

function rowToRecord(row: ExperimentRow): ExperimentRecord {
  return { ...JSON.parse(row.payload), id: row.id } as ExperimentRecord;
}

export class ExperimentStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        parent_harness TEXT NOT NULL,
        parent_commit TEXT NOT NULL,
        candidate_harness TEXT NOT NULL,
        candidate_commit TEXT NOT NULL,
        payload TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        decision_result TEXT NOT NULL,
        ci_status TEXT NOT NULL DEFAULT 'pending',
        review_state TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_experiments_candidate ON experiments(candidate_harness);
      CREATE INDEX IF NOT EXISTS idx_experiments_state ON experiments(lifecycle_state);
    `);
  }

  upsert(record: ExperimentRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO experiments (
          id, parent_harness, parent_commit, candidate_harness, candidate_commit,
          payload, lifecycle_state, decision_result, ci_status, review_state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload = excluded.payload,
          lifecycle_state = excluded.lifecycle_state,
          decision_result = excluded.decision_result,
          ci_status = excluded.ci_status,
          review_state = excluded.review_state
      `,
      )
      .run(
        record.id,
        record.parent.harness,
        record.parent.commit,
        record.candidate.harness,
        record.candidate.commit,
        JSON.stringify(record),
        record.lifecycle.state,
        record.decision.result,
        record.ci.status,
        record.review.state,
        record.createdAt,
      );
  }

  get(id: string): ExperimentRecord | null {
    const row = this.db.prepare("SELECT * FROM experiments WHERE id = ?").get(id) as ExperimentRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  listAll(limit = 500): ExperimentRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM experiments ORDER BY created_at ASC LIMIT ?")
      .all(limit) as ExperimentRow[];
    return rows.map(rowToRecord);
  }

  listByLifecycleState(state: EvolutionState): ExperimentRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM experiments WHERE lifecycle_state = ? ORDER BY created_at ASC")
      .all(state) as ExperimentRow[];
    return rows.map(rowToRecord);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM experiments").get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
