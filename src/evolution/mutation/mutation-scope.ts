/**
 * Mutation Scope Policy for Nexum harness evolution.
 *
 * The v1 rule was "single component only" — great for causal attribution, but
 * real harness improvements frequently cross subsystem boundaries (e.g.
 * "better tool selection" may require context representation + tool schema
 * generation + execution policy changes together).
 *
 * This module implements the escalation policy:
 *
 *   DEFAULT:   mutation scope = 1 component (causal attribution preserved)
 *   ESCALATED: mutation scope = N components (compound hypothesis)
 *
 * Escalation requires EVIDENCE: repeated single-component experiments targeting
 * the same capability that failed to move the target. The escalation count is
 * tracked per capability area; after `escalationThreshold` consecutive
 * single-component failures, a compound hypothesis is permitted — targeting
 * the affected components identified by the TargetEngine.
 */

import { HarnessComponent } from "../types.js";
import { CapabilityArea, ImprovementTarget } from "../targets/target-engine.js";

export type MutationScopeKind = "single_component" | "compound";

export interface MutationScope {
  kind: MutationScopeKind;
  /** Components this mutation is allowed to touch, in experiment order. */
  components: HarnessComponent[];
  /** Why this scope was chosen (audit trail for the experiment record). */
  rationale: string;
  /** When escalating: how many single-component attempts preceded this. */
  escalatedAfterAttempts?: number;
}

export interface ScopeAttemptRecord {
  capability: CapabilityArea;
  component: HarnessComponent;
  /** Did the single-component experiment move the target metric? */
  movedTarget: boolean;
  experimentId: string;
  at: number;
}

export interface MutationScopePolicyOptions {
  /** Consecutive failed single-component attempts before escalation is allowed. */
  escalationThreshold?: number;
  /** Maximum components a compound mutation may span. */
  maxCompoundComponents?: number;
}

export class MutationScopePolicy {
  private readonly escalationThreshold: number;
  private readonly maxCompoundComponents: number;
  /** capability → chronological single-component attempts. */
  private attempts = new Map<CapabilityArea, ScopeAttemptRecord[]>();

  constructor(opts: MutationScopePolicyOptions = {}) {
    this.escalationThreshold = opts.escalationThreshold ?? 2;
    this.maxCompoundComponents = opts.maxCompoundComponents ?? 4;
  }

  /** Records the outcome of a completed experiment for scope accounting. */
  recordAttempt(attempt: ScopeAttemptRecord): void {
    const list = this.attempts.get(attempt.capability) ?? [];
    list.push(attempt);
    this.attempts.set(attempt.capability, list);
  }

  /**
   * Consecutive failed single-component attempts for a capability, counting
   * backwards from the most recent attempt.
   */
  consecutiveFailures(capability: CapabilityArea): number {
    const list = this.attempts.get(capability) ?? [];
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].movedTarget) break;
      n++;
    }
    return n;
  }

  /**
   * Decides the mutation scope for the next experiment against `target`.
   *
   * - Default: single-component, anchored on the component the diagnoser
   *   blamed (the first affected component).
   * - Escalation: after `escalationThreshold` consecutive single-component
   *   failures against the same capability, the scope expands to the
   *   cross-component set identified by the TargetEngine (bounded by
   *   `maxCompoundComponents`).
   */
  decideScope(target: ImprovementTarget, primaryComponent: HarnessComponent): MutationScope {
    const failures = this.consecutiveFailures(target.capability);

    if (failures < this.escalationThreshold) {
      return {
        kind: "single_component",
        components: [primaryComponent],
        rationale:
          failures === 0
            ? `Single-component scope (default) targeting ${primaryComponent} for capability ${target.capability}.`
            : `Single-component scope retained (${failures} prior failure(s) below escalation threshold ${this.escalationThreshold}).`,
        escalatedAfterAttempts: failures,
      };
    }

    const components = this.compoundComponents(target, primaryComponent);
    return {
      kind: "compound",
      components,
      rationale: `Escalated to compound scope after ${failures} consecutive single-component experiments failed to move capability "${target.capability}". Compound hypothesis spans: ${components.join(" + ")}.`,
      escalatedAfterAttempts: failures,
    };
  }

  /** Bounded, ordered component set for a compound mutation. */
  private compoundComponents(target: ImprovementTarget, primary: HarnessComponent): HarnessComponent[] {
    const valid = new Set<string>([
      "execution",
      "tools",
      "context",
      "state",
      "lifecycle",
      "verification",
      "routing",
      "memory",
    ]);
    const ordered: HarnessComponent[] = [primary];
    for (const c of target.affectedComponents) {
      if (ordered.length >= this.maxCompoundComponents) break;
      if (valid.has(c) && !ordered.includes(c as HarnessComponent)) {
        ordered.push(c as HarnessComponent);
      }
    }
    return ordered;
  }
}
