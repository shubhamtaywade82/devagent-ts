import React, { useEffect, useReducer, useState } from "react";
import { Box, useInput } from "ink";
import { reducer, initialState, TuiState } from "./state";
import { wireAgentBridge, BridgeableAgent } from "./agent-bridge";
import { EditTracker } from "./edit-tracker";
import { ErrorBoundary } from "./ErrorBoundary";
import { FileTree } from "./panes/FileTree";
import { ChatPlan } from "./panes/ChatPlan";
import { CodeDiff } from "./panes/CodeDiff";
import { Terminal } from "./panes/Terminal";
import { ToolsLog } from "./panes/ToolsLog";
import { Memory } from "./panes/Memory";
import { StatusBar } from "./panes/StatusBar";

export type AppAgent = BridgeableAgent & {
  runUserMessage(message: string): Promise<string>;
  getRegistry(): unknown;
};

export interface AppProps {
  agent: AppAgent;
  workspaceRoot: string;
  model: string;
}

const FOCUS_ORDER: TuiState["focusedPane"][] = ["fileTree", "chat", "codeDiff", "terminal", "toolsLog", "memory"];

export function App({ agent, workspaceRoot, model }: AppProps): JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [selectedFileContent] = useState("");
  const [editTracker] = useState(() => new EditTracker());

  useEffect(() => {
    wireAgentBridge(agent, dispatch);
  }, [agent]);

  useInput((_input, key) => {
    if (key.tab) {
      const idx = FOCUS_ORDER.indexOf(state.focusedPane);
      const next = FOCUS_ORDER[(idx + (key.shift ? FOCUS_ORDER.length - 1 : 1)) % FOCUS_ORDER.length];
      dispatch({ type: "FOCUS_PANE", pane: next });
    }
    // Ctrl+Enter send is handled inside ChatPlan's own input box in a future iteration;
    // v1 focus-cycling and pane selection is delivered here per this task's scope.
  });

  const diffLines = state.selectedFile && editTracker.hasSnapshot(state.selectedFile)
    ? editTracker.diff(state.selectedFile, selectedFileContent)
    : null;

  return (
    <Box flexDirection="column">
      <ErrorBoundary>
        <Box flexDirection="row">
          <Box flexDirection="column" width={30}>
            <FileTree root={workspaceRoot} onSelect={(path) => dispatch({ type: "FILE_SELECTED", path })} focused={state.focusedPane === "fileTree"} />
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <ChatPlan chat={state.chat} planSteps={state.planSteps} focused={state.focusedPane === "chat"} />
            <Terminal output={state.shellOutput} focused={state.focusedPane === "terminal"} />
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <CodeDiff path={state.selectedFile} content={selectedFileContent} diffLines={diffLines} focused={state.focusedPane === "codeDiff"} />
            <ToolsLog entries={state.toolLog} focused={state.focusedPane === "toolsLog"} />
            <Memory summary={state.memorySummary} filesTouched={state.filesTouched} />
          </Box>
        </Box>
      </ErrorBoundary>
      <StatusBar focusedPane={state.focusedPane} model={model} filesTouchedCount={state.filesTouched.length} status={state.status} />
    </Box>
  );
}
