import { PlanStep } from "../orchestrator/types";

export interface ChatEntry {
  role: "user" | "assistant" | "thinking";
  text: string;
}

export interface ToolLogEntry {
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  at: number;
}

export interface TuiState {
  chat: ChatEntry[];
  planSteps: PlanStep[] | null;
  toolLog: ToolLogEntry[];
  status: string;
  lastError: string | null;
  shellOutput: { stream: "stdout" | "stderr"; chunk: string }[];
  selectedFile: string | null;
  memorySummary: string;
  filesTouched: string[];
  focusedPane: "fileTree" | "chat" | "codeDiff" | "terminal" | "toolsLog" | "memory";
}

export type TuiAction =
  | { type: "ASSISTANT_TEXT_CHUNK"; chunk: string }
  | { type: "THINKING_CHUNK"; chunk: string }
  | { type: "USER_MESSAGE"; text: string }
  | { type: "TOOL_CALLED"; name: string; args: Record<string, unknown> }
  | { type: "TOOL_RESULT"; name: string; result: Record<string, unknown> }
  | { type: "STATUS_CHANGED"; status: string }
  | { type: "ERROR"; message: string }
  | { type: "SHELL_OUTPUT_CHUNK"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "PLAN_STEP_CHANGED"; step: PlanStep }
  | { type: "PLAN_STARTED"; steps: PlanStep[] }
  | { type: "FILE_SELECTED"; path: string }
  | { type: "MEMORY_SUMMARY_UPDATED"; summary: string }
  | { type: "FOCUS_PANE"; pane: TuiState["focusedPane"] };

const FILE_MUTATING_TOOLS = new Set(["write_file", "patch_file", "delete_file", "move_file"]);

export function initialState(): TuiState {
  return {
    chat: [],
    planSteps: null,
    toolLog: [],
    status: "",
    lastError: null,
    shellOutput: [],
    selectedFile: null,
    memorySummary: "",
    filesTouched: [],
    focusedPane: "chat",
  };
}

export function reducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "ASSISTANT_TEXT_CHUNK": {
      const last = state.chat[state.chat.length - 1];
      if (last && last.role === "assistant") {
        const chat = state.chat.slice(0, -1).concat({ ...last, text: last.text + action.chunk });
        return { ...state, chat };
      }
      return { ...state, chat: [...state.chat, { role: "assistant", text: action.chunk }] };
    }
    case "THINKING_CHUNK": {
      const last = state.chat[state.chat.length - 1];
      if (last && last.role === "thinking") {
        const chat = state.chat.slice(0, -1).concat({ ...last, text: last.text + action.chunk });
        return { ...state, chat };
      }
      return { ...state, chat: [...state.chat, { role: "thinking", text: action.chunk }] };
    }
    case "USER_MESSAGE":
      return { ...state, chat: [...state.chat, { role: "user", text: action.text }] };
    case "TOOL_CALLED": {
      const entry: ToolLogEntry = { name: action.name, args: action.args, at: Date.now() };
      const filesTouched =
        FILE_MUTATING_TOOLS.has(action.name) && typeof action.args.path === "string"
          ? state.filesTouched.includes(action.args.path)
            ? state.filesTouched
            : [...state.filesTouched, action.args.path]
          : state.filesTouched;
      return { ...state, toolLog: [...state.toolLog, entry], filesTouched };
    }
    case "TOOL_RESULT": {
      const idx = [...state.toolLog].reverse().findIndex((e) => e.name === action.name && !e.result);
      if (idx === -1) return state;
      const realIdx = state.toolLog.length - 1 - idx;
      const toolLog = state.toolLog.slice();
      toolLog[realIdx] = { ...toolLog[realIdx], result: action.result };
      return { ...state, toolLog };
    }
    case "STATUS_CHANGED":
      return { ...state, status: action.status };
    case "ERROR":
      return { ...state, lastError: action.message };
    case "SHELL_OUTPUT_CHUNK":
      return { ...state, shellOutput: [...state.shellOutput, { stream: action.stream, chunk: action.chunk }] };
    case "PLAN_STARTED":
      return { ...state, planSteps: action.steps };
    case "PLAN_STEP_CHANGED": {
      if (!state.planSteps) return state;
      const planSteps = state.planSteps.map((s) => (s.id === action.step.id ? action.step : s));
      return { ...state, planSteps };
    }
    case "FILE_SELECTED":
      return { ...state, selectedFile: action.path };
    case "MEMORY_SUMMARY_UPDATED":
      return { ...state, memorySummary: action.summary };
    case "FOCUS_PANE":
      return { ...state, focusedPane: action.pane };
    default:
      return state;
  }
}
