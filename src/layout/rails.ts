/**
 * Phase-driven dashboard layout: which side rails accompany the activity
 * stream is decided by what the agent is actually doing, not a fixed grid.
 */

import { RuntimeState } from "../runtime/types.js";

export type LayoutPhase = "idle" | "planning" | "coding" | "validating" | "reviewing" | "repairing";

export interface RailConfig {
  left: "mission" | null;
  right: "files" | "diagnostics" | "diff" | null;
}

export function layoutPhase(state: RuntimeState): LayoutPhase {
  const running = state.mission.phases.find((p) => p.status === "running");
  if (running) {
    switch (running.id) {
      case "understand":
      case "inspect":
      case "plan":
        return "planning";
      case "execute":
        return "coding";
      case "validate":
        return "validating";
      case "review":
        return "reviewing";
      case "repair":
        return "repairing";
      case "complete":
        return "idle";
    }
  }
  // No live mission — the user-selected agent mode still hints at intent.
  if (state.agentMode === "debug") return "repairing";
  if (state.agentMode === "review") return "reviewing";
  return "idle";
}

// ponytail: direct phase→rail mapping, add ~3s dwell if rails visibly thrash
export function railsForPhase(phase: LayoutPhase): RailConfig {
  switch (phase) {
    case "idle":
      return { left: null, right: null };
    case "planning":
      return { left: "mission", right: null };
    case "coding":
      return { left: "mission", right: "files" };
    case "validating":
      return { left: "mission", right: "diagnostics" };
    case "reviewing":
      return { left: null, right: "diff" };
    case "repairing":
      return { left: null, right: "diagnostics" };
  }
}
