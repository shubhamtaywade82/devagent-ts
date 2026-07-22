import React from "react";
import { Box, Text } from "ink";
import { LspServerState } from "../../runtime/types.js";

export interface DiagnosticsPanelProps {
  lspServers: LspServerState[];
  width: number;
  rows: number;
}

function Row({ label, value, color, width }: { label: string; value: string; color?: string; width: number }): React.JSX.Element {
  const gap = Math.max(1, width - label.length - value.length);
  return (
    <Box height={1}>
      <Text color={color}>{label}</Text>
      <Text>{" ".repeat(gap)}</Text>
      <Text color={color}>{value}</Text>
    </Box>
  );
}

/**
 * Right-column Diagnostics panel content. Errors are a real aggregate of
 * lspServers[].errorCount. Warnings/Infos have no existing signal anywhere
 * in RuntimeState — rendered as "—" (unknown), never a fabricated 0.
 * Title/border chrome comes from the shared Panel wrapper.
 */
export function DiagnosticsPanel({ lspServers, width, rows }: DiagnosticsPanelProps): React.JSX.Element {
  const errors = lspServers.reduce((sum, s) => sum + s.errorCount, 0);

  return (
    <Box flexDirection="column" width={width} height={rows}>
      <Row label="Errors" value={String(errors)} color={errors > 0 ? "red" : "green"} width={width} />
      <Row label="Warnings" value="—" color="gray" width={width} />
      <Row label="Infos" value="—" color="gray" width={width} />
    </Box>
  );
}
