import { goalOverlap, looksLikeRepoDump } from "./relevance.js";
import {
  SECTION_PRIORITY,
  type ContextFragment,
  type ContextPackerOptions,
  type ExcludedFragment,
  type TaskContextInput,
} from "./types.js";

export type FragmentBuildResult = {
  fragments: ContextFragment[];
  excluded: ExcludedFragment[];
};

function capFragment(frag: ContextFragment, maxFragmentChars: number): ContextFragment {
  if (frag.text.length <= maxFragmentChars) return frag;
  return { ...frag, text: frag.text.slice(0, maxFragmentChars) + "\n…[truncated]" };
}

export function buildFragments(
  input: TaskContextInput,
  opts: Required<
    Pick<
      ContextPackerOptions,
      "minRelevance" | "maxFragmentChars" | "maxCodeItems" | "maxDocItems" | "maxToolOutputs" | "maxRawDumpChars"
    >
  >,
): FragmentBuildResult {
  const fragments: ContextFragment[] = [];
  const excluded: ExcludedFragment[] = [];
  const goal = input.goal.trim();

  if (!goal) {
    excluded.push({ id: "goal", kind: "goal", reason: "empty goal" });
  } else {
    fragments.push({ id: "goal", kind: "goal", priority: SECTION_PRIORITY.goal, text: goal, relevance: 1 });
  }

  for (const [i, d] of (input.diagnostics ?? []).entries()) {
    const msg = d.message.trim();
    if (!msg) {
      excluded.push({ id: `diag:${i}`, kind: "diagnostics", reason: "empty diagnostic" });
      continue;
    }
    const severity = d.severity ?? "info";
    const path = d.path?.trim();
    const text = path ? `[${severity}] ${path}: ${msg}` : `[${severity}] ${msg}`;
    const relevance = severity === "error" ? 1 : severity === "warning" ? 0.85 : 0.6;
    fragments.push(
      capFragment(
        {
          id: `diag:${i}:${path ?? "nopath"}`,
          kind: "diagnostics",
          priority: SECTION_PRIORITY.diagnostics + (severity === "error" ? 2 : 0),
          text,
          path,
          relevance,
        },
        opts.maxFragmentChars,
      ),
    );
  }

  const codeSorted = [...(input.code ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  let codeKept = 0;
  for (const [i, c] of codeSorted.entries()) {
    const id = `code:${c.path}:${c.symbol ?? i}`;
    const body = c.text?.trim() ?? "";
    if (!body) {
      excluded.push({ id, kind: "code", reason: "empty code text" });
      continue;
    }
    if (body.length > opts.maxRawDumpChars || looksLikeRepoDump(body)) {
      excluded.push({ id, kind: "code", reason: "rejected whole-repo or oversized dump" });
      continue;
    }
    const overlap = goalOverlap(goal, c.path, c.symbol ?? "", body.slice(0, 400));
    const score = c.score ?? overlap;
    const relevance = Math.max(score, overlap);
    if (relevance < opts.minRelevance) {
      excluded.push({
        id,
        kind: "code",
        reason: `irrelevant (relevance=${relevance.toFixed(3)} < ${opts.minRelevance})`,
      });
      continue;
    }
    if (codeKept >= opts.maxCodeItems) {
      excluded.push({ id, kind: "code", reason: "maxCodeItems exceeded" });
      continue;
    }
    codeKept += 1;
    const loc = c.startLine != null ? ` lines=${c.startLine}-${c.endLine ?? c.startLine}` : "";
    const sym = c.symbol ? ` symbol=${c.symbol}` : "";
    const header = `<code path="${c.path}"${sym}${loc}>`;
    fragments.push(
      capFragment(
        {
          id,
          kind: "code",
          priority: SECTION_PRIORITY.code + Math.min(relevance, 1) * 5,
          text: `${header}\n${body}`,
          path: c.path,
          relevance,
        },
        opts.maxFragmentChars,
      ),
    );
  }

  const diff = input.gitDiff?.trim() ?? "";
  if (diff) {
    if (diff.length > opts.maxRawDumpChars || looksLikeRepoDump(diff)) {
      excluded.push({ id: "git_diff", kind: "git_diff", reason: "rejected oversized git dump" });
    } else {
      const overlap = goalOverlap(goal, diff.slice(0, 800));
      const relevance = Math.max(0.5, overlap);
      fragments.push(
        capFragment(
          {
            id: "git_diff",
            kind: "git_diff",
            priority: SECTION_PRIORITY.git_diff,
            text: `<git_diff>\n${diff}`,
            relevance,
          },
          opts.maxFragmentChars,
        ),
      );
    }
  }

  let toolsKept = 0;
  for (const [i, t] of (input.toolOutputs ?? []).entries()) {
    const id = `tool:${t.tool}:${i}`;
    const content = t.content?.trim() ?? "";
    if (!content) {
      excluded.push({ id, kind: "tool_output", reason: "empty tool output" });
      continue;
    }
    if (content.length > opts.maxRawDumpChars || looksLikeRepoDump(content)) {
      excluded.push({ id, kind: "tool_output", reason: "rejected oversized tool dump" });
      continue;
    }
    if (toolsKept >= opts.maxToolOutputs) {
      excluded.push({ id, kind: "tool_output", reason: "maxToolOutputs exceeded" });
      continue;
    }
    toolsKept += 1;
    const overlap = goalOverlap(goal, t.tool, content.slice(0, 400));
    const relevance = t.isError ? Math.max(0.7, overlap) : overlap;
    if (!t.isError && relevance < opts.minRelevance) {
      excluded.push({ id, kind: "tool_output", reason: `irrelevant tool output (relevance=${relevance.toFixed(3)})` });
      continue;
    }
    fragments.push(
      capFragment(
        {
          id,
          kind: "tool_output",
          priority: SECTION_PRIORITY.tool_output + (t.isError ? 5 : 0),
          text: `<tool_output name="${t.tool}"${t.isError ? ' error="true"' : ""}>\n${content}`,
          relevance,
        },
        opts.maxFragmentChars,
      ),
    );
  }

  return { fragments, excluded };
}
