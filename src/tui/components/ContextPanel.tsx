import React from "react";
import { Box, Text } from "ink";
import { GitState, ProjectInfo, SessionState } from "../../runtime/types.js";

export interface ContextPanelProps {
  session: SessionState;
  git: GitState;
  project?: ProjectInfo;
  width: number;
  rows: number;
  now?: number;
}

function Field({ icon, label, value, width }: { icon: string; label: string; value: string; width: number }): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Text color="gray" dimColor>
          {icon} {label}
        </Text>
      </Box>
      <Box height={1} paddingLeft={2}>
        <Text wrap="truncate">{value.length > width - 2 ? value.slice(0, width - 3) + "…" : value}</Text>
      </Box>
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
  if (project?.testFramework) fields.push({ icon: "✓", label: "Test Framework", value: project.testFramework });
  fields.push({ icon: "🕐", label: "Last Updated", value: new Date(now).toLocaleTimeString() });

  const visible = fields.slice(0, Math.max(0, Math.floor(rows / 2)));

  return (
    <Box flexDirection="column" width={width} height={rows}>
      {visible.map((f) => (
        <Field key={f.label} icon={f.icon} label={f.label} value={f.value} width={width} />
      ))}
    </Box>
  );
}
