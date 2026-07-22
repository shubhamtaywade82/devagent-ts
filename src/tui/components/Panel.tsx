import React from "react";
import { Box, Text } from "ink";

export interface PanelProps {
  title: string;
  width: number;
  height: number;
  titleColor?: string;
  children: React.ReactNode;
}

/** Shared bordered-box + CAPS title chrome for every Dashboard panel. Border consumes 2 cols/2 rows, title 1 row — content components receive width-2/height-3 so their own truncation math stays correct. */
export function Panel({ title, width, height, titleColor = "cyan", children }: PanelProps): React.JSX.Element {
  const innerWidth = Math.max(1, width - 2);
  const innerRows = Math.max(1, height - 3);
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="round" borderDimColor>
      <Box height={1} width={innerWidth}>
        <Text bold color={titleColor}>
          {title.toUpperCase()}
        </Text>
      </Box>
      <Box flexDirection="column" width={innerWidth} height={innerRows}>
        {children}
      </Box>
    </Box>
  );
}
