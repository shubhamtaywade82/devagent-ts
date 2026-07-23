import React from "react";
import { Box, Text } from "ink";
import { ConversationView, ViewProps } from "./ConversationView.js";
import { Panel } from "../components/Panel.js";
import { MissionPanel } from "../components/MissionPanel.js";
import { ToolsPanel } from "../components/ToolsPanel.js";
import { ActivityFeedPanel } from "../components/ActivityFeedPanel.js";
import { PinnedDiffPanel } from "../components/PinnedDiffPanel.js";
import { ContextPanel } from "../components/ContextPanel.js";
import { FilesPanel } from "../components/FilesPanel.js";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel.js";

/** Three readable bordered columns need more room than the single 24-col classic Sidebar (MIN_WIDTH_FOR_SIDEBAR = 90 in App.tsx). */
export const MIN_WIDTH_FOR_DASHBOARD = 130;

const SIDE_WIDTH = 30;
const GAP = 1;

/** Three readable columns need more room than the single 24-col classic Sidebar (MIN_WIDTH_FOR_SIDEBAR = 90 in App.tsx). Below it, falls back to the plain Conversation view — narrow terminals already reach the same data via /git, /tasks, etc. */
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

  const centerWidth = Math.max(20, width - SIDE_WIDTH * 2 - GAP * 2);

  // Content-driven heights: fixed-size panels get exactly what their content
  // needs (+3 for Panel's border(2)+title(1) chrome); each column's one
  // naturally-growing panel absorbs the remainder so columns always fill
  // `rows` exactly — an idle dashboard shows compact panels, not voids.

  // Left column: Mission sized to goal(1) + 8 phases + live substeps
  // (Execute running only, capped); Tools absorbs the rest — it's the list
  // that actually grows over a session.
  const executeRunning = state.mission.phases.find((p) => p.id === "execute")?.status === "running";
  const substepRows = executeRunning ? Math.min(state.mission.steps.length, 6) : 0;
  const missionContent = state.mission.goal ? 1 + state.mission.phases.length + substepRows : 2; // no goal → 2-line centered hint
  const missionOuter = Math.min(missionContent + 3, Math.max(6, rows - GAP - 6));
  const toolsOuter = Math.max(6, rows - GAP - missionOuter);

  // Center column: Diff Preview only reserves real space when a diff exists;
  // idle it collapses to a title + one-line empty state.
  const hasDiff = state.conversation.some((e) => e.kind === "diff_preview");
  const diffOuter = hasDiff ? Math.min(16, Math.max(6, Math.floor(rows * 0.32))) : 4;
  const feedOuter = Math.max(6, rows - GAP - diffOuter);

  // Right column: Context sized to its field count (1 line each, see
  // ContextPanel), Diagnostics fixed at its 3 rows, Files absorbs the middle.
  const contextFields = 3 + (state.project?.language ? 1 : 0) + (state.project?.framework ? 1 : 0) + (state.project?.testFramework ? 1 : 0);
  const contextOuter = Math.min(contextFields + 3, rows);
  const diagOuter = Math.min(6, Math.max(0, rows - contextOuter - GAP * 2));
  const filesOuter = Math.max(0, rows - contextOuter - diagOuter - GAP * 2);

  return (
    <Box flexDirection="row" width={width} height={rows} columnGap={GAP}>
      <Box flexDirection="column" width={SIDE_WIDTH} height={rows} rowGap={GAP}>
        <Panel title="Mission" width={SIDE_WIDTH} height={missionOuter}>
          <MissionPanel mission={state.mission} width={SIDE_WIDTH - 2} rows={missionOuter - 3} />
        </Panel>
        <Panel title="Tools" width={SIDE_WIDTH} height={toolsOuter}>
          <ToolsPanel toolCalls={state.toolCalls} width={SIDE_WIDTH - 2} rows={toolsOuter - 3} />
        </Panel>
      </Box>
      <Box flexDirection="column" width={centerWidth} height={rows} rowGap={GAP}>
        <Panel title="Activity Feed" width={centerWidth} height={feedOuter}>
          <ActivityFeedPanel state={state} width={centerWidth - 2} rows={feedOuter - 3} />
        </Panel>
        <Panel title="Diff Preview" width={centerWidth} height={diffOuter}>
          <PinnedDiffPanel conversation={state.conversation} width={centerWidth - 2} rows={diffOuter - 3} />
        </Panel>
      </Box>
      <Box flexDirection="column" width={SIDE_WIDTH} height={rows} rowGap={GAP}>
        <Panel title="Context" width={SIDE_WIDTH} height={contextOuter}>
          <ContextPanel session={state.session} git={state.git} project={state.project} width={SIDE_WIDTH - 2} rows={contextOuter - 3} />
        </Panel>
        {filesOuter > 3 && (
          <Panel title={`Files (${state.git.files.length} changed)`} width={SIDE_WIDTH} height={filesOuter}>
            <FilesPanel files={state.git.files} width={SIDE_WIDTH - 2} rows={filesOuter - 3} />
          </Panel>
        )}
        {diagOuter > 3 && (
          <Panel title="Diagnostics" width={SIDE_WIDTH} height={diagOuter}>
            <DiagnosticsPanel lspServers={state.lspServers} width={SIDE_WIDTH - 2} rows={diagOuter - 3} />
          </Panel>
        )}
      </Box>
    </Box>
  );
}
