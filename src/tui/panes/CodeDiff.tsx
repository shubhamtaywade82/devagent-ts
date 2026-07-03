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

/**
 * Splits a DiffLine's `text` into individual source lines. A trailing "\n"
 * is treated as a line terminator (not a line of its own), so "a\nb\n"
 * yields ["a", "b"]. Text with no trailing newline still yields its final
 * line, so "onlyline" yields ["onlyline"]. Interior blank lines are
 * preserved, so "a\n\nb\n" yields ["a", "", "b"].
 */
function splitDiffTextIntoLines(text: string): string[] {
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n");
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

  const added = diffLines
    .filter((l) => l.type === "add")
    .reduce((n, l) => n + splitDiffTextIntoLines(l.text).length, 0);
  const removed = diffLines
    .filter((l) => l.type === "remove")
    .reduce((n, l) => n + splitDiffTextIntoLines(l.text).length, 0);

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
      {diffLines.flatMap((line, i) => {
        const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
        const color = line.type === "add" ? "green" : line.type === "remove" ? "red" : undefined;
        return splitDiffTextIntoLines(line.text).map((sourceLine, j) => (
          <Text key={`${i}-${j}`} color={color}>
            {prefix} {safeHighlight(sourceLine)}
          </Text>
        ));
      })}
    </Box>
  );
}
