/**
 * Colors are semantic only: healthy = done, active = focused, waiting =
 * warning, error = blocked, thinking = model activity, muted = de-emphasized.
 * Three palettes ship; which one is active is driven by the store's
 * "theme.changed" event (see runtime/store.ts) and mirrored here into
 * `activeThemeName` so the ~15 semanticColor() call sites across the TUI
 * don't each need `state.theme` threaded through as a parameter.
 */

import { ActorHealth, ThemeName } from "../runtime/types.js";

interface SemanticPalette {
  healthy: string;
  active: string;
  waiting: string;
  error: string;
  thinking: string;
  muted: string;
  border: string;
  focusBorder: string;
}

const THEMES: Record<ThemeName, SemanticPalette> = {
  default: {
    healthy: "green",
    active: "blue",
    waiting: "yellow",
    error: "red",
    thinking: "magenta",
    muted: "gray",
    border: "gray",
    focusBorder: "blue",
  },
  midnight: {
    healthy: "#98c379",
    active: "#61afef",
    waiting: "#e5c07b",
    error: "#e06c75",
    thinking: "#c678dd",
    muted: "#5c6370",
    border: "#3e4451",
    focusBorder: "#61afef",
  },
  solarized: {
    healthy: "#859900",
    active: "#268bd2",
    waiting: "#b58900",
    error: "#dc322f",
    thinking: "#d33682",
    muted: "#657b83",
    border: "#073642",
    focusBorder: "#268bd2",
  },
};

let activeThemeName: ThemeName = "default";

/** Only the store's reducer calls this, in lockstep with "theme.changed". */
export function setActiveTheme(name: ThemeName): void {
  activeThemeName = name;
}

export function getActiveTheme(): ThemeName {
  return activeThemeName;
}

export function semanticColor(health: ActorHealth): string {
  const p = THEMES[activeThemeName];
  switch (health) {
    case "healthy":
      return p.healthy;
    case "active":
      return p.active;
    case "waiting":
      return p.waiting;
    case "error":
      return p.error;
    case "thinking":
      return p.thinking;
    case "muted":
      return p.muted;
  }
}

export function themeColors(name: ThemeName = activeThemeName): SemanticPalette {
  return THEMES[name];
}
