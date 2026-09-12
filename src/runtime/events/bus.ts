/**
 * The runtime event bus (review item 12 split applied).
 *
 * `RuntimeEvent` is now the *compatibility umbrella* over four coherent
 * families — ExecutionEvent, DomainEvent, StateEvent, PresentationEvent —
 * defined in their own modules. One bus still fans events out (the state
 * store is the primary subscriber; rendering reads the store), but the
 * type surface is split so:
 *
 *   - the persistence layer (runtime/persistence) subscribes to
 *     ExecutionEvent only (durable, replayable — review item 13);
 *   - headless consumers subscribe to everything except presentation;
 *   - UI vocabulary (theme/notification) never leaks into runtime code.
 *
 * Every event published by the execution runtime flows through here;
 * family classification lives in core/events/families.ts.
 */

import {
  ExecutionEvent,
} from "./execution-events.js";
import { DomainEvent } from "./domain-events.js";
import { StateEvent } from "./state-events.js";
import { PresentationEvent } from "./presentation-events.js";

export type RuntimeEvent = ExecutionEvent | DomainEvent | StateEvent | PresentationEvent;

export type { ExecutionEvent } from "./execution-events.js";
export type { DomainEvent } from "./domain-events.js";
export type { StateEvent } from "./state-events.js";
export type { PresentationEvent } from "./presentation-events.js";

export type EventListener = (event: RuntimeEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  publish(event: RuntimeEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
