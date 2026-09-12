/**
 * PresentationEvent — what the *UI* should show (review item 12).
 *
 * Pure presentation concerns: theme switches, toast notifications,
 * error toasts, log-buffer appends. The runtime NEVER needs these to
 * execute anything; they exist so a human can see what happened. Keeping
 * them in their own family means a headless consumer can subscribe to
 * everything except presentation, and the runtime's public event surface
 * stays free of UI vocabulary.
 */

import type { LogLevel, ThemeName } from "../types.js";

export type PresentationEvent =
  | { type: "theme.changed"; theme: ThemeName }
  | { type: "notification"; text: string; kind: "info" | "success" | "warning" | "error" }
  | { type: "logs.appended"; level: LogLevel; source: string; message: string }
  | { type: "error"; message: string };
