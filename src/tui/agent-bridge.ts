import { TuiAction } from "./state";

export interface BridgeableAgent {
  on<E extends string>(event: E, handler: (...args: any[]) => void): unknown;
}

export function wireAgentBridge(agent: BridgeableAgent, dispatch: (action: TuiAction) => void): void {
  agent.on("onAssistantText", (chunk: string) => dispatch({ type: "ASSISTANT_TEXT_CHUNK", chunk }));
  agent.on("onThinking", (chunk: string) => dispatch({ type: "THINKING_CHUNK", chunk }));
  agent.on("onToolCall", (name: string, args: Record<string, unknown>) =>
    dispatch({ type: "TOOL_CALLED", name, args }),
  );
  agent.on("onToolResult", (name: string, result: Record<string, unknown>) =>
    dispatch({ type: "TOOL_RESULT", name, result }),
  );
  agent.on("onStatus", (status: string) => dispatch({ type: "STATUS_CHANGED", status }));
  agent.on("onError", (error: Error) => dispatch({ type: "ERROR", message: error.message }));
  agent.on("onShellOutput", (stream: "stdout" | "stderr", chunk: string) =>
    dispatch({ type: "SHELL_OUTPUT_CHUNK", stream, chunk }),
  );
}
