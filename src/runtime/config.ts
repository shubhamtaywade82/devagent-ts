/**
 * Runtime configuration constants. Values can be overridden via environment variables.
 * This allows CI or interactive sessions to tune buffer sizes without code changes.
 */

import { readEnv } from "../platform/environment.js";

/**
 * A bare `parseInt` here returned NaN for a malformed value, and `bounded()`
 * in store.ts compares `items.length > max` — false for NaN — so the buffer it
 * was meant to cap grew without limit for the rest of the session. Fall back
 * to the default unless the override is a usable positive integer.
 */
function boundedLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const MAX_LOGS = boundedLimit(readEnv("MAX_LOGS"), 500);
export const MAX_CONVERSATION = boundedLimit(readEnv("MAX_CONVERSATION"), 500);
export const MAX_TOOL_CALLS = boundedLimit(readEnv("MAX_TOOL_CALLS"), 200);
export const MAX_NOTIFICATIONS = boundedLimit(readEnv("MAX_NOTIFICATIONS"), 20);
