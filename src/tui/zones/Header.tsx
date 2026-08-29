import React from "react";
import { Box, Spacer, Text } from "ink";
import { AGENT_MODE_LABELS, RuntimeState } from "../../runtime/types.js";
import { truncate } from "../../layout/truncate.js";

export interface HeaderProps {
  state: RuntimeState;
  width: number;
  now?: number;
}

// Matches the existing hardcoded-version convention already used elsewhere
// in this codebase (src/lsp/client.ts, src/mcp/client.ts), not read from
// package.json at runtime.
const APP_VERSION = "v0.1.0";

function formatClock(now: number): string {
  const d = new Date(now);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Top bar: "devagent-ts v0.1.0 │ Mission: <goal>" on the left, "MODE: X
 * MODEL: Y HH:MM:SS" right-aligned. MODE shows the real AgentMode label
 * (Code/Ask/Architect/...), not a fabricated build-status word.
 */
export function Header({ state, width, now = Date.now() }: HeaderProps): React.JSX.Element {
  const modeLabel = AGENT_MODE_LABELS[state.agentMode].label.toUpperCase();
  const modelName = state.model.name || "-";
  const clock = formatClock(now);

  const leftPrefix = `devagent-ts ${APP_VERSION}`;
  const missionPrefix = state.mission.goal ? "  │ Mission: " : "";
  const rightText = `MODE: ${modeLabel}   MODEL: ${modelName}   ${clock}`;

  const missionBudget = Math.max(0, width - leftPrefix.length - missionPrefix.length - rightText.length - 2);
  const mission = state.mission.goal && missionBudget > 0 ? truncate(state.mission.goal, missionBudget) : "";

  return (
    <Box width={width} height={1}>
      <Text bold color="cyan">
        devagent-ts
      </Text>
      <Text color="gray" dimColor>
        {" "}
        {APP_VERSION}
      </Text>
      {mission && (
        <>
          <Text color="gray">{"  │ "}</Text>
          <Text color="gray">Mission: </Text>
          <Text color="green">{mission}</Text>
        </>
      )}
      <Spacer />
      <Text color="gray">MODE: </Text>
      <Text bold color="magenta">
        {modeLabel}
      </Text>
      <Text color="gray">{"   MODEL: "}</Text>
      <Text color="blue">{modelName}</Text>
      <Text color="gray">{"   "}</Text>
      <Text color="gray" dimColor>
        {clock}
      </Text>
    </Box>
  );
}
