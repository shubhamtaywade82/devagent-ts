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

  // Left column: Mission (majority) + Tools (fixed-ish), each panel's outer
  // height includes Panel's own border(2)+title(1) overhead.
  const toolsOuter = Math.min(12, Math.max(6, Math.floor(rows * 0.3)));
  const missionOuter = Math.max(6, rows - GAP - toolsOuter);

  // Center column: Activity Feed (majority) + pinned Diff Preview.
  const diffOuter = Math.min(16, Math.max(6, Math.floor(rows * 0.32)));
  const feedOuter = Math.max(6, rows - GAP - diffOuter);

  // Right column: Context + Files + Diagnostics, stacked.
  const contextOuter = Math.min(13, rows);
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
