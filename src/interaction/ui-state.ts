/**
 * UI state: which view is observed, which overlay is open, zoom.
 * This is presentation state only — it never touches runtime state, so
 * closing an overlay or switching views can never stop an actor.
 */

import { VIEW_ORDER, ViewId } from "../runtime/types";
import { UiCommand } from "./keybindings";

export type OverlayId = "palette" | "help" | "actors" | "diff" | "model" | "search";

export interface UiState {
  activeView: ViewId;
  overlay: OverlayId | null;
  zoom: boolean;
}

export function initialUiState(): UiState {
  return { activeView: "conversation", overlay: null, zoom: false };
}

function cycleView(current: ViewId, delta: number): ViewId {
  const idx = VIEW_ORDER.indexOf(current);
  const next = (idx + delta + VIEW_ORDER.length) % VIEW_ORDER.length;
  return VIEW_ORDER[next];
}

export function uiReduce(state: UiState, command: UiCommand): UiState {
  switch (command.type) {
    case "focus-view":
      return { ...state, activeView: command.view };
    case "next-view":
      return { ...state, activeView: cycleView(state.activeView, 1) };
    case "prev-view":
      return { ...state, activeView: cycleView(state.activeView, -1) };
    case "open-overlay":
      return { ...state, overlay: command.overlay };
    case "close-overlay":
      return { ...state, overlay: null };
    case "toggle-zoom":
      return { ...state, zoom: !state.zoom };
    case "view-diff":
      return { ...state, overlay: "diff" };
    case "cancel":
      return state;
    default:
      return state;
  }
}
