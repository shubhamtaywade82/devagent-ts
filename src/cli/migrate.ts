/**
 * `nexum migrate` — explicit DevAgent → Nexum migration command
 * (docs/REBRANDING.md §4, §8).
 *
 * Inspects legacy `.devagent/` workspace state, `DEVAGENT_*` environment
 * variables, and `~/.devagent/` global state; migrates what it finds; and
 * prints a report. Migration also happens lazily on first workspace
 * resolution, so this command is a deliberate, observable way to run it —
 * never a required step.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { activeLegacyEnvVariables } from "../platform/environment.js";
import { findWorkspaceRoot, legacyHistoryFile, legacyGlobalStateDir } from "../platform/paths.js";
import { WorkspaceManager, migrateGlobalState } from "../platform/workspace.js";

export interface MigrateReport {
  workspaceRoot: string;
  /** Legacy `.devagent` existed and was migrated in this run. */
  workspaceMigrated: boolean;
  /** Marker already present — workspace migration previously completed. */
  alreadyMigrated: boolean;
  /** No legacy workspace state existed at all. */
  noLegacyWorkspace: boolean;
  /** `.devagent_history` was copied to `.nexum_history`. */
  historyMigrated: boolean;
  /** Global `~/.devagent` state was migrated in this run. */
  globalMigrated: boolean;
  /** DEVAGENT_* variables currently set in the environment. */
  legacyEnvVariables: string[];
  entries: Array<{ name: string; status: string; detail?: string }>;
  failed: Array<{ name: string; detail?: string }>;
}

/** Inspect + migrate, returning a structured report (tests use this). */
export function runMigrate(opts: { cwd?: string } = {}): MigrateReport {
  const workspaceRoot = findWorkspaceRoot(opts.cwd ?? process.cwd());
  const mgr = new WorkspaceManager(workspaceRoot);
  const detection = mgr.detect();

  const report = mgr.migrate();
  const global = migrateGlobalState();

  const legacyEnv = activeLegacyEnvVariables();

  return {
    workspaceRoot,
    workspaceMigrated: report.migrated,
    alreadyMigrated: report.alreadyMigrated,
    noLegacyWorkspace: !detection.hasLegacy,
    historyMigrated: report.historyMigrated,
    globalMigrated: global.migrated,
    legacyEnvVariables: legacyEnv,
    entries: report.entries,
    failed: report.entries.filter((e) => e.status === "failed"),
  };
}

function printReport(r: MigrateReport): void {
  if (r.noLegacyWorkspace && !r.globalMigrated && r.legacyEnvVariables.length === 0) {
    console.log("No legacy DevAgent state detected — this workspace is already Nexum-native.");
    console.log(`Workspace state: ${new WorkspaceManager(r.workspaceRoot).dir}`);
    return;
  }

  console.log("Detected legacy DevAgent configuration.\n");

  const mgr = new WorkspaceManager(r.workspaceRoot);
  if (!r.noLegacyWorkspace) {
    console.log("Migrating:");
    console.log(`  ${mgr.legacyDir} -> ${mgr.dir}`);
    for (const e of r.entries) {
      const suffix = e.status === "failed" ? `  FAILED (${e.detail ?? "error"})` : "";
      console.log(`    ${e.name.padEnd(18)} ${e.status}${suffix}`);
    }
    if (r.historyMigrated) {
      console.log(`  ${legacyHistoryFile(r.workspaceRoot)} -> ${r.workspaceRoot}/.nexum_history`);
    }
    if (r.alreadyMigrated) {
      console.log("  (workspace migration already completed earlier — verified marker)");
    }
  }

  if (r.globalMigrated) {
    console.log(
      `  ${legacyGlobalStateDir()} -> ${legacyGlobalStateDir().replace(/devagent$/, "nexum")} (global state)`,
    );
  }

  if (r.legacyEnvVariables.length > 0) {
    console.log("\nLegacy environment variables still set (deprecated, read as fallbacks):");
    for (const name of r.legacyEnvVariables) {
      console.log(`  ${name} -> ${name.replace(/^DEVAGENT_/, "NEXUM_")}`);
    }
    console.log("  Update your shell profile / .env to the NEXUM_* names.");
  }

  if (r.failed.length > 0) {
    console.log(`\nMigration completed with ${r.failed.length} failed entr${r.failed.length === 1 ? "y" : "ies"}.`);
    console.log("The original .devagent directory is untouched — re-run `nexum migrate` after fixing.");
  } else {
    console.log("\nMigration complete. The original .devagent directory was preserved —");
    console.log("remove it manually only after validating the migrated workspace.");
  }
}

/** CLI entry point. */
export async function main(_args: string[] = []): Promise<void> {
  const r = runMigrate();
  printReport(r);
  process.exitCode = r.failed.length > 0 ? 1 : 0;
}

// Run when executed directly (tsx src/cli/migrate.ts or node dist/cli/migrate.js);
// a plain import — from tests or bin/cli.js dispatch — has no side effects.
const invokedAs = process.argv[1];
if (invokedAs && existsSync(invokedAs)) {
  const self = fileURLToPath(import.meta.url);
  if (self === invokedAs || self.endsWith(invokedAs)) {
    void main();
  }
}
