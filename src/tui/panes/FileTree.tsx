import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { ListDirectoryTool } from "../../tools/directory-tools";

interface Entry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface FileTreeProps {
  root: string;
  onSelect: (path: string) => void;
  focused: boolean;
}

export function FileTree({ root, onSelect: _onSelect, focused }: FileTreeProps): JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const tool = new ListDirectoryTool(root);
    tool.call({ path: "." }).then((result) => {
      if (!cancelled) setEntries((result.entries as Entry[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

  return (
    <Box flexDirection="column" borderStyle={focused ? "double" : "single"}>
      <Text bold color="cyan">
        PROJECT
      </Text>
      {entries.map((entry, i) => (
        <Text key={entry.path} inverse={focused && i === cursor} color={entry.type === "directory" ? "blue" : undefined}>
          {entry.type === "directory" ? "▸ " : "  "}
          {entry.name}
        </Text>
      ))}
    </Box>
  );
}
