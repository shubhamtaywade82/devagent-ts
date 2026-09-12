/**
 * WorkspaceGuard — centralized filesystem isolation (review item 9).
 *
 * Every filesystem operation from every tool (read, write, delete, move,
 * copy, patch, watch) resolves its target through ONE guard, which
 * enforces:
 *
 *   1. workspace containment — the real path (symlinks resolved) must stay
 *      inside the workspace root (or the run's write scope when narrower);
 *   2. symlink escape — a path whose nearest EXISTING ancestor resolves
 *      outside the workspace is rejected, and a not-yet-existing target is
 *      validated through that nearest existing ancestor (handles
 *      symlinked directories pointing out of the tree);
 *   3. non-existent target paths — read/delete/move/copy/patch/watch of a
 *      missing file produce a structured NotFound verdict instead of an
 *      exception; write/create create parent directories inside the scope
 *      only;
 *   4. sensitive-path protection (.env, credentials, keys) on every
 *      mutating op.
 *
 * The guard returns VERDICTS (data), never throws for expected cases, so
 * tools map verdicts to structured ToolResults and policies can inspect
 * them. Programmers who want exceptions can use `requireAllowed`.
 */

import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export type FsOperation = "read" | "write" | "delete" | "move" | "copy" | "patch" | "watch" | "mkdir";

export interface FsVerdict {
  allowed: boolean;
  /** Absolute real path (symlinks resolved) when allowed. */
  resolvedPath?: string;
  code:
    | "ok"
    | "not_found"
    | "escape"
    | "symlink_escape"
    | "outside_write_scope"
    | "sensitive_path"
    | "not_a_file"
    | "not_a_directory"
    | "invalid_path";
  message: string;
}

/** Basenames/patterns that mutate ops never touch. */
const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "credentials.json",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
]);
const SENSITIVE_PATTERNS = [
  /(^|\/)\.ssh\//,
  /(^|\/)\.aws\//,
  /(^|\/)\.gnupg\//,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)secrets?\//i,
];

export interface WorkspaceGuardOptions {
  /** Workspace root (absolute). */
  root: string;
  /** Narrower write scope (absolute, inside root) — e.g. a task subtree. */
  writeScope?: string;
  /** Extra deny patterns for mutation (regex over the relative path). */
  denyPatterns?: RegExp[];
}

export class WorkspaceGuard {
  private readonly rootReal: string;
  private readonly writeScopeReal?: string;

  constructor(private readonly opts: WorkspaceGuardOptions) {
    this.rootReal = realOrPlain(opts.root);
    if (opts.writeScope) this.writeScopeReal = realOrPlain(opts.writeScope);
  }

  get root(): string {
    return this.rootReal;
  }

  get writeScope(): string | undefined {
    return this.writeScopeReal;
  }

  /** Central verdict for one operation on one path. */
  check(op: FsOperation, relativePath: string): FsVerdict {
    if (typeof relativePath !== "string" || relativePath === "") {
      return { allowed: false, code: "invalid_path", message: "path must be a non-empty string" };
    }

    // absolute paths are re-anchored relative to the root
    const rel = relativePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relativePath)
      ? relative(this.rootReal, resolve(relativePath))
      : relativePath;
    const nominal = resolve(join(this.rootReal, rel));

    // Symlink-aware resolution: walk to the nearest existing ancestor and
    // resolve the remainder from there (review item 9 — symlink escape and
    // non-existent targets handled correctly).
    const { nearest, remainder } = nearestExistingAncestor(nominal);
    const nearestReal = realOrPlain(nearest);

    // link in the path chain pointing outside the workspace?
    if (nearest !== nominal) {
      // a symlinked directory must itself stay inside the root
      const relNearest = relative(this.rootReal, nearestReal);
      if (relNearest === ".." || relNearest.startsWith(`..${sep}`) || relNearest.startsWith(sep)) {
        return {
          allowed: false,
          code: "symlink_escape",
          message: `${relativePath} traverses a symlink (${nearest}) that resolves outside the workspace`,
        };
      }
    }
    const resolvedPath = remainder ? resolve(join(nearestReal, remainder)) : nearestReal;

    // containment of the final resolved target
    const relFinal = relative(this.rootReal, resolvedPath);
    if (relFinal === ".." || relFinal.startsWith(`..${sep}`) || relFinal.startsWith(sep)) {
      return {
        allowed: false,
        code: "escape",
        message: `${relativePath} resolves outside the workspace root`,
      };
    }

    // existence semantics per operation
    const existsTarget = existsSync(resolvedPath);
    const expectsExisting: FsOperation[] = ["read", "delete", "move", "copy", "patch", "watch"];
    if (expectsExisting.includes(op) && !existsTarget) {
      return {
        allowed: false,
        code: "not_found",
        message: `${relativePath} does not exist (checked ${resolvedPath})`,
      };
    }
    if (op === "read" || op === "copy" || op === "patch") {
      if (existsTarget && !statSync(resolvedPath).isFile()) {
        return { allowed: false, code: "not_a_file", message: `${relativePath} is not a regular file` };
      }
    }

    // write scope (mutations must land in the narrower scope when set)
    const mutating: FsOperation[] = ["write", "delete", "move", "patch", "mkdir"];
    if (mutating.includes(op) && this.writeScopeReal) {
      const relScope = relative(this.writeScopeReal, resolvedPath);
      if (relScope === ".." || relScope.startsWith(`..${sep}`) || relScope.startsWith(sep)) {
        return {
          allowed: false,
          code: "outside_write_scope",
          message: `${relativePath} is outside the run's write scope`,
        };
      }
    }

    // sensitive paths block mutation always
    if (mutating.includes(op) && isSensitive(relFinal)) {
      return {
        allowed: false,
        code: "sensitive_path",
        message: `${relativePath} matches a protected credential/secret pattern`,
      };
    }

    // extra deny patterns
    if (mutating.includes(op)) {
      for (const pattern of this.opts.denyPatterns ?? []) {
        if (pattern.test(relFinal)) {
          return {
            allowed: false,
            code: "sensitive_path",
            message: `${relativePath} matches a workspace deny pattern`,
          };
        }
      }
    }

    return { allowed: true, resolvedPath, code: "ok", message: "ok" };
  }

  /** Throwing variant for tools that prefer exceptions. */
  requireAllowed(op: FsOperation, relativePath: string): string {
    const verdict = this.check(op, relativePath);
    if (!verdict.allowed || !verdict.resolvedPath) {
      throw new WorkspacePathError(verdict);
    }
    return verdict.resolvedPath;
  }

  /** Validate a source/destination pair for move/copy. */
  checkPair(op: "move" | "copy", from: string, to: string): { from: FsVerdict; to: FsVerdict } {
    const fromVerdict = this.check(op, from);
    const toVerdict = this.check("write", to);
    return { from: fromVerdict, to: toVerdict };
  }
}

export class WorkspacePathError extends Error {
  constructor(public readonly verdict: FsVerdict) {
    super(verdict.message);
    this.name = "WorkspacePathError";
  }
}

// ── internals ───────────────────────────────────────────────────────────────

function realOrPlain(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** Nearest existing ancestor of a path + the non-existent remainder. */
function nearestExistingAncestor(p: string): { nearest: string; remainder: string } {
  let probe = p;
  const parts: string[] = [];
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    parts.unshift(probe.slice(parent.length + sep.length) || probe);
    probe = parent;
    if (parts.length > 64) break; // pathological depth guard
  }
  if (parts.length === 0) return { nearest: p, remainder: "" };
  return { nearest: probe, remainder: parts.join(sep) };
}

function isSensitive(relPath: string): boolean {
  const base = relPath.split(sep).pop() ?? "";
  if (SENSITIVE_BASENAMES.has(base)) return true;
  const posix = relPath.split(sep).join("/");
  return SENSITIVE_PATTERNS.some((p) => p.test(posix));
}

/** Is the path a dangling symlink? (watch/patch tools want to know) */
export function isDanglingSymlink(p: string): boolean {
  try {
    lstatSync(p);
    return !existsSync(p);
  } catch {
    return false;
  }
}
