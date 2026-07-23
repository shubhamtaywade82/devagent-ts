import React from "react";
import { Box, Text } from "ink";

/** CAPS section title + content — no box borders; separation comes from the column dividers and section rules. */
export function Section({ title, width, rows, children }: { title: string; width: number; rows: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box flexDirection="column" width={width} height={rows}>
      <Box height={1}>
        <Text bold color="cyan">
          {title.toUpperCase()}
        </Text>
      </Box>
      <Box flexDirection="column" width={width} height={Math.max(0, rows - 1)}>
        {children}
      </Box>
    </Box>
  );
}

/** Horizontal rule between stacked sections within a column. */
export function Rule({ width }: { width: number }): React.JSX.Element {
  return (
    <Box height={1}>
      <Text color="gray" dimColor>
        {"─".repeat(Math.max(1, width))}
      </Text>
    </Box>
  );
}

/** Full-height vertical divider between columns. */
export function VDivider({ rows }: { rows: number }): React.JSX.Element {
  return (
    <Box flexDirection="column" width={1} height={rows}>
      {Array.from({ length: rows }, (_, i) => (
        <Text key={i} color="gray" dimColor>
          │
        </Text>
      ))}
    </Box>
  );
}
