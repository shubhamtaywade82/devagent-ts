/**
 * Path resolution for workspace/global state (docs/REBRANDING.md §4).
 *
 * Canonical state lives under `.nexum/` (workspace) and `~/.nexum/` (global).
 * The legacy `.devagent/` / `~/.devagent/` locations are detected for
 * migration and read as fallbacks, but never written and never deleted.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BRAND } from "./brand.js";
import { readEnv } from "./environment.js";

/** Workspace state directory: `<root>/.nexum`. */
export function workspaceStateDir(root: string): string {
  return join(root, BRAND.configDir);
}

/** Legacy workspace state directory: `<root>/.devagent`. */
export function legacyWorkspaceStateDir(root: string): string {
  return join(root, BRAND.legacyConfigDir);
}

/** Global state directory: `~/.nexum`. */
export function globalStateDir(home: string = homedir()): string {
  return join(home, BRAND.configDir);
}

/** Legacy global state directory: `~/.devagent`. */
export function legacyGlobalStateDir(home: string = homedir()): string {
  return join(home, BRAND.legacyConfigDir);
}

/** Readline history file at the workspace root: `.nexum_history`. */
export function historyFile(root: string): string {
  return join(root, `${BRAND.configDir}_history`);
}

/** Legacy readline history file: `.devagent_history`. */
export function legacyHistoryFile(root: string): string {
  return join(root, `${BRAND.legacyConfigDir}_history`);
}

/**
 * Resolve the workspace root the same way editor tooling does: walk up from
 * cwd to the nearest `.git`. A `.nexum` directory counts as a root marker for
 * non-git workspaces, with legacy `.devagent` kept as a fallback signal so a
 * DevAgent-era workspace is still found (and migrated) on first run. An
 * explicit NEXUM_WORKSPACE (or legacy DEVAGENT_WORKSPACE) always wins.
 */
export function findWorkspaceRoot(cwd: string, home: string = homedir()): string {
  const override = readEnv("WORKSPACE");
  if (override) return override;

  const root = resolve("/");
  const walkUpTo = (marker: string): string | null => {
    let dir = resolve(cwd);
    while (dir !== root) {
      if (existsSync(join(dir, marker)) && dir !== home) return dir;
      dir = resolve(dir, "..");
    }
    return null;
  };

  return walkUpTo(".git") ?? walkUpTo(BRAND.configDir) ?? walkUpTo(BRAND.legacyConfigDir) ?? cwd;
}
