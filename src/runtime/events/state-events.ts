/**
 * StateEvent — how the runtime *state* is projected (review item 12).
 *
 * State events mutate the application-state projection (context usage,
 * token usage, modes, the conversation transcript model). They are
 * derived from execution and domain activity but are owned by the state
 * store, not the execution runtime: replaying an execution log rebuilds
 * execution outcomes, not these projections.
 */

import type { AgentMode, CardItem, ChatRole, ExecutionStep, RuntimeMode } from "../types.js";

export type StateEvent =
  // ── conversation transcript model ───────────────────────────────────────
  | { type: "conversation.message"; role: ChatRole; text: string }
  | { type: "conversation.chunk"; role: "assistant" | "thinking"; chunk: string }
  | { type: "conversation.clear" }
  | {
      type: "conversation.plan";
      goal: string;
      steps: ExecutionStep[];
      status: "pending" | "running" | "completed" | "failed";
    }
  | { type: "conversation.decision"; options: string[]; selected: string; reason: string; confidence: number }
  | { type: "conversation.diff"; filePath: string; diff: string; status: "pending_review" | "approved" | "rejected" }
  | { type: "conversation.card"; title: string; status: "running" | "completed" | "failed"; items: CardItem[] }
  | { type: "conversation.card_item"; title: string; label: string; status: CardItem["status"]; detail?: string }
  // ── resource / context accounting projections ───────────────────────────
  | { type: "context.changed"; used: number; limit: number; latencyMs?: number }
  | { type: "usage.changed"; promptTokens: number; completionTokens: number }
  // ── mode & runtime status ───────────────────────────────────────────────
  | { type: "mode.changed"; mode: RuntimeMode }
  | { type: "mode.agent"; mode: AgentMode }
  | { type: "status.changed"; status: string }
  // ── streaming state toggle (message assembly, not the model call itself) ─
  | { type: "model.streaming"; streaming: boolean; tokensPerSecond?: number };
