/**
 * Event families — the first cut of splitting the RuntimeEvent mega-union
 * into three coherent families (review recommendation §6):
 *
 *   ExecutionEvent     — what the machine is doing (task/tool/model/usage)
 *   DomainEvent        — what the world looks like (git/memory/mcp/lsp/skills)
 *   PresentationEvent  — what the UI should show (theme/notification/status)
 *
 * Today all three ride on one union (RuntimeEvent) and one bus; the
 * classification below is additive: `familyOf(event)` tags each event, and
 * the family-filtered subscribes (`executionEvents`, `presentationEvents`)
 * let downstream consumers (state projections, UI) subscribe to only the
 * slice they care about — without breaking existing listeners.
 */

import type { RuntimeEvent } from "../../runtime/events.js";

export type EventFamily = "execution" | "domain" | "presentation";

/** Prefix → family routing. Longest-prefix wins; "domain" is the fallback. */
const FAMILY_BY_PREFIX: Array<readonly [string, EventFamily]> = [
  // Execution: the act of running tasks and tools.
  ["tool.", "execution"],
  ["task.", "execution"],
  ["execution.", "execution"],
  ["mission.", "execution"],
  ["node.", "execution"],
  ["model.", "execution"],
  ["usage.", "execution"],
  ["context.", "execution"],
  ["sandbox.", "execution"],
  ["approval.", "execution"],
  ["clarification.", "execution"],
  // Presentation: UI-visible state that is not execution itself.
  ["theme.", "presentation"],
  ["notification", "presentation"],
  ["status.", "presentation"],
  ["mode.", "presentation"],
  ["error", "presentation"],
  ["logs.", "presentation"],
];

const PRESENTATION_TYPES = new Set(["notification", "error"]);

export function familyOf(event: RuntimeEvent): EventFamily {
  if (PRESENTATION_TYPES.has(event.type)) return "presentation";
  for (const [prefix, family] of FAMILY_BY_PREFIX) {
    if (event.type.startsWith(prefix)) return family;
  }
  // conversation.*, git.*, memory.*, mcp.*, lsp.*, rails.*, skills.*,
  // project.* describe the world/state rather than the act of execution.
  return "domain";
}

export type ExecutionEvent = RuntimeEvent & { __family?: "execution" };
export type DomainEvent = RuntimeEvent & { __family?: "domain" };
export type PresentationEvent = RuntimeEvent & { __family?: "presentation" };

export function isExecutionEvent(event: RuntimeEvent): event is ExecutionEvent {
  return familyOf(event) === "execution";
}

export function isDomainEvent(event: RuntimeEvent): event is DomainEvent {
  return familyOf(event) === "domain";
}

export function isPresentationEvent(event: RuntimeEvent): event is PresentationEvent {
  return familyOf(event) === "presentation";
}

/**
 * A family-filtering event sink. Wraps any EventSink (or EventBus) and only
 * forwards events of the requested families — the seam where the current
 * single-union bus starts behaving like three families without a rewrite.
 */
export interface KernelEventSink {
  publish(event: RuntimeEvent): void;
}

export function filteringSink(sink: KernelEventSink, families: readonly EventFamily[]): KernelEventSink {
  return {
    publish(event: RuntimeEvent) {
      if (families.includes(familyOf(event))) sink.publish(event);
    },
  };
}
