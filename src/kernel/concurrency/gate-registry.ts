/**
 * GateRegistry — layered concurrency as a first-class runtime primitive.
 *
 * The ConcurrencyGate (src/runtime/concurrency-gate.ts) is already a solid
 * primitive; this registry generalizes it to the layered model the runtime
 * needs:
 *
 *   Global    → 32     total in-flight work items
 *   Model     → 8      model calls
 *   Provider  → 3      per cloud provider
 *   Agent     → N      per agent product
 *   Tool      → N      per tool (owned by the ToolGateway)
 *   Workspace → N      per workspace root
 *   Domain    → 1      e.g. trading execution: strictly serialized
 *
 * Scopes are named; keys partition a scope (e.g. provider:cloud vs
 * provider:local). Unknown scope/key combinations create gates lazily from
 * configured defaults so callers never allocate gates by hand.
 */

import { ConcurrencyGate, ConcurrencyGateOptions } from "../../runtime/concurrency-gate.js";

export type GateScope = "global" | "model" | "provider" | "agent" | "tool" | "workspace" | "domain";

export const GATE_SCOPES: readonly GateScope[] = [
  "global",
  "model",
  "provider",
  "agent",
  "tool",
  "workspace",
  "domain",
];

export interface GateRegistryDefaults {
  global?: number;
  model?: number;
  provider?: number;
  agent?: number;
  tool?: number;
  workspace?: number;
  domain?: number;
}

export interface GateRegistryOptions {
  defaults?: GateRegistryDefaults;
  maxQueueDepth?: number;
}

export interface GateSnapshot {
  scope: GateScope;
  key: string;
  label: string;
  activeCount: number;
  queuedCount: number;
  maxConcurrent: number;
}

const DEFAULT_LIMITS: Required<GateRegistryDefaults> = {
  global: 32,
  model: 8,
  provider: 3,
  agent: 4,
  tool: 4,
  workspace: 8,
  domain: 1,
};

export class GateRegistry {
  private readonly gates = new Map<string, ConcurrencyGate>();
  private readonly defaults: Required<GateRegistryDefaults>;
  private readonly maxQueueDepth: number;

  constructor(opts: GateRegistryOptions = {}) {
    this.defaults = { ...DEFAULT_LIMITS, ...(opts.defaults ?? {}) };
    this.maxQueueDepth = opts.maxQueueDepth ?? 100;
  }

  gate(scope: GateScope, key = "default", overrides: ConcurrencyGateOptions = {}): ConcurrencyGate {
    const mapKey = `${scope}:${key}`;
    let gate = this.gates.get(mapKey);
    if (!gate) {
      gate = new ConcurrencyGate({
        maxConcurrent: overrides.maxConcurrent ?? this.defaults[scope],
        maxQueueDepth: overrides.maxQueueDepth ?? this.maxQueueDepth,
        label: overrides.label ?? `${scope}:${key}`,
      });
      this.gates.set(mapKey, gate);
    }
    return gate;
  }

  /** Run `fn` under the gate identified by scope+key. */
  async run<T>(scope: GateScope, key: string, fn: () => Promise<T>): Promise<T> {
    const gate = this.gate(scope, key);
    return gate.run(fn);
  }

  /** Observability snapshot for the TUI/logs. */
  snapshot(): GateSnapshot[] {
    return [...this.gates.entries()].map(([mapKey, gate]) => {
      const [scope, ...rest] = mapKey.split(":");
      return {
        scope: scope as GateScope,
        key: rest.join(":") || "default",
        label: gate.label,
        activeCount: gate.activeCount,
        queuedCount: gate.queuedCount,
        maxConcurrent: gate.maxConcurrent,
      };
    });
  }
}
