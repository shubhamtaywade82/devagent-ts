import React from "react";
import { Box, Text } from "ink";

export interface TerminalProps {
  output: { stream: "stdout" | "stderr"; chunk: string }[];
  focused: boolean;
}

export function Terminal({ output, focused }: TerminalProps): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle={focused ? "double" : "single"}>
      <Text bold color="cyan">
        TERMINAL
      </Text>
      {output.map((entry, i) => (
        <Text key={i} color={entry.stream === "stderr" ? "yellow" : undefined}>
          {entry.chunk.replace(/\n$/, "")}
        </Text>
      ))}
    </Box>
  );
}
