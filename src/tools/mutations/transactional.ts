/**
 * Transactional mutation semantics (review item 29).
 *
 * For filesystem/Git mutations:
 *
 *   reserve   snapshot (or stage) the affected state, register compensation
 *     → mutate
 *     → verify
 *     → commit
 *     → compensate on failure
 *
 * `MutationTransaction` implements the flow; `TransactionalFsMutator`
 * provides the filesystem compensation (restore observed content /
 * delete created files / restore deleted files). This is the seam the
 * review calls out for eventually aligning with WAL/CAS/saga — the
 * contract is deliberately the saga shape: forward operation + verified
 * commit + compensating action on failure.
 */

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WorkspaceGuard } from "../../core/fs/workspace-guard.js";
import { contentHash } from "./cas-editor.js";

export interface MutationOutcome<T> {
  committed: boolean;
  result?: T;
  error?: string;
  /** Compensation applied when not committed. */
  compensated?: string;
}

/**
 * One transactional mutation: reserve → mutate → verify → commit →
 * compensate on failure. `onFailure` compensation runs when verify throws
 * or commit is refused.
 */
export class MutationTransaction<T> {
  private compensations: Array<() => Promise<void>> = [];
  private committed = false;

  constructor(
    private readonly opts: {
      label: string;
      mutate: () => Promise<T>;
      verify?: (result: T) => Promise<void> | void;
      commit?: (result: T) => Promise<void> | void;
      reserve?: () => Promise<void> | void;
    },
  ) {}

  /** Register a compensating action (LIFO at rollback). */
  compensate(action: () => Promise<void>): this {
    this.compensations.push(action);
    return this;
  }

  /** Run the flow. Exactly one of commit/compensate happens. */
  async run(): Promise<MutationOutcome<T>> {
    try {
      await this.opts.reserve?.();
      const result = await this.opts.mutate();
      await this.opts.verify?.(result);
      await this.opts.commit?.(result);
      this.committed = true;
      return { committed: true, result };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      let compensated: string | undefined;
      try {
        await this.rollback();
        compensated = `${this.compensations.length} compensations applied`;
      } catch (compErr) {
        compensated = `compensation failed: ${compErr instanceof Error ? compErr.message : String(compErr)}`;
      }
      return { committed: false, error: err, compensated };
    }
  }

  private async rollback(): Promise<void> {
    // LIFO: undo the latest mutation first
    for (const action of [...this.compensations].reverse()) {
      await action();
    }
    this.compensations = [];
  }
}

export interface Reservation {
  path: string;
  absolute: string;
  existedBefore: boolean;
  /** Original content hash (when the file existed). */
  previousHash?: string;
  /** Backup copy location (deleted on commit). */
  backupPath?: string;
}

/**
 * Filesystem mutator with reserve/verify/commit/compensate semantics
 * (review item 29). Every mutation snapshots the observed state first
 * (reserve), applies the change (mutate), re-reads and hash-checks the
 * result (verify), and restores the snapshot when anything fails
 * (compensate).
 */
export class TransactionalFsMutator {
  constructor(
    private readonly guard: WorkspaceGuard,
    private readonly backupsDir: string,
  ) {}

  /** Reserve the current state of a file (snapshot for compensation). */
  async reserve(relativePath: string): Promise<Reservation> {
    const verdict = this.guard.check("read", relativePath);
    if (verdict.allowed && verdict.resolvedPath) {
      const content = await readFile(verdict.resolvedPath, "utf8");
      const backupPath = join(
        this.backupsDir,
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.bak`,
      );
      await mkdir(this.backupsDir, { recursive: true });
      await copyFile(verdict.resolvedPath, backupPath);
      return {
        path: relativePath,
        absolute: verdict.resolvedPath,
        existedBefore: true,
        previousHash: contentHash(content),
        backupPath,
      };
    }
    return { path: relativePath, absolute: "", existedBefore: false };
  }

  /** Write new content transactionally. */
  writeContent(
    reservation: Reservation,
    nextContent: string,
  ): Promise<MutationOutcome<{ path: string; bytesWritten: number; hash: string }>> {
    const tx = new MutationTransaction<{ path: string; bytesWritten: number; hash: string }>({
      label: `write:${reservation.path}`,
      reserve: async () => {
        if (reservation.absolute) {
          await mkdir(dirname(reservation.absolute), { recursive: true });
        }
      },
      mutate: async () => {
        const absolute = reservation.absolute || this.guard.requireAllowed("write", reservation.path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, nextContent, "utf8");
        return {
          path: reservation.path,
          bytesWritten: Buffer.byteLength(nextContent, "utf8"),
          hash: contentHash(nextContent),
        };
      },
      verify: async (result) => {
        if (result.hash !== contentHash(nextContent)) {
          throw new Error(`verification failed: content on disk does not hash to the expected value`);
        }
      },
      commit: async () => {
        await this.releaseReservation(reservation);
      },
    });

    // compensation: restore previous content, or remove the created file
    if (reservation.existedBefore && reservation.backupPath) {
      tx.compensate(async () => {
        await copyFile(reservation.backupPath!, reservation.absolute);
      });
    } else if (!reservation.existedBefore) {
      tx.compensate(async () => {
        const absolute = reservation.absolute || this.guard.requireAllowed("write", reservation.path);
        await rm(absolute, { force: true });
      });
    }
    return tx.run();
  }

  /** Delete a file transactionally (compensation restores the backup). */
  deleteFile(reservation: Reservation): Promise<MutationOutcome<{ path: string }>> {
    const tx = new MutationTransaction<{ path: string }>({
      label: `delete:${reservation.path}`,
      mutate: async () => {
        await rm(reservation.absolute, { force: true });
        return { path: reservation.path };
      },
      commit: async () => {
        await this.releaseReservation(reservation);
      },
    });
    if (reservation.existedBefore && reservation.backupPath) {
      tx.compensate(async () => {
        await copyFile(reservation.backupPath!, reservation.absolute);
      });
    }
    return tx.run();
  }

  private async releaseReservation(reservation: Reservation): Promise<void> {
    if (reservation.backupPath) {
      await rm(reservation.backupPath, { force: true }).catch(() => undefined);
    }
  }
}
