/**
 * Experiment Provenance Rendering for GitHub PRs.
 *
 * Makes the PR a persistent experiment record, not merely a code review:
 * the full ExperimentRecord is rendered as a machine-readable YAML block
 * embedded in the PR body, covering parent/candidate provenance, the formed
 * target, the frozen executor matrix, visible/held-out/transfer evaluation,
 * the two-stage decision, CI status, and review state.
 */

import { ExperimentRecord } from "./experiment-schema.js";

/** Renders a nested JS value as YAML with 2-space indentation. */
export function renderYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return `${pad}null`;
  if (typeof value === "string") {
    return needsQuoting(value) ? `${pad}${JSON.stringify(value)}` : `${pad}${value}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return `${pad}${value}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value.map((item) => renderScalarArrayItem(item, indent)).join("\n");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return `${pad}{}`;
  return entries
    .map(([k, v]) => {
      if (isScalar(v)) {
        return `${pad}${k}: ${renderInline(v)}`;
      }
      return `${pad}${k}:\n${renderYaml(v, indent + 1)}`;
    })
    .join("\n");
}

function renderScalarArrayItem(item: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (isScalar(item)) return `${pad}- ${renderInline(item)}`;
  const nested = renderYaml(item, indent + 1);
  return `${pad}-\n${nested}`;
}

function isScalar(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== "object";
}

function renderInline(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return needsQuoting(v) ? JSON.stringify(v) : v;
  return String(v);
}

function needsQuoting(s: string): boolean {
  return (
    s === "" ||
    // Leading indicator characters are YAML hazards.
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    // ": " (mapping) and " #" (comment) sequences inside the scalar.
    /:\s/.test(s) ||
    /\s#/.test(s) ||
    // Ends with a colon → would parse as a key.
    /:$/.test(s) ||
    // Reserved scalars and numeric-looking values.
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ||
    /^\s|\s$/.test(s)
  );
}

/** Renders the complete `experiment:` YAML block for the PR body. */
export function formatExperimentProvenanceYaml(record: ExperimentRecord): string {
  const block: Record<string, unknown> = {
    experiment: {
      id: record.id,
    },
    parent: {
      harness: record.parent.harness,
      commit: record.parent.commit,
    },
    candidate: {
      harness: record.candidate.harness,
      commit: record.candidate.commit,
    },
    target: {
      capability: record.target.capability,
      id: record.target.targetId,
    },
    hypothesis: {
      statement: record.hypothesis.statement,
    },
    executor: {
      primary: record.executor.primary,
      transfer: record.executor.transfer,
    },
    evaluation: {
      visible: record.evaluation.visible,
      held_out: record.evaluation.held_out,
      transfer: record.evaluation.transfer,
    },
    metrics: record.metrics,
    decision: {
      result: record.decision.result,
      stage_a: record.decision.stageA,
      stage_b: record.decision.stageB,
    },
    ci: {
      status: record.ci.status,
    },
    review: {
      state: record.review.state,
    },
    lifecycle: {
      state: record.lifecycle.state,
    },
  };
  return renderYaml(block);
}

/** Wraps the YAML block for embedding in a Markdown PR body. */
export function provenanceYamlCodeBlock(record: ExperimentRecord): string {
  return [
    "### 4. Experiment Provenance (machine-readable)",
    "",
    "```yaml",
    formatExperimentProvenanceYaml(record),
    "```",
  ].join("\n");
}
