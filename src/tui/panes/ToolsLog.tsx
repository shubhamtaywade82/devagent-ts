import React from "react";
import { Box, Text } from "ink";
import { ToolLogEntry } from "../state";

export interface ToolsLogProps {
  entries: ToolLogEntry[];
  focused: boolean;
}

export function ToolsLog({ entries, focused }: ToolsLogProps): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle={focused ? "double" : "single"}>
      <Text bold color="cyan">
        TOOLS
      </Text>
      {entries.map((entry, i) => (
        <Text key={i} color={entry.result ? "green" : "yellow"}>
          {entry.result ? "✓" : "…"} {entry.name}
        </Text>
      ))}
    </Box>
  );
}
