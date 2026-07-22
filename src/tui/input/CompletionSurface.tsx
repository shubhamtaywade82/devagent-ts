import React from "react";
import { Box, Text } from "ink";
import { CompletionItem } from "../../interaction/completion.js";
import { visibleWindow } from "../../interaction/picker.js";
import { MAX_COMPLETION_ROWS } from "../../layout/density.js";
import { CompletionRow } from "./CompletionRow.js";

export interface CompletionSurfaceProps {
  items: CompletionItem[];
  selectedIndex: number;
  width: number;
  maxVisible?: number;
}

/**
 * Vertically-stacked completion list rendered directly above PromptBar.
 * Reuses the picker's `visibleWindow` for scroll positioning and caps
 * visible rows at MAX_COMPLETION_ROWS to prevent layout instability.
 *
 * Returns null when there are no items — the parent's conditional render
 * should already guard this, but the component is defensive.
 */
export function CompletionSurface({
  items,
  selectedIndex,
  width,
  maxVisible = MAX_COMPLETION_ROWS,
}: CompletionSurfaceProps): React.JSX.Element | null {
  if (items.length === 0) return null;

  const clamped = Math.max(0, Math.min(selectedIndex, items.length - 1));
  const { start, items: visible } = visibleWindow(items, clamped, maxVisible);
  const showCounter = items.length > maxVisible;

  return (
    <Box flexDirection="column">
      {visible.map((item, i) => {
        const absoluteIdx = start + i;
        const selected = absoluteIdx === clamped;
        return <CompletionRow key={item.insert} item={item} selected={selected} width={width} />;
      })}
      {showCounter && (
        <Box justifyContent="flex-end" width={width}>
          <Text color="gray" dimColor>
            {`${clamped + 1} / ${items.length}`}
          </Text>
        </Box>
      )}
    </Box>
  );
}
