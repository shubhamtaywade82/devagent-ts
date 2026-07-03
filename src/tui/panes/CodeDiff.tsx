import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import { DiffLine } from "../edit-tracker";

export interface CodeDiffProps {
  path: string | null;
  content: string;
  diffLines: DiffLine[] | null;
  focused: boolean;
}

function safeHighlight(code: string): string {
  try {
    return highlight(code, { ignoreIllegals: true });
  } catch {
    return code;
  }
}

export function CodeDiff({ path, content, diffLines, focused }: CodeDiffProps): JSX.Element {
  if (!path) {
    return (
      <Box borderStyle={focused ? "double" : "single"}>
        <Text dimColor>No file selected</Text>
      </Box>
    );
  }

  if (!diffLines) {
    return (
      <Box flexDirection="column" borderStyle={focused ? "double" : "single"}>
        <Text bold color="cyan">
          {path}
        </Text>
        <Text>{safeHighlight(content)}</Text>
      </Box>
    );
  }

  const added = diffLines.filter((l) => l.type === "add").reduce((n, l) => n + l.text.split("\n").length - 1, 0);
  const removed = diffLines.filter((l) => l.type === "remove").reduce((n, l) => n + l.text.split("\n").length - 1, 0);

  return (
    <Box flexDirection="column" borderStyle={focused ? "double" : "single"}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          {path}
        </Text>
        <Text>
          <Text color="green">+{added}</Text> <Text color="red">-{removed}</Text>
        </Text>
      </Box>
      {diffLines.map((line, i) => {
        const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
        const color = line.type === "add" ? "green" : line.type === "remove" ? "red" : undefined;
        return (
          <Text key={i} color={color}>
            {prefix} {safeHighlight(line.text.replace(/\n$/, ""))}
          </Text>
        );
      })}
    </Box>
  );
}
