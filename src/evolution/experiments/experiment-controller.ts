/**
 * ExperimentController — orchestrates one harness mutation as a full scientific
 * experiment rather than a single function call.
 *
 * The controller owns the experiment's lifecycle state machine, persists the
 * provenance record at every stage, and exposes the control points external
 * reality feeds back through:
 *
 *   - reportCiResult()      — GitHub CI on the evolution branch passed/failed
 *   - reportReviewOutcome() — human review approved / requested changes
 *   - reportRegression()    — post-deployment monitoring detected regression
 *
 * Promotion is never "declared": a candidate becomes ACTIVE only after
 * EVALUATING → VALIDATED → GENERALIZED → ELIGIBLE → DELIVERED → REVIEWED →
 * ACCEPTED → ACTIVE, with each transition persisted.
 */

import { EvolutionState, EvolutionStateMachine, StateTransitionResult } from "../state-machine.js";
import {
  ExperimentCiStatus,
  ExperimentDecision,
  ExperimentRecord,
  ExperimentReviewState,
} from "./experiment-schema.js";
import { ExperimentStore } from "./experiment-store.js";

export interface ExperimentControllerOptions {
  store?: ExperimentStore;
}

export interface StartExperimentInput {
  id: string;
  parentHarness: string;
  parentCommit: string;
  candidateHarness: string;
  candidateCommit: string;
  targetId: string;
  targetCapability: string;
  desiredOutcome: string;
  hypothesisId: string;
  hypothesisStatement: string;
  predictedEffect: string;
  executorPrimary: string;
  executorTransfer: string[];
  /** Mutation scope components (single-component default, compound escalation). */
  scopeComponents?: string[];
}

/**
 * Handles the full lifecycle of a single experiment. Works fully in-memory
 * when no store is provided (tests, dry runs); persists provenance otherwise.
 */
export class ExperimentController {
  private readonly machines = new Map<string, EvolutionStateMachine>();
  private readonly records = new Map<string, ExperimentRecord>();
  private readonly store?: ExperimentStore;

  constructor(opts: ExperimentControllerOptions = {}) {
    this.store = opts.store;
  }

  /** Creates the experiment record and advances OBSERVED → … → CANDIDATE. */
  startExperiment(input: StartExperimentInput): { record: ExperimentRecord; state: EvolutionState } {
    const machine = new EvolutionStateMachine("OBSERVED");
    machine.transition("DIAGNOSED", `Target formed: ${input.targetCapability}`);
    machine.transition("TARGETED", `Target ${input.targetId} operationalized`);
    machine.transition("HYPOTHESIS", `Hypothesis ${input.hypothesisId}`);
    machine.transition("CANDIDATE", `Candidate harness ${input.candidateHarness} prepared`);

    const record: ExperimentRecord = {
      id: input.id,
      parent: { harness: input.parentHarness, commit: input.parentCommit },
      candidate: { harness: input.candidateHarness, commit: input.candidateCommit },
      target: {
        targetId: input.targetId,
        capability: input.targetCapability,
        desiredOutcome: input.desiredOutcome,
      },
      hypothesis: {
        id: input.hypothesisId,
        statement: input.hypothesisStatement,
        predictedEffect: input.predictedEffect,
      },
      executor: {
        primary: input.executorPrimary,
        transfer: [...input.executorTransfer],
      },
      evaluation: { visible: {}, held_out: {}, transfer: {} },
      metrics: { capability: 0, reliability: 0, efficiency: 0, generalization: 0 },
      decision: {
        result: "inconclusive",
        stageA: "not_run",
        stageB: "not_run",
        rationale: "Experiment created; evaluation not yet run.",
      },
      ci: { status: "pending" },
      review: { state: "pending" },
      lifecycle: { state: machine.current(), enteredAt: Date.now() },
      scopeComponents: input.scopeComponents ? [...input.scopeComponents] : undefined,
      createdAt: Date.now(),
    };

    this.machines.set(input.id, machine);
    this.records.set(input.id, record);
    this.persist(record);
    return { record, state: machine.current() };
  }

  machine(experimentId: string): EvolutionStateMachine {
    const m = this.machines.get(experimentId);
    if (!m) throw new Error(`Unknown experiment: ${experimentId}`);
    return m;
  }

  record(experimentId: string): ExperimentRecord {
    const r = this.records.get(experimentId);
    if (!r) throw new Error(`Unknown experiment: ${experimentId}`);
    return r;
  }

  /** Advances the experiment through an arbitrary legal transition with audit note. */
  advance(experimentId: string, to: EvolutionState, note?: string): StateTransitionResult {
    const machine = this.machine(experimentId);
    const result = machine.transition(to, note);
    const record = this.record(experimentId);
    record.lifecycle = { state: machine.current(), enteredAt: Date.now() };
    this.persist(record);
    return result;
  }

  /** Records evaluation results and the two-stage decision into the provenance. */
  reportDecision(experimentId: string, decision: ExperimentDecision): void {
    const record = this.record(experimentId);
    record.decision = decision;
    this.persist(record);
  }

  reportEvaluation(
    experimentId: string,
    evaluation: ExperimentRecord["evaluation"],
    metrics: ExperimentRecord["metrics"],
  ): void {
    const record = this.record(experimentId);
    record.evaluation = evaluation;
    record.metrics = metrics;
    this.persist(record);
  }

  /** CI feedback from the delivered evolution branch. */
  reportCiResult(experimentId: string, status: ExperimentCiStatus, runUrl?: string): void {
    const record = this.record(experimentId);
    record.ci = { status, runUrl };
    if (status === "failed") {
      this.advance(experimentId, "CI_FAILED", `CI failed: ${runUrl ?? "no run url"}`);
    }
    this.persist(record);
  }

  /** Human review feedback on the delivered PR. */
  reportReviewOutcome(experimentId: string, state: ExperimentReviewState, reviewer?: string): void {
    const record = this.record(experimentId);
    record.review = { state, reviewer };
    if (state === "changes_requested") {
      this.advance(experimentId, "CHANGES_REQUESTED", `Review by ${reviewer ?? "unknown"} requested changes`);
    }
    this.persist(record);
  }

  /** Post-deployment regression monitoring feedback. */
  reportRegression(experimentId: string, detail: string): void {
    this.advance(experimentId, "REGRESSED", detail);
  }

  /** Completes a rollback after regression (REGRESSED → ROLLBACK → ACTIVE(prior)). */
  completeRollback(experimentId: string, restoredHarness: string): void {
    this.advance(experimentId, "ROLLBACK", `Rolled back to ${restoredHarness}`);
  }

  /** Returns experiments currently in a given lifecycle state. */
  listInState(state: EvolutionState): ExperimentRecord[] {
    if (this.store) return this.store.listByLifecycleState(state);
    const out: ExperimentRecord[] = [];
    for (const [id, m] of this.machines.entries()) {
      if (m.current() === state) out.push(this.records.get(id)!);
    }
    return out;
  }

  /** Promotion precision inputs: counts of accepted vs eligible experiments. */
  acceptanceCounts(): { eligible: number; accepted: number; rejected: number } {
    let eligible = 0;
    let accepted = 0;
    let rejected = 0;
    const all = this.store ? this.store.listAll() : [...this.records.values()];
    for (const r of all) {
      const s = r.lifecycle.state;
      if (s === "ELIGIBLE" || s === "DELIVERED" || s === "REVIEWED" || s === "ACCEPTED") eligible++;
      if (s === "ACCEPTED" || s === "ACTIVE" || s === "REGRESSED" || s === "ROLLBACK") accepted++;
      if (s === "REJECTED") rejected++;
    }
    return { eligible, accepted, rejected };
  }

  private persist(record: ExperimentRecord): void {
    this.store?.upsert(record);
  }
}
