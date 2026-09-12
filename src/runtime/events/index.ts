/**
 * Runtime events — public surface (review items 12/13).
 *
 *   ExecutionEvent        what the machine is doing (persisted + replayed)
 *   DomainEvent           what the world looks like
 *   StateEvent            how runtime state is projected
 *   PresentationEvent     what the UI should show
 *
 * `RuntimeEvent` (umbrella) and `EventBus` (transport) come from bus.ts;
 * correlation contracts come from core/events/envelope.ts.
 */

export type {
  ExecutionEvent,
  DomainEvent,
  StateEvent,
  PresentationEvent,
  RuntimeEvent,
  EventListener,
} from "./bus.js";
export { EventBus } from "./bus.js";
export type { EventEnvelope, PersistedEventRecord } from "../../core/events/envelope.js";
export {
  familyOf,
  isExecutionEvent,
  isDomainEvent,
  isStateEvent,
  isPresentationEvent,
  filteringSink,
} from "../../core/events/families.js";
export type { EventFamily, KernelEventSink } from "../../core/events/families.js";
