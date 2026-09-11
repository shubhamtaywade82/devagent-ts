/**
 * SQLite-backed Harness Version Registry for tracking evolutionary lineage H0 → Hn.
 *
 * Persists immutable candidate and promoted versions, evaluation metrics,
 * hypotheses, and parent pointers for full auditability and instant rollback.
 */

import Database from "better-sqlite3";
import { EvaluationMetrics, HarnessComponent, HarnessVersion, VersionStatus } from "./types.js";

interface VersionRow {
  id: string;
  commit_sha: string;
  parent_id: string | null;
  created_at: number;
  target_component: string;
  hypothesis: string;
  metrics_json: string;
  status: string;
}

function rowToVersion(row: VersionRow): HarnessVersion {
  return {
    id: row.id,
    commitSha: row.commit_sha,
    parentId: row.parent_id,
    createdAt: row.created_at,
    targetComponent: row.target_component as HarnessComponent,
    hypothesis: row.hypothesis,
    metrics: JSON.parse(row.metrics_json) as EvaluationMetrics,
    status: row.status as VersionStatus,
  };
}

export class HarnessRegistry {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS harness_versions (
        id TEXT PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        parent_id TEXT,
        created_at INTEGER NOT NULL,
        target_component TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
  }

  saveVersion(version: HarnessVersion): void {
    const stmt = this.db.prepare(`
      INSERT INTO harness_versions (
        id, commit_sha, parent_id, created_at, target_component, hypothesis, metrics_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        metrics_json = excluded.metrics_json
    `);
    stmt.run(
      version.id,
      version.commitSha,
      version.parentId,
      version.createdAt,
      version.targetComponent,
      version.hypothesis,
      JSON.stringify(version.metrics),
      version.status,
    );
  }

  getVersion(id: string): HarnessVersion | null {
    const row = this.db.prepare("SELECT * FROM harness_versions WHERE id = ?").get(id) as VersionRow | undefined;
    return row ? rowToVersion(row) : null;
  }

  listVersions(): HarnessVersion[] {
    const rows = this.db
      .prepare("SELECT * FROM harness_versions ORDER BY created_at ASC, rowid ASC")
      .all() as VersionRow[];
    return rows.map(rowToVersion);
  }

  getActiveVersion(): HarnessVersion | null {
    // Latest promoted version is active; falls back to latest validated
    const row = this.db
      .prepare("SELECT * FROM harness_versions WHERE status = 'promoted' ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get() as VersionRow | undefined;
    return row ? rowToVersion(row) : null;
  }

  promoteVersion(id: string): void {
    this.db.prepare("UPDATE harness_versions SET status = 'promoted' WHERE id = ?").run(id);
  }

  rollbackTo(id: string): void {
    const target = this.getVersion(id);
    if (!target) throw new Error(`Cannot rollback to unknown harness version: ${id}`);

    // Demote any versions newer than target that were promoted
    this.db
      .prepare(
        `
        UPDATE harness_versions
        SET status = 'rolled_back'
        WHERE status = 'promoted'
          AND (created_at > ? OR (created_at = ? AND rowid > (SELECT rowid FROM harness_versions WHERE id = ?)))
      `,
      )
      .run(target.createdAt, target.createdAt, id);
    this.promoteVersion(id);
  }

  close(): void {
    this.db.close();
  }
}
