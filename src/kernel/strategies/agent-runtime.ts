/**
 * DefaultAgentRuntime — the kernel facade tying everything together.
 *
 * Implements the review's recommended core API (§24):
 *
 *   AgentRuntime.execute(request, context) → Promise<ExecutionResult>
 *
 * The runtime owns:
 *   - the agent registry (which agents exist, their default strategies,
 *     allowed capabilities, and mounted tool packs)
 *   - the strategy registry (react / plan_execute / graph / workflow)
 *   - execution bookkeeping (active runs, cancellation handles)
 *
 * It delegates policy to the PolicyEngine inside the ToolGateway, model
 * calls to the ModelGateway, and never touches a concrete tool, provider,
 * or domain directly.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentId,
  AgentRuntime,
  ExecutionRequest,
  ExecutionResult,
  ExecutionContext,
  StrategyExecuteOptions,
  StrategyName,
} from "../types.js";
import { ExecutionStrategy } from "./execution-strategy.js";
import { ReActStrategy } from "./execution-strategy.js";
import { PlanExecuteStrategy } from "./plan-execute-strategy.js";
import { GateRegistry } from "../concurrency/gate-registry.js";

// ── Agent registry ──────────────────────────────────────────────────────────

export interface AgentDescriptor {
  id: AgentId;
  displayName: string;
  /** Model-routing capability used for this agent's turns. */
  defaultCapability: "coding" | "vision" | "reasoning" | "quick" | "tools" | "agentic";
  defaultStrategy: StrategyName;
  /** Tool-pack ids this agent may use (capability scoping). */
  allowedPackIds?: string[];
  /** Capability tags used for tool discovery filtering. */
  capabilities?: string[];
  description?: string;
}

export class AgentRegistry {
  private readonly agents = new Map<AgentId, AgentDescriptor>();

  register(descriptor: AgentDescriptor): this {
    this.agents.set(descriptor.id, descriptor);
    return this;
  }

  get(id: AgentId): AgentDescriptor | undefined {
    return this.agents.get(id);
  }

  require(id: AgentId): AgentDescriptor {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(
        `unknown agent "${id}". Registered agents: ${[...this.agents.keys()].sort().join(", ") || "(none)"}`,
      );
    }
    return agent;
  }

  ids(): AgentId[] {
    return [...this.agents.keys()];
  }
}

// ── Strategy registry ───────────────────────────────────────────────────────

export class StrategyRegistry {
  private readonly strategies = new Map<StrategyName, ExecutionStrategy>();

  register(strategy: ExecutionStrategy): this {
    this.strategies.set(strategy.name, strategy);
    return this;
  }

  get(name: StrategyName): ExecutionStrategy | undefined {
    return this.strategies.get(name);
  }

  require(name: StrategyName): ExecutionStrategy {
    const strategy = this.strategies.get(name);
    if (!strategy) {
      throw new Error(`unknown execution strategy "${name}". Registered: ${[...this.strategies.keys()].join(", ")}`);
    }
    return strategy;
  }

  names(): StrategyName[] {
    return [...this.strategies.keys()];
  }
}

export function defaultStrategyRegistry(): StrategyRegistry {
  return new StrategyRegistry().register(new ReActStrategy()).register(new PlanExecuteStrategy());
}

// ── Runtime ─────────────────────────────────────────────────────────────────

export interface DefaultAgentRuntimeOptions {
  strategies?: StrategyRegistry;
  gates?: GateRegistry;
  /** Max tool turns applied when neither the request nor the agent specifies one. */
  defaultMaxToolTurns?: number;
}

export class DefaultAgentRuntime implements AgentRuntime {
  readonly agents = new AgentRegistry();
  readonly strategies: StrategyRegistry;
  readonly gates: GateRegistry;

  private readonly defaultMaxToolTurns: number;
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(opts: DefaultAgentRuntimeOptions = {}) {
    this.strategies = opts.strategies ?? defaultStrategyRegistry();
    this.gates = opts.gates ?? new GateRegistry();
    this.defaultMaxToolTurns = opts.defaultMaxToolTurns ?? 64;
  }

  /**
   * Execute one task. The caller supplies the ExecutionContext (it owns the
   * gateways + context port). The runtime resolves the agent descriptor,
   * picks the strategy, runs under the agent-level concurrency gate, and
   * tracks the run for cancellation via `cancel(runId)`. Product-side
   * policies ride in through `options.hooks` (see strategy-hooks.ts).
   */
  async execute(
    request: ExecutionRequest,
    context: ExecutionContext,
    options?: StrategyExecuteOptions,
  ): Promise<ExecutionResult> {
    const agent = this.agents.require(request.agentId);
    const strategyName = request.strategy ?? agent.defaultStrategy;
    const strategy = this.strategies.require(strategyName);

    // Agent-level concurrency: one lease per product agent, so a burst of
    // user requests cannot fork-bomb the machine with parallel agent runs.
    const release = await this.gates.gate("agent", request.agentId).acquire("normal");
    const controller = new AbortController();
    if (context.signal.aborted) controller.abort();
    else context.signal.addEventListener("abort", () => controller.abort(), { once: true });
    this.activeRuns.set(context.runId, controller);

    try {
      const result = await strategy.run({
        ctx: { ...context, agentId: request.agentId, signal: controller.signal },
        capability: agent.defaultCapability,
        maxToolTurns: options?.maxToolTurns ?? this.defaultMaxToolTurns,
        toolCapabilities: request.capabilities ?? agent.capabilities,
        hooks: options?.hooks,
      });
      return result;
    } finally {
      this.activeRuns.delete(context.runId);
      release();
    }
  }

  /** Cancel an active run by id (wires through to the strategy's signal). */
  cancel(runId: string): boolean {
    const controller = this.activeRuns.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  activeRunIds(): string[] {
    return [...this.activeRuns.keys()];
  }
}

/** Convenience factory: descriptor for the default coding agent. */
export function devAgentDescriptor(): AgentDescriptor {
  return {
    id: "devagent",
    displayName: "Nexum DevAgent",
    description: "Software-engineering agent: filesystem, git, tests, LSP, browser.",
    defaultCapability: "agentic",
    defaultStrategy: "react",
  };
}

export function runId(): string {
  return `run_${randomUUID()}`;
}
