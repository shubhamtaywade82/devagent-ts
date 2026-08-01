export type ContextSectionKind = "goal" | "diagnostics" | "code" | "git_diff" | "tool_output" | "docs" | "step_state";

export const SECTION_PRIORITY: Record<ContextSectionKind, number> = {
  goal: 100,
  diagnostics: 90,
  code: 70,
  git_diff: 60,
  tool_output: 50,
  docs: 40,
  step_state: 30,
};

export type CodeContextItem = {
  path: string;
  symbol?: string;
  text: string;
  score?: number;
  startLine?: number;
  endLine?: number;
};

export type DiagnosticItem = {
  path?: string;
  message: string;
  severity?: "error" | "warning" | "info" | string;
};

export type ToolOutputItem = {
  tool: string;
  content: string;
  isError?: boolean;
};

export type DocSnippetItem = {
  id: string;
  text: string;
};

export type TaskContextInput = {
  goal: string;
  code?: CodeContextItem[];
  diagnostics?: DiagnosticItem[];
  gitDiff?: string;
  toolOutputs?: ToolOutputItem[];
  docs?: DocSnippetItem[];
  previousStepState?: string;
};

export type ContextFragment = {
  id: string;
  kind: ContextSectionKind;
  priority: number;
  text: string;
  path?: string;
  relevance: number;
};

export type ExcludedFragment = {
  id: string;
  kind: ContextSectionKind;
  reason: string;
};

export type PackedSection = {
  kind: ContextSectionKind;
  text: string;
  fragmentIds: string[];
};

export type PackedContext = {
  goal: string;
  sections: PackedSection[];
  promptBlock: string;
  totalChars: number;
  truncated: boolean;
  excluded: ExcludedFragment[];
  includedIds: string[];
};

export type ContextPackerOptions = {
  maxChars?: number;
  maxFragmentChars?: number;
  minRelevance?: number;
  maxCodeItems?: number;
  maxDocItems?: number;
  maxToolOutputs?: number;
  maxRawDumpChars?: number;
};
