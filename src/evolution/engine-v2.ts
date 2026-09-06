/**
 * ClosedLoopEngine — the v2 top-level orchestrator for Nexum's
 * self-development loop.
 *
 * Extends the v1 EvolutionEngine pipeline (telemetry → diagnosis → planning →
 * candidate → benchmark → comparison → registry/PR) with the layers the
 * Self-Developing Agents research shows are required for a genuine
 * closed-loop RSI system:
 *
 *   TARGET layer      (Aspire-inspired target formation before planning)
 *   EXPERIENCE layer  (S³Gym-inspired evidence-grounded experience learning)
 *   SYSTEM layer      (HarnessDev-inspired persistent, auditable evolution)
 *
 * Three separated kinds of learning:
 *
 *   TASK LEARNING       → skills + lessons          (src/learning, existing)
 *   EXPERIENCE LEARNING → ExperienceStore + evidence (src/evolution/experience)
 *   HARNESS EVOLUTION   → experiments + acceptance   (this engine)
 */

import { Episode } from "../learning/types.js";
import { AcceptanceController } from "./acceptance/acceptance-controller.js";
import {
  TwoStageSelector,
  TwoStageResult,
  ExperimentValidity,
  DEFAULT_THRESHOLDS,
} from "./comparison/two-stage-selector.js";
import { GitDeliveryEngine, DeliveryReport, DeliveryPrOptions } from "./delivery.js";
import { HarnessDiagnoser } from "./diagnoser.js";
import { CandidateEvaluator, TaskExecutionResult } from "./evaluator.js";
import { ExecutorArm } from "./evaluation/fixed-executor.js";
import { GeneralizationGate, GeneralizationVerdict } from "./generalization/generalization-gate.js";
import { EvidenceAggregator } from "./experience/evidence-aggregator.js";
import { ExperienceRecord } from "./experience/types.js";
import { ExperienceStore } from "./experience/experience-store.js";
import { TrajectoryAnalyzer } from "./experience/trajectory-analyzer.js";
import { TransferAnalyzer } from "./experience/transfer-analyzer.js";
import { EvolutionMetricsTracker } from "./metrics.js";
import { MutationScopePolicy, MutationScope } from "./mutation/mutation-scope.js";
import { formulateHypothesis } from "./hypothesis.js";
import { EvolutionPlanner } from "./planner.js";
import { provenanceYamlCodeBlock } from "./experiments/provenance.js";
import { ExperimentController } from "./experiments/experiment-controller.js";
import { ExperimentRecord } from "./experiments/experiment-schema.js";
import { HarnessRegistry } from "./registry.js";
import { TargetEngine, ImprovementTarget } from "./targets/target-engine.js";
import { ComparisonResult, EvaluationMetrics, HarnessDiagnosis, HarnessHypothesis } from "./types.js";

export interface ClosedLoopEngineOptions {
  registry?: HarnessRegistry;
  experienceStore?: ExperienceStore;
  diagnoser?: HarnessDiagnoser;
  planner?: EvolutionPlanner;
  targetEngine?: TargetEngine;
  twoStageSelector?: TwoStageSelector;
  generalizationGate?: GeneralizationGate;
  mutationScopePolicy?: MutationScopePolicy;
  experimentController?: ExperimentController;
  evaluator?: CandidateEvaluator;
  delivery?: GitDeliveryEngine;
  metricsTracker?: EvolutionMetricsTracker;
  /** Executor models for the fixed-executor protocol (primary first). */
  executorModels?: string[];
}

export interface ClosedLoopDiagnosis {
  diagnoses: HarnessDiagnosis[];
  /** Aspire-style formed target (null = evidence too weak to operationalize). */
  target: ImprovementTarget | null;
  /** v1 plan for compatibility with existing tooling. */
  plan: ReturnType<EvolutionPlanner["createPlan"]>;
  /** Decided mutation scope (single-component by default; compound on escalation). */
  mutationScope: MutationScope | null;
}

export interface ExperimentOutcome {
  experiment: ExperimentRecord;
  comparison: ComparisonResult;
  twoStage: TwoStageResult;
  generalization: GeneralizationVerdict | null;
  delivery: DeliveryReport | null;
}

/**
 * The v2 closed-loop engine. All stages are explicit and independently
 * injectable for testing.
 */
export class ClosedLoopEngine {
  readonly diagnoser: HarnessDiagnoser;
  readonly planner: EvolutionPlanner;
  readonly targetEngine: TargetEngine;
  readonly twoStage: TwoStageSelector;
  readonly generalizationGate: GeneralizationGate;
  readonly scopePolicy: MutationScopePolicy;
  readonly experiments: ExperimentController;
  readonly evaluator: CandidateEvaluator;
  readonly delivery: GitDeliveryEngine;
  readonly metrics: EvolutionMetricsTracker;
  readonly registry?: HarnessRegistry;
  readonly experienceStore?: ExperienceStore;
  private readonly executorModels: string[];

  constructor(opts: ClosedLoopEngineOptions = {}) {
    this.diagnoser = opts.diagnoser ?? new HarnessDiagnoser();
    this.planner = opts.planner ?? new EvolutionPlanner();
    this.targetEngine = opts.targetEngine ?? new TargetEngine();
    this.twoStage = opts.twoStageSelector ?? new TwoStageSelector();
    this.generalizationGate = opts.generalizationGate ?? new GeneralizationGate();
    this.scopePolicy = opts.mutationScopePolicy ?? new MutationScopePolicy();
    this.experiments = opts.experimentController ?? new ExperimentController();
    this.evaluator = opts.evaluator ?? new CandidateEvaluator();
    this.delivery = opts.delivery ?? new GitDeliveryEngine();
    this.metrics = opts.metricsTracker ?? new EvolutionMetricsTracker();
    this.registry = opts.registry;
    this.experienceStore = opts.experienceStore;
    this.executorModels = opts.executorModels ?? ["primary"];
  }

  // ── Experience layer ────────────────────────────────────────────────────

  /** Converts graded episodes into evidence-bound experience records. */
  ingestExperience(episodes: Episode[], harnessVersion: string): ExperienceRecord[] {
    const analyzer = new TrajectoryAnalyzer({
      executorModel: this.executorModels[0],
      harnessVersion,
    });
    const records = analyzer.toExperienceRecords(episodes);
    for (const r of records) this.experienceStore?.save(r);
    return records;
  }

  /** Aggregates experience into per-task-class digests (multi-representation). */
  digestExperience(): ReturnType<EvidenceAggregator["digestAll"]> {
    const aggregator = new EvidenceAggregator();
    const records = this.experienceStore ? this.experienceStore.listAll() : [];
    return aggregator.digestAll(records);
  }

  /** Transfer analysis over stored experience (cross-class / cross-model). */
  analyzeTransfer(): ReturnType<TransferAnalyzer["analyze"]> {
    const analyzer = new TransferAnalyzer();
    const records = this.experienceStore ? this.experienceStore.listAll() : [];
    return analyzer.analyze(records);
  }

  // ── Diagnosis → Target → Scope ──────────────────────────────────────────

  /**
   * Full observation pipeline: episodes → diagnoses → TARGET FORMATION →
   * plan + mutation scope. This is where "what capability is actually
   * failing?" is answered before "which file should I change?".
   */
  observe(episodes: Episode[]): ClosedLoopDiagnosis {
    const diagnoses: HarnessDiagnosis[] = [];
    for (const ep of episodes) {
      const diag = this.diagnoser.diagnoseEpisode(ep);
      if (diag) diagnoses.push(diag);
    }

    const target = this.targetEngine.formTarget(diagnoses);
    const plan = this.planner.createPlan(diagnoses);

    let mutationScope: MutationScope | null = null;
    if (target && plan) {
      mutationScope = this.scopePolicy.decideScope(target, plan.targetComponent);
    }

    return { diagnoses, target, plan, mutationScope };
  }

  // ── Experiment execution ────────────────────────────────────────────────

  /**
   * Runs the full evaluation experiment for a candidate harness:
   * two-stage gates → fixed-executor generalization → experiment record →
   * delivery preparation. Promotion is never declared: the returned outcome
   * is ELIGIBLE at most, and becomes ACTIVE only through the acceptance
   * pipeline (CI + review + activation).
   */
  runExperiment(input: {
    experimentId: string;
    parentHarnessId: string;
    parentCommit: string;
    candidateHarnessId: string;
    candidateCommit: string;
    target: ImprovementTarget;
    diagnosis: HarnessDiagnosis;
    scope: MutationScope;
    /** Candidate results on the visible+held-out suite (primary executor). */
    candidateResults: TaskExecutionResult[];
    /** Baseline results on the same suite (primary executor). */
    baselineResults: TaskExecutionResult[];
    /** Fixed-executor matrix cells (candidate + baseline × executors). */
    matrixCells?: Parameters<GeneralizationGate["evaluate"]>[0];
  }): ExperimentOutcome {
    // 1. Metrics & baseline resolution.
    const candidateMetrics = this.evaluator.aggregateResults(input.candidateResults);
    const baselineMetrics = this.evaluator.aggregateResults(input.baselineResults);

    // 2. Two-stage selection (Stage A validity → Stage B improvement).
    const validity = deriveValidity(input.candidateResults, input.baselineResults);
    const twoStage = this.twoStage.evaluate({
      candidateId: input.candidateHarnessId,
      baselineId: input.parentHarnessId,
      candidateMetrics,
      baselineMetrics,
      validity,
    });

    // 3. Generalization gate over the fixed-executor matrix.
    let generalization: GeneralizationVerdict | null = null;
    if (input.matrixCells && input.matrixCells.length > 0) {
      const transferExecutors = this.executorModels.slice(1);
      generalization = this.generalizationGate.evaluate(
        input.matrixCells,
        input.parentHarnessId,
        input.candidateHarnessId,
        transferExecutors,
      );
    }

    const eligible = twoStage.decision === "eligible" && (generalization === null || generalization.generalized);

    // 4. Start the experiment lifecycle and persist the decision.
    const hypothesis: HarnessHypothesis = formulateHypothesis(input.diagnosis);
    this.experiments.startExperiment({
      id: input.experimentId,
      parentHarness: input.parentHarnessId,
      parentCommit: input.parentCommit,
      candidateHarness: input.candidateHarnessId,
      candidateCommit: input.candidateCommit,
      targetId: input.target.id,
      targetCapability: input.target.capability,
      desiredOutcome: input.target.desiredOutcome,
      hypothesisId: hypothesis.id,
      hypothesisStatement: hypothesis.statement,
      predictedEffect: hypothesis.predictedEffect,
      executorPrimary: this.executorModels[0],
      executorTransfer: this.executorModels.slice(1),
      scopeComponents: [...input.scope.components],
    });
    this.experiments.reportEvaluation(
      input.experimentId,
      {
        visible: pickRates(candidateMetrics, "visible"),
        held_out: pickRates(candidateMetrics, "held_out"),
        transfer: pickRates(candidateMetrics, "transfer"),
      },
      {
        capability: twoStage.stageB?.deltas.capability ?? 0,
        reliability: twoStage.stageB?.deltas.reliability ?? 0,
        efficiency: twoStage.stageB?.deltas.efficiency ?? 0,
        generalization: twoStage.stageB?.deltas.generalization ?? 0,
      },
    );
    this.experiments.reportDecision(input.experimentId, {
      result: eligible ? "eligible" : twoStage.decision === "eligible" ? "inconclusive" : twoStage.decision,
      stageA: twoStage.stageA.decision,
      stageB: twoStage.stageB?.decision ?? "not_run",
      rationale: generalization
        ? `${twoStage.rationale} Generalization: ${generalization.rationale}`
        : twoStage.rationale,
    });

    // 5. Advance the state machine: EVALUATING → VALIDATED → (GENERALIZED) → ELIGIBLE.
    this.experiments.advance(input.experimentId, "EVALUATING", "Benchmark suite executed");
    const acceptance = new AcceptanceController(this.experiments.machine(input.experimentId));
    const validated = acceptance.validate({ twoStagePassed: twoStage.decision === "eligible" });
    if (validated.ok && generalization) {
      acceptance.generalize({ generalizationPassed: generalization.generalized });
    } else if (validated.ok) {
      // No fixed-executor matrix supplied: gate is non-blocking but recorded.
      acceptance.generalize({ generalizationPassed: true });
    }
    if (acceptance.current() === "eligible") {
      acceptance.deliver();
    }

    // 6. Persist the version in the registry with the legacy status mapping.
    let comparison: ComparisonResult = {
      candidateId: input.candidateHarnessId,
      baselineId: input.parentHarnessId,
      decision: eligible ? "promote" : twoStage.decision === "rejected" ? "reject" : "inconclusive",
      scoreDeltas: twoStage.stageB?.deltas ?? { capability: 0, reliability: 0, efficiency: 0, generalization: 0 },
      rationale: twoStage.rationale,
    };

    if (this.registry) {
      this.registry.saveVersion({
        id: input.candidateHarnessId,
        commitSha: input.candidateCommit,
        parentId: input.parentHarnessId,
        createdAt: Date.now(),
        targetComponent: input.scope.components[0],
        hypothesis: hypothesis.statement,
        metrics: candidateMetrics,
        status: eligible ? "validated" : twoStage.decision === "rejected" ? "rejected" : "candidate",
      });
    }

    // 7. Delivery (branch + commit + PR with provenance) for eligible candidates.
    let deliveryReport: DeliveryReport | null = null;
    if (eligible) {
      const deliveryOpts: DeliveryPrOptions = {
        version: {
          id: input.candidateHarnessId,
          commitSha: input.candidateCommit,
          parentId: input.parentHarnessId,
          createdAt: Date.now(),
          targetComponent: input.scope.components[0],
          hypothesis: hypothesis.statement,
          metrics: candidateMetrics,
          status: "validated",
        },
        hypothesis,
        comparison,
      };
      deliveryReport = this.delivery.prepareDelivery(deliveryOpts);
      const record = this.experiments.record(input.experimentId);
      deliveryReport = {
        ...deliveryReport,
        prBody: [deliveryReport.prBody, provenanceYamlCodeBlock(record)].join("\n\n"),
      };
      // DELIVERED → REVIEWED: the delivery exists and now awaits CI + review.
      this.experiments.advance(input.experimentId, "REVIEWED", "Delivery prepared; awaiting CI and review");
    }

    // 8. Record the version switch for promotion-precision accounting.
    this.metrics.record({
      versionId: input.candidateHarnessId,
      parentVersionId: input.parentHarnessId,
      visibleGain: twoStage.stageB?.deltas.capability ?? 0,
      heldOutGain: candidateMetrics.generalization.heldOutScore - baselineMetrics.generalization.heldOutScore,
      transferGain: candidateMetrics.generalization.transferScore - baselineMetrics.generalization.transferScore,
      promoted: eligible,
      genuinelyBetterOnHeldOut:
        generalization === null
          ? eligible
          : generalization.generalized && (twoStage.stageB?.deltas.generalization ?? 0) > 0,
      accepted: false,
      rolledBack: false,
      retainedBySuccessor: "unknown",
      executorModels: [...this.executorModels],
      executorSensitivity: generalization?.executorSensitivity ?? 0,
    });

    const experiment = this.experiments.record(input.experimentId);
    return { experiment, comparison, twoStage, generalization, delivery: deliveryReport };
  }

  /** CI feedback hook (DELIVERED → CI_FAILED or progress to REVIEWED/ACCEPTED). */
  reportCi(experimentId: string, passed: boolean, runUrl?: string): void {
    this.experiments.reportCiResult(experimentId, passed ? "passed" : "failed", runUrl);
  }

  /** Review feedback hook (REVIEWED → ACCEPTED or CHANGES_REQUESTED). */
  reportReview(experimentId: string, approved: boolean, reviewer?: string): void {
    this.experiments.reportReviewOutcome(experimentId, approved ? "approved" : "changes_requested", reviewer);
  }

  /** Completes acceptance: REVIEWED → ACCEPTED → ACTIVE and updates the registry. */
  finalizeAcceptance(experimentId: string): boolean {
    const machine = this.experiments.machine(experimentId);
    if (machine.current() !== "REVIEWED") return false;
    const record = this.experiments.record(experimentId);
    machine.transition("ACCEPTED", "Review approved");
    machine.transition("ACTIVE", "Candidate is the active harness");
    record.lifecycle = { state: "ACTIVE", enteredAt: Date.now() };
    if (this.registry) {
      this.registry.promoteVersion(record.candidate.harness);
    }
    const switchRecord = this.metrics.records().find((s) => s.versionId === record.candidate.harness);
    if (switchRecord) switchRecord.accepted = true;
    return true;
  }

  /** Post-deployment regression hook: ACTIVE → REGRESSED → ROLLBACK (+ registry). */
  handleRegression(experimentId: string, detail: string): void {
    this.experiments.reportRegression(experimentId, detail);
    this.experiments.completeRollback(experimentId, this.experiments.record(experimentId).parent.harness);
    const record = this.experiments.record(experimentId);
    if (this.registry) {
      this.registry.rollbackTo(record.parent.harness);
    }
    const switchRecord = this.metrics.records().find((s) => s.versionId === record.candidate.harness);
    if (switchRecord) {
      switchRecord.rolledBack = true;
      switchRecord.retainedBySuccessor = false;
    }
  }
}

/** Derives Stage-A experiment validity facts from raw runs. */
export function deriveValidity(
  candidateResults: TaskExecutionResult[],
  baselineResults: TaskExecutionResult[],
): ExperimentValidity {
  const completed = candidateResults.length;
  const verifierCovered = candidateResults.filter((r) => r.verificationPassed !== undefined).length;
  const ranVerification = candidateResults.filter((r) => r.verificationPassed).length;
  const coverage = completed > 0 ? ranVerification / completed : 0;
  const baselineSuccess =
    baselineResults.length > 0 ? baselineResults.filter((r) => r.success).length / baselineResults.length : 0;
  const candidateSuccess = completed > 0 ? candidateResults.filter((r) => r.success).length / completed : 0;
  const catastrophic = baselineSuccess - candidateSuccess > DEFAULT_THRESHOLDS.catastrophicRegressionThreshold;
  return {
    completedRuns: completed,
    verifierCoveredRuns: verifierCovered,
    verifierCoverage: coverage,
    catastrophicRegression: catastrophic,
  };
}

function pickRates(metrics: EvaluationMetrics, split: "visible" | "held_out" | "transfer"): Record<string, number> {
  if (split === "held_out") return { heldOutScore: metrics.generalization.heldOutScore };
  if (split === "transfer") return { transferScore: metrics.generalization.transferScore };
  return {
    taskSuccessRate: metrics.capability.taskSuccessRate,
    verificationPassRate: metrics.capability.verificationPassRate,
  };
}

export type { ExecutorArm };
