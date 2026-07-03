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

export function FileTree({ root, onSelect, focused }: FileTreeProps): JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const tool = new ListDirectoryTool(root);
    tool.call({ path: "." }).then((result) => {
      setEntries((result.entries as Entry[]) ?? []);
    });
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
