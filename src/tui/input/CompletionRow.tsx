import React from "react";
import { Box, Text } from "ink";
import { CompletionItem } from "../../interaction/completion.js";

export interface CompletionRowProps {
  item: CompletionItem;
  selected: boolean;
  width: number;
}

/**
 * A single row in the CompletionSurface. Layout:
 *   "› /command      description                 Category"
 * The gutter shows › for the selected row, space otherwise.
 */
export function CompletionRow({ item, selected, width }: CompletionRowProps): React.JSX.Element {
  const GUTTER = 2; // "› " or "  "
  const LABEL_COL = 20; // fixed label column
  const GROUP_COL = item.group ? 16 : 0; // right-aligned category column
  const detailSpace = Math.max(0, width - GUTTER - LABEL_COL - GROUP_COL - 2);

  return (
    <Box height={1}>
      <Box width={GUTTER}>
        <Text color={selected ? "cyan" : undefined}>{selected ? "› " : "  "}</Text>
      </Box>
      <Box width={LABEL_COL}>
        <Text bold={selected} color={selected ? "cyan" : undefined} wrap="truncate">
          {item.label}
        </Text>
      </Box>
      {detailSpace > 0 && (
        <Box width={detailSpace}>
          <Text color={selected ? "white" : "gray"} wrap="truncate">
            {item.detail}
          </Text>
        </Box>
      )}
      {item.group && GROUP_COL > 0 && (
        <Box width={GROUP_COL} justifyContent="flex-end">
          <Text color="gray" dimColor wrap="truncate">
            {item.group}
          </Text>
        </Box>
      )}
    </Box>
  );
}
