import React from "react";
import { Box, Text } from "ink";
import { StatusChip } from "./StatusChip.js";

interface CollapsibleSectionProps {
  title: string;
  status: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  width: number;
}

export function CollapsibleSection({ title, status, collapsed, children }: CollapsibleSectionProps): JSX.Element {
  const header = (
    <Box>
      <Text>
        <StatusChip status={status} />
        {" "}
        <Text bold>{title}</Text>
        <Text color="gray">{collapsed ? " ▸" : " ▾"}</Text>
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
