/**
 * Default ExecutionContext factory. Wires a run-scoped context: fresh
 * BudgetTracker, abort signal, event sink, and the ports (context manager)
 * supplied by the embedding application (CLI, TUI, background worker, ...).
 */

import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../../models/adapters/provider.js";
import type {
  AgentId,
  ContextManager,
  EventSink,
  ExecutionContext,
  ExecutionRequest,
  ModelGateway,
  PolicyEngine,
  RunId,
  SessionId,
  StateStore,
  TaskSpec,
  ToolGateway,
} from "../../core/types.js";
import { BudgetTracker } from "../budget/budget-tracker.js";

export interface CreateExecutionContextOptions {
  runId?: RunId;
  sessionId?: SessionId;
  signal?: AbortSignal;
  context?: ContextManager;
  events?: EventSink;
  budget?: ExecutionRequest["budgets"];
  modelGateway: ModelGateway;
  toolGateway: ToolGateway;
  policyEngine?: PolicyEngine;
  state?: StateStore;
}

export class TransientContextManager implements ContextManager {
  private readonly items: ChatMessage[] = [];

  constructor(initial: ChatMessage[] = []) {
    this.items.push(...initial);
  }

  messages(): readonly ChatMessage[] {
    return this.items;
  }

  push(message: ChatMessage): void {
    this.items.push(message);
  }

  pushSystem(text: string): void {
    this.items.push({ role: "system", content: text });
  }

  pushToolResult(content: string): void {
    this.items.push({ role: "tool", content });
  }

  lastAssistantText(): string | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const m = this.items[i];
      if (m.role === "assistant" && m.content) return m.content;
    }
    return undefined;
  }
}

/** A no-op event sink for headless runs that don't need event projection. */
export const nullEventSink: EventSink = {
  publish: () => undefined,
};

export function createExecutionContext(
  request: ExecutionRequest,
  opts: CreateExecutionContextOptions,
): ExecutionContext {
  const runId = opts.runId ?? `run_${randomUUID()}`;
  const sessionId = opts.sessionId ?? `sess_${randomUUID()}`;
  const controller = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    runId,
    sessionId,
    agentId: request.agentId,
    task: request.task,
    signal: controller.signal,
    mode: request.mode,
    unattended: request.unattended,
    modelGateway: opts.modelGateway,
    toolGateway: opts.toolGateway,
    policyEngine: opts.policyEngine ?? defaultPolicyEngineRef,
    context: opts.context ?? new TransientContextManager(),
    events: opts.events ?? nullEventSink,
    budget: new BudgetTracker({ runId, sessionId, budget: opts.budget }),
  };
}

/**
 * Placeholder PolicyEngine used when the embedding application does not
 * supply one — a permissive engine so kernel code paths stay functional in
 * headless mode. Applications should always register a real engine in
 * production (see src/kernel/policy/policy-engine.ts).
 */
import type { PolicyDecision, PolicyRequest } from "../../core/policy/policy-engine.js";
const defaultPolicyEngineRef: PolicyEngine = {
  check(_request: PolicyRequest): PolicyDecision {
    return { allowed: true, requireConfirmation: false, reason: "no policy engine registered" };
  },
};

// Re-exported task type guard for callers building TaskSpecs dynamically.
export function taskFrom(input: string | TaskSpec): TaskSpec {
  return typeof input === "string" ? { goal: input } : input;
}

export type { AgentId, RunId, SessionId };
