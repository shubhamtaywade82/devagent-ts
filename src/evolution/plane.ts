/**
 * Evolution Plane (review item 23) — the explicit layering contract.
 *
 *   Evolution Plane   (this module + engine-v2 ClosedLoopEngine)
 *        ↓ observes telemetry, diagnoses, proposes + validates mutations,
 *          and activates accepted changes
 *   Control Plane     (orchestration/: planner, scheduler, delegator)
 *        ↓
 *   Agent Runtime     (runtime/: strategies, contexts, budgets)
 *
 * Positioning rules enforced by this module + contract tests:
 *   1. The evolution plane is a CONSUMER of the runtime — never the other
 *      way around: src/{core,runtime,models,tools,mcp,orchestration} must
 *      never import src/evolution (contract test enforces this).
 *   2. Self-evolution concepts (hypotheses, mutation runs, acceptance
 *      gates, activation) do NOT appear in normal execution paths: a
 *      product run touches runtime + control plane only.
 *   3. When an evolution candidate is ACCEPTED, it activates downward
 *      through RuntimeActivationController — a controlled, verified
 *      switch, never an in-place mutation of a running run.
 */

import type { AgentRuntime } from "../core/types.js";
import type { AgentRegistry } from "../runtime/agent/agent-runtime.js";

/**
 * The evolution plane facade. Products wire it ABOVE their control plane:
 * it observes episodes/telemetry from below, and pushes accepted changes
 * back down through the activation controller.
 */
export interface EvolutionPlane {
  /** The runtime this plane evolves (consumed, never owned). */
  readonly runtime: AgentRuntime;
  /** Agent registry the plane may spawn mutation runs against. */
  readonly agents: AgentRegistry;
}

export const EVOLUTION_PLANE_LAYERING = {
  above: ["control-plane", "agent-runtime"],
  below: [],
  imports: ["runtime", "core", "models", "tools (read/propose-only packs)"],
  forbiddenInverseImports: [
    "src/core/** → src/evolution/**",
    "src/runtime/** → src/evolution/**",
    "src/models/** → src/evolution/**",
    "src/tools/** → src/evolution/**",
    "src/mcp/** → src/evolution/**",
    "src/orchestration/** → src/evolution/**",
  ],
} as const;

/**
 * Layering summary for docs/doctor output. The ClosedLoopEngine itself
 * (engine-v2.ts) stays unchanged — this plane module is the boundary
 * declaration that keeps self-evolution OUT of normal execution.
 */
export function evolutionPlaneSummary(): string {
  return [
    "Evolution Plane (src/evolution)",
    "  observes: episodes, telemetry, benchmarks (read-only)",
    "  proposes: hypotheses → mutation runs (propose-only tool packs)",
    "  validates: fixed-executor evaluation + two-stage selection",
    "  activates: freeze → switch → verify → persist (RuntimeActivationController)",
    "  layering: Evolution Plane → Control Plane → Agent Runtime",
  ].join("\n");
}
