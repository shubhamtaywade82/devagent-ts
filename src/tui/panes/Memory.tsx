import React from "react";
import { Box, Text } from "ink";

export interface MemoryProps {
  summary: string;
  filesTouched: string[];
}

export function Memory({ summary, filesTouched }: MemoryProps): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="single">
      <Text bold color="cyan">
        MEMORY
      </Text>
      <Text>{summary || "No summary yet"}</Text>
      {filesTouched.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Files:</Text>
          {filesTouched.map((f) => (
            <Text key={f}>• {f}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
