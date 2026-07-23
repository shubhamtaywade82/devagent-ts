import React from "react";
import { Box, Text } from "ink";
import { ConversationView, ViewProps } from "./ConversationView.js";
import { MissionPanel } from "../components/MissionPanel.js";
import { ToolsPanel } from "../components/ToolsPanel.js";
import { PinnedDiffPanel } from "../components/PinnedDiffPanel.js";
import { ContextPanel } from "../components/ContextPanel.js";
import { FilesPanel } from "../components/FilesPanel.js";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel.js";

/** Three readable columns need more room than the single 24-col classic Sidebar (MIN_WIDTH_FOR_SIDEBAR = 90 in App.tsx). */
export const MIN_WIDTH_FOR_DASHBOARD = 130;

const SIDE_WIDTH = 30;
const GAP = 1; // one blank column either side of each vertical divider

/** CAPS section title + content — no box borders; separation comes from the column dividers and section rules. */
function Section({ title, width, rows, children }: { title: string; width: number; rows: number; children: React.ReactNode }): React.JSX.Element {
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
function Rule({ width }: { width: number }): React.JSX.Element {
  return (
    <Box height={1}>
      <Text color="gray" dimColor>
        {"─".repeat(Math.max(1, width))}
      </Text>
    </Box>
  );
}

/** Full-height vertical divider between columns. */
function VDivider({ rows }: { rows: number }): React.JSX.Element {
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

/** Below MIN_WIDTH_FOR_DASHBOARD, falls back to the plain Conversation view — narrow terminals already reach the same data via /git, /tasks, etc. */
export function DashboardView({ state, width, rows, detail }: ViewProps): React.JSX.Element {
  if (width < MIN_WIDTH_FOR_DASHBOARD) {
    return (
      <Box flexDirection="column" width={width} height={rows}>
        <Box height={1}>
          <Text color="yellow" dimColor>
            Resize to ≥{MIN_WIDTH_FOR_DASHBOARD} cols for the full dashboard.
          </Text>
        </Box>
        <ConversationView state={state} width={width} rows={Math.max(1, rows - 1)} detail={detail} />
      </Box>
    );
  }

  const centerWidth = Math.max(20, width - SIDE_WIDTH * 2 - (1 + GAP * 2) * 2);

  // Content-driven heights: fixed-size sections get exactly their content
  // (+1 title row); each column's one naturally-growing section absorbs the
  // remainder so columns fill `rows` exactly. Stacked sections cost one
  // extra row each for the rule between them.

  // Left column: Mission sized to goal(1) + phases + live substeps; Tools
  // absorbs the rest — it's the list that actually grows over a session.
  const executeRunning = state.mission.phases.find((p) => p.id === "execute")?.status === "running";
  const substepRows = executeRunning ? Math.min(state.mission.steps.length, 6) : 0;
  const missionContent = state.mission.goal ? 1 + state.mission.phases.length + substepRows : 2; // no goal → 2-line centered hint
  const missionSection = Math.min(missionContent + 1, Math.max(4, rows - 1 - 4));
  const toolsSection = Math.max(4, rows - 1 - missionSection);

  // Center column: Diff Preview only reserves real space when a diff exists;
  // idle it collapses to a title + one-line empty state.
  const hasDiff = state.conversation.some((e) => e.kind === "diff_preview");
  const diffSection = hasDiff ? Math.min(14, Math.max(5, Math.floor(rows * 0.3))) : 2;
  const feedSection = Math.max(4, rows - 1 - diffSection);

  // Right column: Context sized to its field count (1 line each, see
  // ContextPanel), Diagnostics fixed at its 3 rows, Files absorbs the middle.
  const contextFields = 3 + (state.project?.language ? 1 : 0) + (state.project?.framework ? 1 : 0) + (state.project?.testFramework ? 1 : 0);
  const contextSection = Math.min(contextFields + 1, rows);
  const diagSection = Math.min(4, Math.max(0, rows - contextSection - 2));
  const filesSection = Math.max(0, rows - contextSection - diagSection - 2);

  return (
    <Box flexDirection="row" width={width} height={rows} columnGap={GAP}>
      <Box flexDirection="column" width={SIDE_WIDTH} height={rows}>
        <Section title="Mission" width={SIDE_WIDTH} rows={missionSection}>
          <MissionPanel mission={state.mission} width={SIDE_WIDTH} rows={missionSection - 1} />
        </Section>
        <Rule width={SIDE_WIDTH} />
        <Section title="Tools" width={SIDE_WIDTH} rows={toolsSection}>
          <ToolsPanel toolCalls={state.toolCalls} width={SIDE_WIDTH} rows={toolsSection - 1} />
        </Section>
      </Box>
      <VDivider rows={rows} />
      <Box flexDirection="column" width={centerWidth} height={rows}>
        <Section title="Activity Feed" width={centerWidth} rows={feedSection}>
          {/* ConversationView verbatim — the feed renders exactly like the
              Conversation view (same markdown/tool/diff formatting, same
              PageUp/PageDown + wheel scrolling), just inside a section. */}
          <ConversationView state={state} width={centerWidth} rows={feedSection - 1} detail={detail} />
        </Section>
        <Rule width={centerWidth} />
        <Section title="Diff Preview" width={centerWidth} rows={diffSection}>
          <PinnedDiffPanel conversation={state.conversation} width={centerWidth} rows={diffSection - 1} />
        </Section>
      </Box>
      <VDivider rows={rows} />
      <Box flexDirection="column" width={SIDE_WIDTH} height={rows}>
        <Section title="Context" width={SIDE_WIDTH} rows={contextSection}>
          <ContextPanel session={state.session} git={state.git} project={state.project} width={SIDE_WIDTH} rows={contextSection - 1} />
        </Section>
        {filesSection > 1 && (
          <>
            <Rule width={SIDE_WIDTH} />
            <Section title={`Files (${state.git.files.length} changed)`} width={SIDE_WIDTH} rows={filesSection}>
              <FilesPanel files={state.git.files} width={SIDE_WIDTH} rows={filesSection - 1} />
            </Section>
          </>
        )}
        {diagSection > 1 && (
          <>
            <Rule width={SIDE_WIDTH} />
            <Section title="Diagnostics" width={SIDE_WIDTH} rows={diagSection}>
              <DiagnosticsPanel lspServers={state.lspServers} width={SIDE_WIDTH} rows={diagSection - 1} />
            </Section>
          </>
        )}
      </Box>
    </Box>
  );
}
