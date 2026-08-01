import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { isSensitivePath } from "../safety/path-policy.js";
import { accepted, issue, rejected } from "./issues.js";
import { validateSyntax } from "./syntax.js";
import type {
  PatchHunk,
  PatchSafetyContext,
  StrictValidationResult,
} from "./types.js";

const DEFAULT_MAX_PATCH = 50_000;
const DEFAULT_MAX_PLAN = 200_000;

function resolveUnderRoot(
  projectRoot: string | undefined,
  filePath: string,
): { ok: true; abs: string; rel: string } | { ok: false; error: string } {
  const rel = filePath.replace(/\\/g, "/");
  if (!projectRoot) return { ok: true, abs: rel, rel };

  const abs = resolve(projectRoot, rel);
  const root = resolve(projectRoot);
  const normRel = relative(root, abs);
  if (isAbsolute(normRel) || normRel.startsWith("..")) {
    return { ok: false, error: "path escapes project root" };
  }
  return { ok: true, abs, rel: normalize(normRel).replace(/\\/g, "/") };
}

/** Reject malformed, oversized, sensitive, or syntactically broken patches. */
export function validatePatchSafety(
  patches: PatchHunk[],
  ctx: PatchSafetyContext = {},
): StrictValidationResult<PatchHunk[]> {
  const maxPatch = ctx.maxPatchChars ?? DEFAULT_MAX_PATCH;
  const maxPlan = ctx.maxPlanChars ?? DEFAULT_MAX_PLAN;
  const issues = [];

  let total = 0;
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]!;
    const base = `patch_plan[${i}]`;

    if (p.old_str.length > maxPatch || p.new_str.length > maxPatch) {
      issues.push(issue("patch_oversized", `hunk exceeds maxPatchChars (${maxPatch})`, base));
      continue;
    }
    total += p.old_str.length + p.new_str.length;

    if (isSensitivePath(p.path)) {
      issues.push(issue("sensitive_path", `refuses to patch sensitive path: ${p.path}`, `${base}.path`));
      continue;
    }

    const resolved = resolveUnderRoot(ctx.projectRoot, p.path);
    if (!resolved.ok) {
      issues.push(issue("path_escape", resolved.error, `${base}.path`));
      continue;
    }

    if (ctx.projectRoot && existsSync(resolved.abs)) {
      let current: string;
      try {
        current = readFileSync(resolved.abs, "utf8");
      } catch {
        issues.push(issue("read_failed", `cannot read ${p.path} for safety check`, `${base}.path`));
        continue;
      }
      const count = current.split(p.old_str).length - 1;
      if (count === 0) {
        issues.push(issue("old_str_missing", "old_str not found in file", `${base}.old_str`));
        continue;
      }
      if (count > 1) {
        issues.push(issue("old_str_ambiguous", `old_str matches ${count} times; must be unique`, `${base}.old_str`));
        continue;
      }
      const next = current.replace(p.old_str, p.new_str);
      const syn = validateSyntax(p.path, next);
      if (!syn.ok) issues.push(issue("syntax_invalid", syn.error ?? "syntax check failed", base));
    } else {
      const syn = validateSyntax(p.path, p.new_str);
      if (!syn.ok && (p.path.endsWith(".json") || p.path.match(/\.[jt]sx?$/))) {
        issues.push(issue("syntax_invalid", syn.error ?? "syntax check failed", `${base}.new_str`));
      }
    }
  }

  if (total > maxPlan) {
    issues.push(issue("plan_oversized", `total patch size ${total} exceeds limit (${maxPlan})`, "patch_plan"));
  }

  return issues.length ? rejected(issues) : accepted(patches);
}

/** Safety for a single full-file write operation. */
export function validateWriteSafety(
  path: string,
  content: string,
  ctx: PatchSafetyContext = {},
): StrictValidationResult<{ path: string; content: string }> {
  const maxPatch = ctx.maxPatchChars ?? DEFAULT_MAX_PATCH;
  if (!path || typeof path !== "string") return rejected([issue("invalid_write", "path required", "path")]);
  if (typeof content !== "string") return rejected([issue("invalid_write", "content must be a string", "content")]);
  if (content.length > maxPatch) {
    return rejected([issue("write_oversized", `content exceeds maxPatchChars (${maxPatch})`, "content")]);
  }
  if (isSensitivePath(path)) {
    return rejected([issue("sensitive_path", `refuses to write sensitive path: ${path}`, "path")]);
  }
  const resolved = resolveUnderRoot(ctx.projectRoot, path);
  if (!resolved.ok) return rejected([issue("path_escape", resolved.error, "path")]);

  const syn = validateSyntax(path, content);
  if (!syn.ok) return rejected([issue("syntax_invalid", syn.error ?? "syntax check failed", "content")]);

  return accepted({ path: resolved.rel, content });
}
