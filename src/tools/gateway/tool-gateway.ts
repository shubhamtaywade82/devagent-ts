/**
 * ToolGateway — the security and execution boundary for every tool call.
 *
 * The ToolCatalog answers "what exists?"; the gateway answers "may this
 * agent execute this tool now?" and then runs it under supervision:
 *
 *   resolve (aliases) → decode → normalize → validate
 *     → policy → concurrency lease → execute (timeout) → ToolResult
 *
 * Argument repair (array→object, numeric-key→object, alias mapping) is
 * ported from the legacy Registry so weak models keep working — but it now
 * happens BEFORE validation, and mutating tools can opt out of repair via
 * `definition.execution` metadata in the future. Policy violations throw
 * ToolDeniedError; unknown tools throw UnknownToolError; both are surfaced
 * as structured ToolResult failures instead of raw exceptions to keep the
 * model loop resilient.
 */

import { randomUUID } from "node:crypto";
import { ConcurrencyGate, GateSaturatedError } from "../../core/concurrency/gate.js";
import type { OllamaToolSchema } from "../../models/adapters/provider.js";
import { ToolCatalog, ToolCatalogEntry } from "./tool-catalog.js";
import { ToolDefinition, ToolInvocation, ToolResult } from "../../core/tools/tool-contract.js";
import type { PolicyEngine } from "../../core/policy/policy-engine.js";

/**
 * The kernel's tool port (review §24): discovery for schemas, invocation
 * under the full validate→policy→execute pipeline.
 */
export interface ToolGateway {
  discover(capabilities?: string[]): ToolDefinition[];
  schemasFor(capabilities?: string[]): OllamaToolSchema[];
  invoke(
    nameOrRequest: string | ToolInvocation,
    rawArgs?: Record<string, unknown> | unknown,
    ctx?: InvokeContext,
  ): Promise<ToolResult>;
}

export class UnknownToolError extends Error {
  constructor(
    public readonly name: string,
    public readonly available: string[],
  ) {
    super(`unknown tool: ${name}. Available tools: ${available.sort().join(", ")}`);
    this.name = "UnknownToolError";
  }
}

export class ToolDeniedError extends Error {
  constructor(
    message: string,
    public readonly rule?: string,
  ) {
    super(message);
    this.name = "ToolDeniedError";
  }
}

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolValidationError";
  }
}

export class ToolTimeoutError extends Error {
  constructor(
    public readonly toolId: string,
    public readonly timeoutMs: number,
  ) {
    super(`tool "${toolId}" timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
  }
}

// ── Argument repair (ported from legacy Registry) ───────────────────────────

const TOOL_ALIASES: Record<string, string> = {
  open_file: "read_file",
  cat_file: "read_file",
  view_file: "read_file",
  print_tree: "list_dir",
  tree: "list_dir",
  ls: "list_dir",
  search_codebase: "search_code",
  find_code: "search_code",
  execute_command: "run_shell",
  bash: "run_shell",
  sh: "run_shell",
};

export function canonicalToolName(rawName: string): string {
  const clean = rawName.trim().replace(/^(functions\.|tools__|mcp__|tool_)/i, "");
  return TOOL_ALIASES[clean] ?? TOOL_ALIASES[rawName] ?? clean;
}

export function normalizeToolArgs(definition: ToolDefinition | undefined, rawArgs: unknown): Record<string, unknown> {
  if (typeof rawArgs !== "object" || rawArgs === null) return {};

  const properties = (definition?.inputSchema?.properties ?? {}) as Record<string, unknown>;
  const propKeys = Object.keys(properties);

  if (Array.isArray(rawArgs)) {
    const mapped: Record<string, unknown> = {};
    rawArgs.forEach((val, idx) => {
      if (propKeys[idx]) mapped[propKeys[idx]] = val;
    });
    return mapped;
  }

  const keys = Object.keys(rawArgs);
  const isNumericKeys = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
  if (isNumericKeys) {
    const mapped: Record<string, unknown> = {};
    keys.forEach((k) => {
      const idx = Number(k);
      if (propKeys[idx]) mapped[propKeys[idx]] = (rawArgs as Record<string, unknown>)[k];
    });
    return mapped;
  }

  return rawArgs as Record<string, unknown>;
}

/**
 * Decode raw model tool-call arguments (string JSON, partial JSON, arrays)
 * into an object. Mirrors the repair the Agent loop performs today, moved
 * behind the gateway so every execution path benefits.
 */
export function decodeRawArguments(rawArguments: unknown): { args: unknown; parseError: string | null } {
  if (typeof rawArguments === "object" && rawArguments !== null) {
    return { args: rawArguments, parseError: null };
  }
  if (typeof rawArguments === "string" && rawArguments) {
    try {
      return { args: JSON.parse(rawArguments), parseError: null };
    } catch (err) {
      const parseError = err instanceof Error ? err.message : String(err);
      // Legacy repair: bare comma-separated values become an array, which
      // normalizeToolArgs maps positionally onto the schema properties.
      const parts = rawArguments.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      return { args: parts, parseError };
    }
  }
  return { args: {}, parseError: null };
}

// ── Lightweight schema validation ───────────────────────────────────────────

/**
 * Enforce required properties and top-level types from the tool's
 * JSON-Schema. Deliberately shallow (no zod dependency in the kernel):
 * deep validation stays the tool's own responsibility.
 */
export function validateAgainstSchema(
  args: Record<string, unknown>,
  schema: Record<string, unknown> | undefined,
): string[] {
  const problems: string[] = [];
  if (!schema) return problems;

  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (!(key in args)) problems.push(`missing required argument "${key}"`);
  }

  const properties = (schema.properties ?? {}) as Record<string, { type?: string | string[] }>;
  const typeMap: Record<string, string> = { string: "string", number: "number", integer: "number", boolean: "boolean" };
  for (const [key, value] of Object.entries(args)) {
    const propType = properties[key]?.type;
    if (!propType) continue;
    const expected = Array.isArray(propType) ? propType : [propType];
    for (const t of expected) {
      const want = typeMap[t];
      if (!want) continue; // object/array schemas stay the tool's responsibility
      const got = Array.isArray(value) ? "array" : typeof value;
      if (got !== want && !(want === "number" && got === "number")) {
        problems.push(`argument "${key}" expected ${t}, got ${got}`);
        break;
      }
    }
  }
  return problems;
}

// ── Gateway ─────────────────────────────────────────────────────────────────

export interface ToolGatewayOptions {
  catalog: ToolCatalog;
  policyEngine?: PolicyEngine;
  /** Namespace used in concurrency gate labels. */
  label?: string;
  /**
   * "strict" (default) enforces required-args + top-level types from the
   * tool's JSON-Schema; "off" restores exact legacy Registry behavior
   * (normalization only). Transitional: the CLI Agent's loop keeps "off"
   * until every tool schema is audited; kernel-native runs use strict.
   */
  validation?: "strict" | "off";
}

export interface InvokeContext {
  agentId?: string;
  runId?: string;
  mode?: string;
  unattended?: boolean;
  signal?: AbortSignal;
  /** Skip policy (kernel-internal calls, e.g. strategies re-reading files). */
  skipPolicy?: boolean;
  /**
   * Confirmation already granted for THIS call (the embedding app resolved a
   * prior ConfirmationRequired outcome). Confirmation rules are skipped, but
   * deny rules and mode restrictions still apply — an approval can never
   * unlock something policy forbids outright.
   */
  confirmed?: boolean;
}

const failure = (code: string, message: string): ToolResult => ({
  ok: false,
  data: { error: code, message },
  error: { code, message },
});

export class DefaultToolGateway implements ToolGateway {
  private readonly catalog: ToolCatalog;
  private readonly policyEngine?: PolicyEngine;
  private readonly label: string;
  private readonly validation: "strict" | "off";
  private readonly gates = new Map<string, ConcurrencyGate>();

  constructor(opts: ToolGatewayOptions) {
    this.catalog = opts.catalog;
    this.policyEngine = opts.policyEngine;
    this.label = opts.label ?? "tool-gateway";
    this.validation = opts.validation ?? "strict";
  }

  /** Tools visible for a capability filter (empty filter = all). */
  discover(capabilities?: string[]): ToolDefinition[] {
    if (!capabilities || capabilities.length === 0) return this.catalog.all().map((e) => e.definition);
    return this.catalog
      .all()
      .filter((e) => e.definition.capabilities.some((c) => capabilities.includes(c)))
      .map((e) => e.definition);
  }

  schemasFor(capabilities?: string[]) {
    const defs = this.discover(capabilities);
    return defs.map((d) => ({
      type: "function" as const,
      function: { name: d.id, description: d.description, parameters: d.inputSchema },
    }));
  }

  /** Policy pre-check without executing (used by UIs to preview gates). */
  preview(name: string, args: Record<string, unknown>, ctx: InvokeContext = {}) {
    const entry = this.resolve(name);
    if (!entry) return null;
    if (!this.policyEngine || ctx.skipPolicy) return { allowed: true, requireConfirmation: false, reason: "no engine" };
    return this.policyEngine.check({
      tool: entry.definition,
      args,
      agentId: ctx.agentId ?? "unknown",
      runId: ctx.runId ?? "unknown",
      mode: ctx.mode,
      unattended: ctx.unattended,
    });
  }

  async invoke(
    nameOrRequest: string | ToolInvocation,
    rawArgs: Record<string, unknown> | unknown,
    ctx: InvokeContext = {},
  ): Promise<ToolResult> {
    const name = typeof nameOrRequest === "string" ? nameOrRequest : nameOrRequest.name;
    const raw = typeof nameOrRequest === "string" ? rawArgs : nameOrRequest.args;

    // 1. Resolve — canonical name + catalog entry.
    const entry = this.resolve(name);
    if (!entry) {
      return failure("UnknownTool", new UnknownToolError(name, this.catalog.ids()).message);
    }

    // 2. Decode + 3. normalize (weak-model argument repair).
    let args: Record<string, unknown>;
    if (typeof raw === "string") {
      const decoded = decodeRawArguments(raw);
      args = normalizeToolArgs(entry.definition, decoded.args);
    } else {
      args = normalizeToolArgs(entry.definition, raw);
    }

    // 4. Validate against the declared schema ("off" = legacy parity mode).
    if (this.validation === "strict") {
      const problems = validateAgainstSchema(args, entry.definition.inputSchema);
      if (problems.length > 0) {
        return failure("ValidationError", problems.join("; "));
      }
    }

    // 5. Policy.
    if (this.policyEngine && !ctx.skipPolicy) {
      const decision = this.policyEngine.check({
        tool: entry.definition,
        args,
        agentId: ctx.agentId ?? "unknown",
        runId: ctx.runId ?? "unknown",
        mode: ctx.mode,
        unattended: ctx.unattended,
      });
      if (!decision.allowed) {
        return failure("PolicyDenied", decision.reason);
      }
      if (decision.requireConfirmation && !ctx.unattended && !ctx.confirmed) {
        // The gateway has no UX of its own: confirmation is surfaced as a
        // structured outcome so the embedding application (CLI/TUI approval
        // broker) can resolve it. Unattended runs bypass by contract.
        return {
          ok: false,
          data: { error: "ConfirmationRequired", message: decision.reason, args },
          error: { code: "ConfirmationRequired", message: decision.reason },
        };
      }
    }

    // 6. Concurrency lease (per-tool).
    const gate = this.gateFor(entry);

    // 7. Execute under timeout + abort.
    try {
      const data = await gate.run(() => this.withTimeout(entry, args), "normal", ctx.signal);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof ToolTimeoutError) return failure("Timeout", e.message);
      if (e instanceof ToolValidationError) return failure("ValidationError", e.message);
      if (e instanceof GateSaturatedError) return failure("ConcurrencyDenied", e.message);
      const err = e instanceof Error ? e : new Error(String(e));
      return failure(err.constructor.name, err.message);
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private resolve(name: string): ToolCatalogEntry | undefined {
    const canonical = canonicalToolName(name);
    const entry = this.catalog.get(canonical) ?? this.catalog.get(name);
    if (entry) return entry;
    const lower = canonical.toLowerCase();
    const found = this.catalog.ids().find((id) => id.toLowerCase() === lower);
    return found ? this.catalog.get(found) : undefined;
  }

  private gateFor(entry: ToolCatalogEntry): ConcurrencyGate {
    const key = entry.definition.id;
    let gate = this.gates.get(key);
    if (!gate) {
      gate = new ConcurrencyGate({
        maxConcurrent: entry.definition.execution.concurrency,
        label: `${this.label}:${key}`,
      });
      this.gates.set(key, gate);
    }
    return gate;
  }

  private withTimeout(entry: ToolCatalogEntry, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const timeoutMs = entry.definition.execution.timeoutMs;
    const task = entry.handler(args);

    if (!timeoutMs || timeoutMs <= 0) return task;

    return Promise.race([
      task,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new ToolTimeoutError(entry.definition.id, timeoutMs)), timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  }
}

// The gateway needs one more thing: an invocation-shaped helper that also
// stamps ids for tracing. Kept last so the class above stays the primary API.
export function makeToolInvocation(name: string, args: Record<string, unknown>): ToolInvocation {
  return { id: `ti_${randomUUID()}`, name, args };
}
