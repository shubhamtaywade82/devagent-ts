/**
 * PolicyEngine — answers "may this agent execute this tool now?".
 *
 * Pure decision layer: given a policy request (tool definition + arguments +
 * agent/run identity), return a PolicyDecision. The ToolGateway enforces the
 * decision; the engine never executes anything itself.
 *
 * Ships with a rule-based default engine (RulePolicyEngine) implementing the
 * baseline posture:
 *   - deny rules always win
 *   - mode restrictions (e.g. "ask" mode denies mutating tools)
 *   - risk >= requireConfirmationFor → human confirmation required
 *   - financial side effects always require confirmation
 *   - everything else is auto-approved
 */

import { ToolDefinition, ToolRisk, toolRiskAtLeast } from "../tools/tool-definition.js";

export type AgentModePolicy = "ask" | "code" | "architect" | "review" | "debug" | "autonomous";

export interface PolicyRequest {
  tool: ToolDefinition;
  args: Record<string, unknown>;
  agentId: string;
  runId: string;
  /** Current agent mode, when the embedding application tracks one. */
  mode?: AgentModePolicy | string;
  /** True when the operator asked for fully unattended execution. */
  unattended?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  requireConfirmation: boolean;
  reason: string;
  /** Which rule produced this decision (observability / audit trail). */
  rule?: string;
}

export interface PolicyEngine {
  check(request: PolicyRequest): PolicyDecision;
}

// ── Rules ───────────────────────────────────────────────────────────────────

export interface PolicyRule {
  id: string;
  description: string;
  /** Return a decision to stop the chain, or null to defer to the next rule. */
  evaluate(request: PolicyRequest): PolicyDecision | null;
}

const ALLOW: PolicyDecision = { allowed: true, requireConfirmation: false, reason: "no rule matched" };

export class DenyToolsRule implements PolicyRule {
  readonly id = "deny-tools";
  readonly description = "Denies explicitly listed tool ids.";

  constructor(private readonly deniedToolIds: readonly string[]) {}

  evaluate(request: PolicyRequest): PolicyDecision | null {
    if (!this.deniedToolIds.includes(request.tool.id)) return null;
    return {
      allowed: false,
      requireConfirmation: false,
      reason: `tool "${request.tool.id}" is denied by policy`,
      rule: this.id,
    };
  }
}

export class DenyRiskAboveRule implements PolicyRule {
  readonly id = "deny-risk-above";
  readonly description = "Denies tools whose risk meets or exceeds a ceiling.";

  constructor(private readonly ceiling: ToolRisk) {}

  evaluate(request: PolicyRequest): PolicyDecision | null {
    if (!toolRiskAtLeast(request.tool.risk, this.ceiling)) return null;
    return {
      allowed: false,
      requireConfirmation: false,
      reason: `tool "${request.tool.id}" risk "${request.tool.risk}" exceeds ceiling "${this.ceiling}"`,
      rule: this.id,
    };
  }
}

/** In "ask"/"review" style modes, mutating tools are not allowed at all. */
export class ModeRestrictionRule implements PolicyRule {
  readonly id = "mode-restriction";
  readonly description = "Denies side-effecting tools in read-only agent modes.";

  private static readonly READ_ONLY_MODES = new Set(["ask", "review"]);

  evaluate(request: PolicyRequest): PolicyDecision | null {
    if (!request.mode || !ModeRestrictionRule.READ_ONLY_MODES.has(request.mode)) return null;
    const { sideEffects } = request.tool;
    const mutating =
      sideEffects.filesystem || sideEffects.process || sideEffects.externalMutation || sideEffects.financial;
    if (!mutating) return null;
    return {
      allowed: false,
      requireConfirmation: false,
      reason: `agent mode "${request.mode}" is read-only; tool "${request.tool.id}" mutates state`,
      rule: this.id,
    };
  }
}

export class ConfirmationRule implements PolicyRule {
  readonly id = "confirmation";
  readonly description = "Requires confirmation based on tool policy and risk posture.";

  constructor(
    private readonly requireConfirmationFor: ToolRisk = "high",
    private readonly financialAlwaysRequiresConfirmation = true,
  ) {}

  evaluate(request: PolicyRequest): PolicyDecision | null {
    const { tool } = request;

    // Financial side effects are checked BEFORE the tool-declared opt-out:
    // a tool that moves money can never silently bypass confirmation, no
    // matter what its own policy spec claims.
    if (this.financialAlwaysRequiresConfirmation && tool.sideEffects.financial) {
      return {
        allowed: true,
        requireConfirmation: true,
        reason: `tool "${tool.id}" has financial side effects`,
        rule: this.id,
      };
    }

    if (tool.policy.confirmation === "never") return null;

    if (toolRiskAtLeast(tool.risk, this.requireConfirmationFor)) {
      return {
        allowed: true,
        requireConfirmation: true,
        reason: `tool "${tool.id}" risk "${tool.risk}" >= "${this.requireConfirmationFor}"`,
        rule: this.id,
      };
    }

    if (tool.policy.confirmation === "required") {
      return {
        allowed: true,
        requireConfirmation: true,
        reason: `tool "${tool.id}" declares confirmation: required`,
        rule: this.id,
      };
    }

    return null;
  }
}

// ── Default engine ──────────────────────────────────────────────────────────

export interface RulePolicyEngineOptions {
  rules?: PolicyRule[];
  /** Risk floor that triggers confirmation (default "high"). */
  requireConfirmationFor?: ToolRisk;
  /** Explicit deny list of tool ids. */
  deniedToolIds?: readonly string[];
  /** Ceiling beyond which tools are outright denied (optional). */
  denyRiskAbove?: ToolRisk;
}

export class RulePolicyEngine implements PolicyEngine {
  private readonly rules: PolicyRule[];

  constructor(opts: RulePolicyEngineOptions = {}) {
    this.rules = [...(opts.rules ?? [])];
    if (opts.denyRiskAbove) this.rules.push(new DenyRiskAboveRule(opts.denyRiskAbove));
    if (opts.deniedToolIds?.length) this.rules.push(new DenyToolsRule(opts.deniedToolIds));
    this.rules.push(new ModeRestrictionRule());
    this.rules.push(new ConfirmationRule(opts.requireConfirmationFor));
  }

  check(request: PolicyRequest): PolicyDecision {
    for (const rule of this.rules) {
      const decision = rule.evaluate(request);
      if (decision) return decision;
    }
    return { ...ALLOW, rule: "default-allow" };
  }
}

/** Permissive engine for headless/embedded use. */
export class AllowAllPolicyEngine implements PolicyEngine {
  check(): PolicyDecision {
    return { allowed: true, requireConfirmation: false, reason: "allow-all engine", rule: "allow-all" };
  }
}
