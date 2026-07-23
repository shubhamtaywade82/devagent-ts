import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { ChatEntry } from "../../runtime/types.js";

export interface PinnedDiffPanelProps {
  conversation: ChatEntry[];
  width: number;
  rows: number;
}

type DiffEntry = Extract<ChatEntry, { kind: "diff_preview" }>;

function latestDiff(conversation: ChatEntry[]): DiffEntry | undefined {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const entry = conversation[i];
    if (entry.kind === "diff_preview") return entry;
  }
  return undefined;
}

/** Center-column pinned panel content: always shows the most recent file diff, unlike the collapsible copy in the Activity Feed. Title/border chrome comes from the shared Panel wrapper. */
export function PinnedDiffPanel({ conversation, width, rows }: PinnedDiffPanelProps): React.JSX.Element {
  const entry = useMemo(() => latestDiff(conversation), [conversation]);
  const bodyRows = Math.max(0, rows - 2);

  if (!entry) {
    // DashboardView collapses this panel to one content row while empty.
    return (
      <Box flexDirection="column" width={width} height={rows} justifyContent="center">
        <Text color="gray" dimColor>
          No changes yet
        </Text>
      </Box>
    );
  }

  const diffLines = entry.diff.split("\n").filter(Boolean).slice(0, bodyRows);
  const additions = diffLines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const deletions = diffLines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const stats = `+${additions} -${deletions}`;
  const gap = Math.max(1, width - entry.filePath.length - stats.length - 1);

  return (
    <Box flexDirection="column" width={width} height={rows}>
      <Box height={1}>
        <Text bold wrap="truncate">
          {entry.filePath}
        </Text>
        <Text>{" ".repeat(gap)}</Text>
        <Text color="green">+{additions} </Text>
        <Text color="red">-{deletions}</Text>
      </Box>
      {diffLines.map((line, i) => {
        let color = "white";
        if (line.startsWith("+")) color = "green";
        else if (line.startsWith("-")) color = "red";
        else if (line.startsWith("@")) color = "cyan";
        return (
          <Box key={i} height={1}>
            <Text color={color as any} wrap="truncate">
              {line}
            </Text>
          </Box>
        );
      })}
      <Box justifyContent="flex-end" width={width}>
        <Text color="gray" dimColor>
          1/1
        </Text>
      </Box>
    </Box>
  );
}
