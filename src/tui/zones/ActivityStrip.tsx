import React from "react";
import { RuntimeState, ViewId } from "../../runtime/types.js";
import { activityStripTokens } from "../../layout/strips.js";
import { semanticColor } from "../../layout/theme-map.js";
import { TokenLine } from "./TokenLine.js";

export interface ActivityStripProps {
  state: RuntimeState;
  width: number;
  now?: number;
  activeView?: ViewId;
}

const NOTIFICATION_TTL_MS = 5000;

const NOTIFICATION_HEALTH = {
  info: "active",
  success: "healthy",
  warning: "waiting",
  error: "error",
} as const;

/** Primary nav tabs; recent notifications surface as a toast token. */
export function ActivityStrip({ state, width, now = Date.now(), activeView }: ActivityStripProps): React.JSX.Element {
  const tokens = activityStripTokens(state, activeView);
  const latest = state.notifications[state.notifications.length - 1];
  if (latest && now - latest.at < NOTIFICATION_TTL_MS) {
    tokens.push({
      text: `${latest.kind === "success" ? "✓ " : latest.kind === "error" ? "✗ " : ""}${latest.text}`,
      priority: 0,
      color: semanticColor(NOTIFICATION_HEALTH[latest.kind]),
    });
  }
  return <TokenLine tokens={tokens} width={width} />;
}
