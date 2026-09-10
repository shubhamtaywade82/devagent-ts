/**
 * ExecutionStrategy — the pluggable think→act→observe loop.
 *
 * The current ReAct loop is hard-coded inside the Agent (runUserMessage).
 * This module promotes the *shape* of such loops into a strategy contract
 * owned by the kernel, while the kernel keeps owning the hard parts:
 * budgets, timeouts, events, cancellation, concurrency, retries, state.
 *
 * A strategy receives an ExecutionContext (per-run, pre-wired with gateways,
 * context port, event sink, budget, abort signal) and drives the loop. It
 * must respect: ctx.signal cancellation, ctx.budget ceilings, and emit
 * events through ctx.events (never console.log).
 */

import type { ChatMessage } from "../../provider/provider.js";
import { Capability } from "../../provider/catalog.js";
import type {
  ExecutionResult,
  ExecutionContext,
  ExecutionStatus,
  StrategyName,
} from "../types.js";
import { LoopDetector } from "../../orchestrator/loop-detector.js";

export interface ExecutionStrategy {
  readonly name: StrategyName;
  run(request: StrategyRunRequest): Promise<ExecutionResult>;
}

export interface StrategyRunRequest {
  /** Per-run, pre-wired execution context (gateways, budget, signal, events). */
  ctx: ExecutionContext;
  /** Capability used for model routing during the loop. */
  capability: Capability;
  /** Max tool turns (loop safety). */
  maxToolTurns?: number;
  /** Tool capability filter for schemas sent to the model. */
  toolCapabilities?: string[];
  onProgress?: (message: string) => void;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Extract tool calls from a ChatResponse, tolerating missing/malformed fields. */
export function extractToolCalls(response: {
  message?: { tool_calls?: unknown[] };
}): Array<{ name: string; arguments: unknown }> {
  const calls = response.message?.tool_calls ?? [];
  const out: Array<{ name: string; arguments: unknown }> = [];
  for (const call of calls) {
    const fn = (call as { function?: { name?: string; arguments?: unknown } })?.function;
    if (!fn?.name) continue;
    out.push({ name: fn.name, arguments: fn.arguments ?? {} });
  }
  return out;
}

function usageOf(response: Record<string, unknown>): {
  promptTokens: number;
  completionTokens: number;
} {
  return {
    promptTokens: Number(response.prompt_eval_count ?? 0),
    completionTokens: Number(response.eval_count ?? 0),
  };
}

/** Common wrapper: map abort/budget errors onto ExecutionResult statuses. */
export async function runGuarded(
  ctx: ExecutionContext,
  strategy: StrategyName,
  loop: () => Promise<string>,
): Promise<ExecutionResult> {
  const usage = () => ctx.budget.snapshot();
  try {
    ctx.budget.assertTimeLeft();
    const output = await loop();
    return {
      status: "completed",
      runId: ctx.runId,
      agentId: ctx.agentId,
      strategy,
      output,
      usage: usage(),
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    let status: ExecutionStatus = "failed";
    if (ctx.signal.aborted) status = "cancelled";
    else if (err.name === "WallClockBudgetError") status = "timeout";
    else if (err.name.endsWith("BudgetError")) status = "budget_exhausted";
    return {
      status,
      runId: ctx.runId,
      agentId: ctx.agentId,
      strategy,
      output: ctx.context.lastAssistantText() ?? "",
      usage: usage(),
      error: err.message,
    };
  }
}

// ── ReAct strategy ──────────────────────────────────────────────────────────

export interface ReActStrategyOptions {
  /** Loop-detector window tuning (defaults match the Agent's current behavior). */
  loopThreshold?: number;
}

/**
 * ReAct: model → tool call → policy → tool executor → observation → model.
 * Portable implementation of the loop the CLI Agent runs today, minus the
 * CLI-specific concerns (skills, escalation, summarization) which stay in
 * the product layer.
 */
export class ReActStrategy implements ExecutionStrategy {
  readonly name: StrategyName = "react";
  private readonly loopThreshold?: number;

  constructor(opts: ReActStrategyOptions = {}) {
    this.loopThreshold = opts.loopThreshold;
  }

  async run(request: StrategyRunRequest): Promise<ExecutionResult> {
    const { ctx } = request;
    const maxTurns = request.maxToolTurns ?? 32;
    const loopDetector = new LoopDetector();

    return runGuarded(ctx, this.name, async () => {
      if (ctx.task.input) ctx.context.push({ role: "user", content: ctx.task.input });

      let lastText: string | undefined;

      for (let turn = 0; turn < maxTurns; turn++) {
        if (ctx.signal.aborted) throw new DOMException("run cancelled", "AbortError");
        ctx.budget.assertTimeLeft();

        const messages = ctx.context.messages() as ChatMessage[];
        const response = await ctx.modelGateway.route(request.capability, messages, {
          tools: ctx.toolGateway.schemasFor(request.toolCapabilities),
        });

        lastText = response.message?.content || lastText;
        const { promptTokens, completionTokens } = usageOf(response);
        ctx.budget.consumeModelCall({ promptTokens, completionTokens });

        if (response.message?.content) {
          ctx.context.push({ role: "assistant", content: response.message.content });
        }

        const toolCalls = extractToolCalls(response);

        if (toolCalls.length === 0) {
          if (lastText) return lastText;
          ctx.context.pushSystem(
            "[system] You were thinking but produced no action or response. Call a tool or provide your final answer now.",
          );
          continue;
        }

        ctx.context.push({
          role: "assistant",
          content: response.message?.content ?? "",
          tool_calls: response.message?.tool_calls as ChatMessage["tool_calls"],
        });

        for (const call of toolCalls) {
          if (ctx.signal.aborted) throw new DOMException("run cancelled", "AbortError");
          ctx.budget.consumeToolCall();
          ctx.events.publish({ type: "tool.started", id: `${ctx.runId}:${call.name}`, name: call.name, args: {} });

          const result = await ctx.toolGateway.invoke(call.name, call.arguments, {
            agentId: ctx.agentId,
            runId: ctx.runId,
            signal: ctx.signal,
          });

          ctx.events.publish({
            type: "tool.completed",
            id: `${ctx.runId}:${call.name}`,
            result: result.data,
          });

          ctx.context.pushToolResult(JSON.stringify(result.data, null, 2));

          if (!result.ok && loopDetector.record(call.name, {}, result.error?.code ?? "error")) {
            throw new Error(`loop detected after repeated: ${call.name}`);
          }
        }
      }

      return lastText ?? "(tool budget exceeded)";
    });
  }
}
