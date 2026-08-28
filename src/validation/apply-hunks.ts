import type { PatchHunk } from "./types.js";

/** Apply search/replace hunks in order. Fails loudly on missing or ambiguous old_str. */
export function applyPatchHunks(
  content: string,
  hunks: PatchHunk[],
): { ok: true; content: string } | { ok: false; error: string } {
  let current = content;
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i]!;
    const count = current.split(h.old_str).length - 1;
    if (count === 0) {
      return { ok: false, error: `hunk[${i}]: old_str not found in ${h.path}` };
    }
    if (count > 1) {
      return { ok: false, error: `hunk[${i}]: old_str matches ${count} times in ${h.path}` };
    }
    current = current.replace(h.old_str, h.new_str);
  }
  return { ok: true, content: current };
}
