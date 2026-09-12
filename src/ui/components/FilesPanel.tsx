import React from "react";
import { Box, Text } from "ink";
import { GitFileChange } from "../../runtime/types.js";

export interface FilesPanelProps {
  files: GitFileChange[];
  width: number;
  rows: number;
}

const STATUS_LETTER: Record<GitFileChange["status"], { letter: string; color: string }> = {
  modified: { letter: "M", color: "yellow" },
  added: { letter: "A", color: "green" },
  deleted: { letter: "D", color: "red" },
  renamed: { letter: "R", color: "cyan" },
};

/** Right-column Files panel content: renders state.git.files directly, no new state. Title/border chrome comes from the shared Panel wrapper. */
export function FilesPanel({ files, width, rows }: FilesPanelProps): React.JSX.Element {
  const maxVisible = Math.max(0, rows - 1);
  const visible = files.slice(0, maxVisible);
  const remaining = files.length - visible.length;

  return (
    <Box flexDirection="column" width={width} height={rows}>
      {files.length === 0 ? (
        <Box height={rows} justifyContent="center" alignItems="center">
          <Text color="gray" dimColor>
            Working tree clean
          </Text>
        </Box>
      ) : (
        visible.map((f) => {
          const s = STATUS_LETTER[f.status];
          return (
            <Box key={f.path} height={1}>
              <Text color={s.color} bold>
                {s.letter}{" "}
              </Text>
              <Text wrap="truncate">{f.path}</Text>
            </Box>
          );
        })
      )}
      {remaining > 0 && (
        <Box height={1}>
          <Text color="gray" dimColor>
            ... and {remaining} more
          </Text>
        </Box>
      )}
    </Box>
  );
}
