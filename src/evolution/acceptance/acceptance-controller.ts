/**
 * AcceptanceController — the explicit acceptance pipeline for harness changes.
 *
 * Replaces the v1 "declared promotion" flow. The research conclusion is that
 * the critical question is not "can the agent make a change?" but "which
 * changes should persist?" — so the v1 promote concept is decomposed into a
 * pipeline of named stages with an explicit audit trail:
 *
 *   candidate → validated → eligible → delivered → accepted → active
 *
 * Each stage transition is refused unless the evidence for that stage is
 * present. `promoteVersion`-style declarations are structurally impossible.
 */

import { EvolutionStateMachine } from "../state-machine.js";

export interface StageEvidence {
  /** Two-stage comparator passed (Stage A validity + Stage B improvement). */
  twoStagePassed?: boolean;
  /** Generalization gate passed (held-out + fixed-executor transfer). */
  generalizationPassed?: boolean;
  /** Delivery report produced (branch, commit, PR). */
  delivered?: boolean;
  /** CI passed on the delivered branch. */
  ciPassed?: boolean;
  /** Human review approved. */
  reviewApproved?: boolean;
}

export interface AcceptanceStepResult {
  ok: boolean;
  from: string;
  to: string;
  reason?: string;
}

export type AcceptanceStage = "candidate" | "validated" | "eligible" | "delivered" | "accepted" | "active";

/**
 * Tracks one candidate through the acceptance pipeline. The EvolutionStateMachine
 * enforces legal moves; this controller attaches the evidence requirements for
 * each forward move and records the audit trail.
 */
export class AcceptanceController {
  private readonly machine: EvolutionStateMachine;
  private readonly evidence: StageEvidence = {};

  constructor(machine?: EvolutionStateMachine) {
    this.machine = machine ?? new EvolutionStateMachine("CANDIDATE");
  }

  current(): AcceptanceStage {
    return this.machine.current().toLowerCase() as AcceptanceStage;
  }

  /** Stage A + Stage B validated → VALIDATED. Enters EVALUATING first if needed. */
  validate(evidence: Pick<StageEvidence, "twoStagePassed">): AcceptanceStepResult {
    if (this.machine.current() === "CANDIDATE") {
      this.machine.transition("EVALUATING", "Benchmark suite executed");
    }
    if (this.machine.current() !== "EVALUATING") {
      return {
        ok: false,
        from: this.machine.current(),
        to: "VALIDATED",
        reason: `Cannot validate from state ${this.machine.current()}`,
      };
    }
    if (!evidence.twoStagePassed) {
      return {
        ok: false,
        from: this.machine.current(),
        to: "VALIDATED",
        reason: "Two-stage comparison has not passed",
      };
    }
    this.evidence.twoStagePassed = true;
    return this.step("VALIDATED", "Stage A + Stage B passed");
  }

  /** Generalization gate passed → GENERALIZED → ELIGIBLE. */
  generalize(evidence: Pick<StageEvidence, "generalizationPassed">): AcceptanceStepResult {
    if (this.machine.current() !== "VALIDATED") {
      return {
        ok: false,
        from: this.machine.current(),
        to: "GENERALIZED",
        reason: `Cannot generalize from state ${this.machine.current()}`,
      };
    }
    if (!evidence.generalizationPassed) {
      return {
        ok: false,
        from: this.machine.current(),
        to: "GENERALIZED",
        reason: "Generalization gate has not passed",
      };
    }
    this.evidence.generalizationPassed = true;
    const step = this.step("GENERALIZED", "Held-out + fixed-executor transfer verified");
    if (!step.ok) return step;
    return this.step("ELIGIBLE", "Candidate eligible for delivery");
  }

  /** Delivery prepared (branch + commit + PR) → DELIVERED. */
  deliver(): AcceptanceStepResult {
    if (this.machine.current() !== "ELIGIBLE") {
      return {
        ok: false,
        from: this.machine.current(),
        to: "DELIVERED",
        reason: `Cannot deliver from state ${this.machine.current()}`,
      };
    }
    this.evidence.delivered = true;
    return this.step("DELIVERED", "Evolution branch + draft PR prepared");
  }

  /** CI passed on the delivered branch → REVIEWED → ACCEPTED. */
  accept(ciPassed: boolean, reviewApproved: boolean): AcceptanceStepResult {
    const from = this.machine.current();
    if (from !== "DELIVERED" && from !== "REVIEWED") {
      return { ok: false, from, to: "ACCEPTED", reason: `Cannot accept from state ${from}` };
    }
    if (!ciPassed) {
      return {
        ok: false,
        from: this.machine.current(),
        to: "ACCEPTED",
        reason: "CI has not passed on the delivered branch",
      };
    }
    this.evidence.ciPassed = true;
    if (this.machine.current() === "DELIVERED") {
      const reviewStep = this.step("REVIEWED", "CI passed; awaiting review outcome");
      if (!reviewStep.ok) return reviewStep;
    }
    if (!reviewApproved) {
      return {
        ok: false,
        from: this.machine.current(),
        to: "ACCEPTED",
        reason: "Review has not approved the candidate",
      };
    }
    this.evidence.reviewApproved = true;
    return this.step("ACCEPTED", "Review approved");
  }

  /** ACCEPTED → ACTIVE (the candidate becomes the running harness). */
  activate(): AcceptanceStepResult {
    if (this.machine.current() !== "ACCEPTED") {
      return {
        ok: false,
        from: this.machine.current(),
        to: "ACTIVE",
        reason: `Cannot activate from state ${this.machine.current()}`,
      };
    }
    return this.step("ACTIVE", "Candidate is now the active harness version");
  }

  /** Underlying machine (for audit trail / timeline serialization). */
  getMachine(): EvolutionStateMachine {
    return this.machine;
  }

  private step(to: Parameters<EvolutionStateMachine["transition"]>[0], note: string): AcceptanceStepResult {
    try {
      this.machine.transition(to, note);
      return { ok: true, from: this.machine.current(), to };
    } catch (err) {
      return { ok: false, from: this.machine.current(), to, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
