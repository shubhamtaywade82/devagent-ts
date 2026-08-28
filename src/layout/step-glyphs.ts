/** Shared status glyph map — extracted from ExecutionView so MissionPanel renders identically. */

export type CoarseStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export const STEP_GLYPH: Record<CoarseStatus, { glyph: string; color: string }> = {
  pending: { glyph: "○", color: "gray" },
  running: { glyph: "▶", color: "blue" },
  completed: { glyph: "✓", color: "green" },
  failed: { glyph: "✗", color: "red" },
  skipped: { glyph: "↷", color: "yellow" },
};

/**
 * PlanStep's finer StepStatus (analyzing/planning/implementing/testing/
 * reviewing/blocked/rejected/...) collapses onto the same 5 glyphs the
 * mission phases use, so Execute's live substeps read consistently with
 * the phase checklist above them.
 */
export function glyphForStepStatus(status: string): { glyph: string; color: string } {
  switch (status) {
    case "completed":
      return STEP_GLYPH.completed;
    case "failed":
    case "blocked":
    case "rejected":
    case "rolledback":
      return STEP_GLYPH.failed;
    case "skipped":
    case "cancelled":
    case "paused":
      return STEP_GLYPH.skipped;
    case "pending":
      return STEP_GLYPH.pending;
    default:
      // analyzing / planning / implementing / testing / reviewing / running
      return STEP_GLYPH.running;
  }
}
