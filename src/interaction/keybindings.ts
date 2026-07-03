/**
 * Keybinding dispatch. A pure resolver from key input + interaction
 * context to a UiCommand — no Ink types, so it is fully unit-testable.
 *
 * Core contract:
 *   1–8       focus a view          Tab/Shift+Tab   next/previous view
 *   Ctrl+P    command palette       Ctrl+B          actors overlay
 *   Ctrl+M    model switcher        Ctrl+F          search everywhere
 *   z         zoom active view      Esc             close overlay / cancel
 *   ?         help                  q               quit
 *
 * Changing focus never stops background actors.
 */

import { RuntimeMode, VIEW_ORDER, ViewId } from "../runtime/types";
import { OverlayId } from "./ui-state";

export interface KeyInfo {
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  tab?: boolean;
  escape?: boolean;
  return?: boolean;
}

export interface KeyContext {
  overlay: OverlayId | null;
  /** True when the prompt has pending text — bare letters/digits then type. */
  promptHasText: boolean;
  mode: RuntimeMode;
}

export type UiCommand =
  | { type: "focus-view"; view: ViewId }
  | { type: "next-view" }
  | { type: "prev-view" }
  | { type: "open-overlay"; overlay: OverlayId }
  | { type: "close-overlay" }
  | { type: "toggle-zoom" }
  | { type: "cancel" }
  | { type: "quit" }
  | { type: "approve" }
  | { type: "reject" }
  | { type: "view-diff" };

export function resolveKey(input: string, key: KeyInfo, ctx: KeyContext): UiCommand | null {
  // Escape always wins: close overlay first, otherwise cancel current action.
  if (key.escape) {
    return ctx.overlay ? { type: "close-overlay" } : { type: "cancel" };
  }

  // Global chords work regardless of prompt content.
  if (key.ctrl && input === "p") return { type: "open-overlay", overlay: "palette" };
  if (key.ctrl && input === "b") return { type: "open-overlay", overlay: "actors" };
  if (key.ctrl && input === "m") return { type: "open-overlay", overlay: "model" };
  if (key.ctrl && input === "f") return { type: "open-overlay", overlay: "search" };

  // Tab cycles views only when the prompt is empty — while typing it
  // belongs to the prompt (ghost-text / completion accept).
  if (key.tab && !ctx.overlay && !ctx.promptHasText) {
    return key.shift ? { type: "prev-view" } : { type: "next-view" };
  }

  // While an overlay is open, remaining keys belong to the overlay.
  if (ctx.overlay) return null;

  // Approval mode owns its keys when the prompt is empty.
  if (ctx.mode === "approval" && !ctx.promptHasText) {
    if (key.return || input === "a") return { type: "approve" };
    if (input === "n" || input === "N") return { type: "reject" };
    if (input === "d" || input === "D") return { type: "view-diff" };
  }

  // Bare keys are global only when the user is not mid-typing.
  if (ctx.promptHasText || key.ctrl || key.meta) return null;

  if (input >= "1" && input <= "8") {
    const view = VIEW_ORDER[Number(input) - 1];
    return { type: "focus-view", view };
  }
  if (input === "z") return { type: "toggle-zoom" };
  if (input === "?") return { type: "open-overlay", overlay: "help" };
  if (input === "q") return { type: "quit" };

  return null;
}
