import React from "react";
import { Box, Text } from "ink";
import { StatusChip } from "./StatusChip.js";
import { themeColors } from "../../layout/theme-map.js";

interface CollapsibleSectionProps {
  title: string;
  status: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  width: number;
}

export function CollapsibleSection({ title, status, collapsed, children }: CollapsibleSectionProps): React.JSX.Element {
  const header = (
    <Box>
      <Text>
        <StatusChip status={status} /> <Text bold>{title}</Text>
        <Text color={themeColors().mutedForeground}>{collapsed ? " ▸" : " ▾"}</Text>
      </Text>
    </Box>
  );

  return (
    <Box flexDirection="column">
      {header}
      {!collapsed && children}
    </Box>
  );
}
