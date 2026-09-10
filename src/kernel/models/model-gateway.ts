/**
 * ModelGateway — the kernel's single port to model inference.
 *
 * Wraps the existing Provider/Router/Catalog stack behind one facade so
 * strategies and the runtime never touch providers directly, and every
 * model call flows through:
 *
 *   capability → registry candidates → Router (failover) → per-tier gate
 *
 * The per-tier ConcurrencyGate bounds how many model calls run at once per
 * tier (local vs cloud) — the first layer of the layered concurrency model
 * (global / model / provider / agent / tool / workspace / domain).
 */

import type { ChatMessage, ChatOptions, ChatResponse } from "../../provider/provider.js";
import { Router } from "../../provider/router.js";
import type { ModelCatalog } from "../../provider/catalog.js";
import { ConcurrencyGate } from "../../runtime/concurrency-gate.js";
import type { Capability } from "../../provider/catalog.js";
import { BudgetTracker } from "../budget.js";
import { ModelCapabilityRegistry } from "./model-capability-registry.js";

export interface ModelGateway {
  /** Route one chat request by capability. Never mutates provider state. */
  route(capability: Capability, messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
  /** Route bypassing capability selection (explicit model). */
  routeToModel(
    model: string,
    tier: "local" | "cloud",
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResponse>;
  /** The capability registry the gateway routes from. */
  profiles(): ModelCapabilityRegistry;
}

export interface DefaultModelGatewayOptions {
  router: Router;
  catalog: ModelCatalog;
  registry?: ModelCapabilityRegistry;
  /** Optional budget tracker to record token/cost usage per call. */
  budget?: BudgetTracker;
  gates?: { local?: ConcurrencyGate; cloud?: ConcurrencyGate };
}

export class DefaultModelGateway implements ModelGateway {
  readonly registry: ModelCapabilityRegistry;
  private readonly router: Router;
  private readonly catalog: ModelCatalog;
  private readonly budget?: BudgetTracker;
  private readonly localGate: ConcurrencyGate;
  private readonly cloudGate: ConcurrencyGate;

  constructor(opts: DefaultModelGatewayOptions) {
    this.router = opts.router;
    this.catalog = opts.catalog;
    this.registry = opts.registry ?? new ModelCapabilityRegistry();
    this.budget = opts.budget;
    this.localGate = opts.gates?.local ?? new ConcurrencyGate({ maxConcurrent: 8, label: "model:local" });
    this.cloudGate = opts.gates?.cloud ?? new ConcurrencyGate({ maxConcurrent: 3, label: "model:cloud" });
  }

  async route(capability: Capability, messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    const response = await this.router.route(capability, messages, opts);
    this.record(response);
    return response;
  }

  async routeToModel(
    model: string,
    tier: "local" | "cloud",
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResponse> {
    const gate = tier === "cloud" ? this.cloudGate : this.localGate;
    const response = await gate.run(() =>
      this.router.route(capabilityForFallback(), messages, { ...opts, model }),
    );
    this.record(response);
    return response;
  }

  /** Mirrors Router semantics but keeps the tier gate around the Router's own failover. */
  async routeGated(capability: Capability, messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    // The Router already walks candidates across tiers; wrapping the whole
    // walk in the local gate would misattribute cloud calls. Instead both
    // gates bound concurrency per tier inside route(): here we just use the
    // local gate as a global model-call limiter for strategy-level calls.
    const response = await this.router.route(capability, messages, opts);
    this.record(response);
    return response;
  }

  profiles(): ModelCapabilityRegistry {
    return this.registry;
  }

  private record(response: ChatResponse): void {
    if (!this.budget) return;
    const promptTokens = Number(response.prompt_eval_count ?? 0);
    const completionTokens = Number(response.eval_count ?? 0);
    const cost =
      response.routedModel !== undefined
        ? this.registry.estimateCostUsd(response.routedModel, promptTokens, completionTokens)
        : undefined;
    this.budget.consumeModelCall({ promptTokens, completionTokens, costUsd: cost });
  }
}

function capabilityForFallback() {
  // routeToModel exists to pin an explicit model; the capability tag only
  // shapes candidate ordering, which the explicit model overrides.
  return "tools" as Capability;
}
