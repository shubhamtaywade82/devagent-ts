import React from "react";
import { Box, Text } from "ink";

export interface PromptBarProps {
  text: string;
  ghost: string;
  width: number;
  busy: boolean;
}

/** The single command input. Ghost text renders gray after the caret. */
export function PromptBar({ text, ghost, width, busy }: PromptBarProps): JSX.Element {
  const promptGlyph = busy ? "◌" : "❯";
  const available = Math.max(1, width - 2);
  const visibleText = text.length > available ? text.slice(text.length - available) : text;
  const ghostRoom = available - visibleText.length - 1;
  const visibleGhost = ghostRoom > 0 ? ghost.slice(0, ghostRoom) : "";
  return (
    <Box height={1}>
      <Text color={busy ? "magenta" : "green"} bold>
        {promptGlyph}{" "}
      </Text>
      <Text wrap="truncate">
        {visibleText}
        <Text inverse> </Text>
        <Text color="gray">{visibleGhost}</Text>
      </Text>
    </Box>
  );
}
