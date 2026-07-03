import React from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  focusedPane: string;
  model: string;
  filesTouchedCount: number;
  status: string;
}

export function StatusBar({ focusedPane, model, filesTouchedCount, status }: StatusBarProps): JSX.Element {
  return (
    <Box justifyContent="space-between">
      <Text>
        focus: {focusedPane} | {status}
      </Text>
      <Text>
        {filesTouchedCount} files changed | {model}
      </Text>
    </Box>
  );
}
