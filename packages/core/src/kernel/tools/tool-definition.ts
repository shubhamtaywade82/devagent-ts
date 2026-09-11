/**
 * ToolDefinition — the metadata contract every tool exposes to the kernel.
 *
 * The legacy `Tool` abstract class (src/tools/tool.ts) answers "what does
 * this tool do?" with name/description/parameters. That is enough for a
 * schema registry, but not for a security boundary: the kernel needs to know
 * how risky a tool is, what it can touch, how it should run, and whether a
 * human must confirm before it fires. ToolDefinition carries that contract.
 *
 * The ToolGateway is the enforcement point; this module is the vocabulary.
 */

/** Severity ladder used by the PolicyEngine's confirmation rules. */
export type ToolRisk = "read" | "low" | "medium" | "high" | "critical";

export const TOOL_RISK_ORDER: readonly ToolRisk[] = ["read", "low", "medium", "high", "critical"];

export function toolRiskAtLeast(risk: ToolRisk, floor: ToolRisk): boolean {
  return TOOL_RISK_ORDER.indexOf(risk) >= TOOL_RISK_ORDER.indexOf(floor);
}

/** What parts of the world a tool can observe or mutate. */
export interface ToolSideEffects {
  /** Creates/updates/deletes files inside the workspace. */
  filesystem: boolean;
  /** Spawns processes or shell commands. */
  process: boolean;
  /** Performs network I/O (HTTP, exchanges, MCP transports). */
  network: boolean;
  /** Mutates state outside the workspace (git push, GitHub PRs, MCP writes). */
  externalMutation: boolean;
  /** Moves or commits money / positions (trading execution). */
  financial: boolean;
}

/** How the gateway should schedule and supervise execution. */
export interface ToolExecutionSpec {
  /** Hard per-call timeout; the gateway rejects results that exceed it. */
  timeoutMs: number;
  /** Max concurrent in-flight calls of THIS tool (per gateway instance). */
  concurrency: number;
  /** Repeating the call with the same args has no additional effect. */
  idempotent: boolean;
  /** The effects can be undone (patch → backup, git → reflog, ...). */
  reversible: boolean;
}

/** Human-in-the-loop policy attached to the tool itself. */
export interface ToolPolicySpec {
  confirmation: "never" | "optional" | "required";
}

export interface ToolDefinition {
  /** Canonical id — usually the tool name exposed to models. */
  id: string;
  description: string;
  /** JSON-Schema (Ollama/OpenAI function-parameters shape). */
  inputSchema: Record<string, unknown>;
  /** Capability tags for discovery filtering (coding, market, docs, ...). */
  capabilities: string[];
  /** Legacy category string kept for the TUI tool palette grouping. */
  pack: string;
  tags: string[];

  risk: ToolRisk;
  sideEffects: ToolSideEffects;
  execution: ToolExecutionSpec;
  policy: ToolPolicySpec;
}

/** Gateway-visible execution result. Domain payloads stay opaque. */
export interface ToolResult {
  ok: boolean;
  /** Tool payload on success; error detail record on failure. */
  data: Record<string, unknown>;
  error?: { code: string; message: string };
}

/** A tool call request as issued by a model or a strategy. */
export interface ToolInvocation {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** The callable behind a ToolDefinition. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** No side effects anywhere — the default for pure read tools. */
export const NO_SIDE_EFFECTS: ToolSideEffects = {
  filesystem: false,
  process: false,
  network: false,
  externalMutation: false,
  financial: false,
};

export const DEFAULT_EXECUTION_SPEC: ToolExecutionSpec = {
  timeoutMs: 120_000,
  concurrency: 4,
  idempotent: false,
  reversible: false,
};

export const DEFAULT_POLICY_SPEC: ToolPolicySpec = { confirmation: "optional" };

/** Merge partial overrides over safe defaults. */
export function defineToolMetadata(overrides: {
  risk?: ToolRisk;
  sideEffects?: Partial<ToolSideEffects>;
  execution?: Partial<ToolExecutionSpec>;
  policy?: Partial<ToolPolicySpec>;
}): Pick<ToolDefinition, "risk" | "sideEffects" | "execution" | "policy"> {
  return {
    risk: overrides.risk ?? "medium",
    sideEffects: { ...NO_SIDE_EFFECTS, ...(overrides.sideEffects ?? {}) },
    execution: { ...DEFAULT_EXECUTION_SPEC, ...(overrides.execution ?? {}) },
    policy: { ...DEFAULT_POLICY_SPEC, ...(overrides.policy ?? {}) },
  };
}
