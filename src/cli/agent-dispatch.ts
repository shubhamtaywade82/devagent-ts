import { ChatMessage, ChatOptions, ChatResponse } from "../provider/provider.js";
import { Capability } from "../provider/catalog.js";
import { LoopDetector } from "../orchestrator/loop-detector.js";
import { isLookupPrompt } from "./agent-escalation.js";
import { AgentConversation } from "./agent-conversation.js";
import { AgentToolManager } from "./agent-tools.js";
import { DynamicToolSelector } from "../tools/discovery.js";
import { LocalWorker } from "../provider/local-worker.js";
import { Provider } from "../provider/provider.js";
import { Router } from "../provider/router.js";
import { ModelCatalog } from "../provider/catalog.js";

/** Result of a single tool-call dispatch within the agentic loop. */
export type DispatchResult =
  | { kind: "tool_ok"; name: string; result: Record<string, unknown>; hadError: boolean; loopAbort?: string }
  | { kind: "escalate"; reason: string }
  | { kind: "rejected"; name: string }
  | { kind: "error"; name: string; error: Error };

export interface DispatchContext {
  conversation: AgentConversation;
  tools: AgentToolManager;
  toolSelector: DynamicToolSelector;
  loopDetector: LoopDetector;
  provider: Provider;
  catalog: ModelCatalog;
  router: Router;
  localWorker: LocalWorker | undefined;
  userMessage: string;
  requestApproval: (title: string, summary: string) => Promise<boolean>;
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onToolResult: (name: string, result: Record<string, unknown>) => void;
  onError: (error: Error) => void;
  feedRailsIndex: (name: string, args: Record<string, unknown>, result: Record<string, unknown>) => void;
  routeWithFallback: (capability: Capability, messages: ChatMessage[], opts?: ChatOptions) => Promise<ChatResponse>;
  ensureCatalog: () => Promise<void>;
  injectDelegationAddendum: () => void;
}

/**
 * Selects the active tool set for the current turn, ensuring escalate_task
 * and delegate_to_local are always available when appropriate.
 */
export async function selectActiveTools(
  ctx: DispatchContext,
  escalated: boolean,
): Promise<import("../tools/tool.js").Tool[]> {
  const userMessage = ctx.userMessage;
  await ctx.ensureCatalog();

  const activeTools = await ctx.toolSelector.selectTools(
    userMessage,
    ctx.conversation.getMessages(),
    ctx.tools.registry.getTools(),
  );

  // escalate_task must always be offered while still on the local model
  if (!escalated && !activeTools.some((t) => t.name === "escalate_task")) {
    const escalateTool = ctx.tools.registry.getTools().find((t) => t.name === "escalate_task");
    if (escalateTool) activeTools.push(escalateTool);
  }

  // Symmetric: delegate_to_local must always be offered once escalated
  if (escalated && ctx.localWorker && !activeTools.some((t) => t.name === "delegate_to_local")) {
    const delegateTool = ctx.tools.registry.getTools().find((t) => t.name === "delegate_to_local");
    if (delegateTool) activeTools.push(delegateTool);
  }

  return activeTools;
}

/**
 * Determines whether the current turn's response should be buffered
 * (not emitted to UI) for verification before potential re-run on
 * the primary model.
 */
export function shouldBuffer(
  toolTurn: number,
  escalated: boolean,
  previousTurnHadToolError: boolean,
  userMessage: string,
): boolean {
  const verifyingLookup = isLookupPrompt(userMessage) && toolTurn === 0 && !escalated;
  const verifyingRecovery = !escalated && previousTurnHadToolError;
  return verifyingLookup || verifyingRecovery;
}

/**
 * Dispatches a single tool call: validates args, checks approval,
 * invokes the tool, and handles errors / loop detection / escalation.
 */
export async function dispatchToolCall(
  ctx: DispatchContext,
  name: string,
  args: Record<string, unknown>,
  classifyDestructive: (name: string, args: Record<string, unknown>) => { title: string; summary: string } | null,
): Promise<DispatchResult> {
  ctx.onToolCall(name, args);

  // Approval gate for destructive actions
  const destructive = classifyDestructive(name, args);
  if (destructive && !(await ctx.requestApproval(destructive.title, destructive.summary))) {
    return { kind: "rejected", name };
  }

  try {
    const result = await ctx.tools.registry.invoke(name, args);

    if (result.error === "PathEscapeError") {
      ctx.conversation.pushToolResult(JSON.stringify({ error: "PathEscapeError", message: result.message }, null, 2));
      ctx.onToolResult(name, result);
      ctx.conversation.pushSystemMessage(
        "[system] The previous tool call escaped the workspace root. Retry with a path under the current workspace root.",
      );

      if (typeof result.error === "string" && ctx.loopDetector.record(name, args, result.error)) {
        return { kind: "tool_ok", name, result, hadError: true, loopAbort: "repeated escapes" };
      }
      return { kind: "tool_ok", name, result, hadError: true };
    }

    ctx.onToolResult(name, result);
    ctx.feedRailsIndex(name, args, result);
    ctx.conversation.pushToolResult(typeof result === "string" ? result : JSON.stringify(result, null, 2));

    // Check for escalate_task tool response
    if (name === "escalate_task" && result.escalate === true) {
      return { kind: "escalate", reason: String(result.reason ?? "self-escalated") };
    }

    const hadError = typeof result.error === "string";
    let loopAbort: string | undefined;
    if (hadError) {
      if (ctx.loopDetector.record(name, args, result.error as string)) {
        loopAbort = name;
      }
    }

    return { kind: "tool_ok", name, result, hadError, loopAbort };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    ctx.onError(err);
    ctx.conversation.pushToolResult(JSON.stringify({ error: err.constructor.name, message: err.message }, null, 2));
    return { kind: "error", name, error: err };
  }
}
