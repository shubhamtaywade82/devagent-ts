import React from "react";
import { Box, Text } from "ink";
import { GitState, ProjectInfo, SessionState } from "../../runtime/types.js";
import { truncate } from "../../layout/truncate.js";

export interface ContextPanelProps {
  session: SessionState;
  git: GitState;
  project?: ProjectInfo;
  width: number;
  rows: number;
  now?: number;
}

/** One line per field: dim icon+label left, value right-aligned — same gap-padding pattern as DiagnosticsPanel's Row. */
function Field({ icon, label, value, width }: { icon: string; label: string; value: string; width: number }): React.JSX.Element {
  const left = `${icon} ${label}`;
  // Emoji icons render 2 cells wide but count as 1 string char — the -1
  // keeps the right-aligned values from spilling past the panel edge.
  const valueBudget = Math.max(4, width - left.length - 2);
  const shown = truncate(value, valueBudget);
  const gap = Math.max(1, width - left.length - shown.length - 1);
  return (
    <Box height={1}>
      <Text color="gray" dimColor>
        {left}
      </Text>
      <Text>{" ".repeat(gap)}</Text>
      <Text wrap="truncate">{shown}</Text>
    </Box>
  );
}

/** Right-column Context panel content: Workspace/Branch always known; Language/Framework/Test Framework from a one-time static sniff (project-info.ts), omitted when undetected. Title/border chrome comes from the shared Panel wrapper. */
export function ContextPanel({ session, git, project, width, rows, now = Date.now() }: ContextPanelProps): React.JSX.Element {
  const fields: Array<{ icon: string; label: string; value: string }> = [
    { icon: "📁", label: "Workspace", value: session.workspace || "-" },
    { icon: "⎇", label: "Branch", value: git.branch || session.branch || "-" },
  ];
  if (project?.language) fields.push({ icon: "◆", label: "Language", value: project.language });
  if (project?.framework) fields.push({ icon: "⚙", label: "Framework", value: project.framework });
  if (project?.testFramework) fields.push({ icon: "✓", label: "Tests", value: project.testFramework });
  // 24h HH:MM:SS — matches the Header clock's format, not locale-dependent.
  const d = new Date(now);
  const hhmmss = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  fields.push({ icon: "🕐", label: "Updated", value: hhmmss });

  const visible = fields.slice(0, Math.max(0, rows));

  return (
    <Box flexDirection="column" width={width} height={rows}>
      {visible.map((f) => (
        <Field key={f.label} icon={f.icon} label={f.label} value={f.value} width={width} />
      ))}
    </Box>
  );
}
