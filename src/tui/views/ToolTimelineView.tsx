import React from "react";
import { Box, Text } from "ink";
import { ViewProps } from "./ConversationView";

export function ToolTimelineView({ state, width, rows }: ViewProps): JSX.Element {
  const { toolCalls } = state;
  const maxRows = Math.max(1, rows - 2);
  const visible = toolCalls.slice(-maxRows);

  if (visible.length === 0) {
    return (
      <Box flexDirection="column" height={rows}>
        <Text color="gray">No tool calls yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows}>
      <Box height={1} marginBottom={1}>
        <Text bold>Tool Timeline</Text>
      </Box>
      {visible.map((call) => {
        const time = new Date(call.startedAt);
        const timeStr = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}`;
        const glyphColor =
          call.status === "completed" ? "green" : call.status === "failed" ? "red" : "blue";
        const glyph = call.status === "completed" ? "✓" : call.status === "failed" ? "✗" : "▶";
        const duration = call.endedAt ? `${((call.endedAt - call.startedAt) / 1000).toFixed(1)}s` : "";
        return (
          <Box key={call.id} height={1}>
            <Text>
              <Text color="gray">[{timeStr}] </Text>
              <Text color={glyphColor}>{glyph}</Text>
              {" "}
              <Text bold>{call.name}</Text>
              {duration && <Text color="gray"> ({duration})</Text>}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
