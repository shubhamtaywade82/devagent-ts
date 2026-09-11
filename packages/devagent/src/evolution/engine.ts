/**
 * Top-level Evolution Engine for Nexum Harness Self-Development.
 *
 * Coordinates the meta-evolutionary closed loop:
 * Execution Telemetry -> Failure Diagnoser -> Evolution Planner ->
 * Candidate Evaluator -> Multi-Objective Comparator -> Registry & Delivery.
 */

import { Episode } from "../learning/types.js";
import { CandidateComparator } from "./comparator.js";
import { DeliveryReport, GitDeliveryEngine } from "./delivery.js";
import { HarnessDiagnoser } from "./diagnoser.js";
import { CandidateEvaluator, TaskExecutionResult } from "./evaluator.js";
import { EvolutionPlan, EvolutionPlanner } from "./planner.js";
import { HarnessRegistry } from "./registry.js";
import {
  ComparisonResult,
  EvaluationMetrics,
  HarnessComponent,
  HarnessDiagnosis,
  HarnessHypothesis,
  HarnessVersion,
  VersionStatus,
} from "./types.js";

export interface EvolutionEngineOptions {
  diagnoser?: HarnessDiagnoser;
  planner?: EvolutionPlanner;
  registry?: HarnessRegistry;
  comparator?: CandidateComparator;
  evaluator?: CandidateEvaluator;
  delivery?: GitDeliveryEngine;
}

export interface DiagnosisResult {
  diagnoses: HarnessDiagnosis[];
  plan: EvolutionPlan | null;
}

export interface CandidateInput {
  id: string;
  commitSha: string;
  targetComponent: HarnessComponent;
  hypothesis: HarnessHypothesis | string;
  parentId?: string | null;
}

export interface CandidateEvaluationOutcome {
  version: HarnessVersion;
  comparison: ComparisonResult;
  deliveryReport?: DeliveryReport;
}

/** Maps comparison decision to persistent version status. */
function statusForDecision(decision: ComparisonResult["decision"]): VersionStatus {
  switch (decision) {
    case "promote":
      return "promoted";
    case "reject":
      return "rejected";
    default:
      return "candidate";
  }
}

/** Normalizes hypothesis input into a structured HarnessHypothesis object. */
function normalizeHypothesis(
  input: HarnessHypothesis | string,
  candidateId: string,
  component: HarnessComponent,
): HarnessHypothesis {
  if (typeof input === "object") return input;
  return {
    id: `hyp-${candidateId}`,
    targetComponent: component,
    statement: input,
    predictedEffect: "Improve component performance and reliability",
    evaluationPlan: "Standard harness benchmark suite",
    createdAt: Date.now(),
  };
}

export class EvolutionEngine {
  readonly diagnoser: HarnessDiagnoser;
  readonly planner: EvolutionPlanner;
  readonly registry?: HarnessRegistry;
  readonly comparator: CandidateComparator;
  readonly evaluator: CandidateEvaluator;
  readonly delivery: GitDeliveryEngine;

  constructor(opts: EvolutionEngineOptions = {}) {
    this.diagnoser = opts.diagnoser ?? new HarnessDiagnoser();
    this.planner = opts.planner ?? new EvolutionPlanner();
    this.registry = opts.registry;
    this.comparator = opts.comparator ?? new CandidateComparator();
    this.evaluator = opts.evaluator ?? new CandidateEvaluator();
    this.delivery = opts.delivery ?? new GitDeliveryEngine();
  }

  /** Diagnoses a batch of episodes and synthesizes an actionable evolution plan. */
  diagnoseEpisodes(episodes: Episode[]): DiagnosisResult {
    const diagnoses: HarnessDiagnosis[] = [];
    for (const ep of episodes) {
      const diag = this.diagnoser.diagnoseEpisode(ep);
      if (diag) diagnoses.push(diag);
    }
    const plan = this.planner.createPlan(diagnoses);
    return { diagnoses, plan };
  }

  /** Evaluates candidate test execution results, compares with baseline, and records outcome. */
  evaluateCandidate(
    candidate: CandidateInput,
    results: TaskExecutionResult[],
    transferResults: TaskExecutionResult[] = [],
  ): CandidateEvaluationOutcome {
    const metrics = this.evaluator.aggregateResults(results, transferResults);
    const baseline = this.resolveBaseline(candidate.parentId);
    const comparison = this.runComparison(candidate.id, metrics, baseline);
    const hypothesisObj = normalizeHypothesis(candidate.hypothesis, candidate.id, candidate.targetComponent);

    const version: HarnessVersion = {
      id: candidate.id,
      commitSha: candidate.commitSha,
      parentId: baseline ? baseline.id : null,
      createdAt: Date.now(),
      targetComponent: candidate.targetComponent,
      hypothesis: hypothesisObj.statement,
      metrics,
      status: statusForDecision(comparison.decision),
    };

    if (this.registry) {
      this.registry.saveVersion(version);
      if (comparison.decision === "promote") {
        this.registry.promoteVersion(version.id);
      }
    }

    const outcome: CandidateEvaluationOutcome = { version, comparison };
    if (comparison.decision === "promote") {
      outcome.deliveryReport = this.delivery.prepareDelivery({
        version,
        hypothesis: hypothesisObj,
        comparison,
      });
    }

    return outcome;
  }

  rollback(versionId: string): void {
    if (!this.registry) throw new Error("Registry not configured on EvolutionEngine");
    this.registry.rollbackTo(versionId);
  }

  listVersions(): HarnessVersion[] {
    return this.registry ? this.registry.listVersions() : [];
  }

  getActiveVersion(): HarnessVersion | null {
    return this.registry ? this.registry.getActiveVersion() : null;
  }

  private resolveBaseline(parentId?: string | null): HarnessVersion | null {
    if (!this.registry) return null;
    if (parentId) return this.registry.getVersion(parentId);
    return this.registry.getActiveVersion();
  }

  private runComparison(
    candidateId: string,
    metrics: EvaluationMetrics,
    baseline: HarnessVersion | null,
  ): ComparisonResult {
    if (!baseline) {
      // First version promoted as initial baseline H0
      return {
        candidateId,
        baselineId: "none",
        decision: "promote",
        scoreDeltas: { capability: 0, reliability: 0, efficiency: 0, generalization: 0 },
        rationale: "Initial baseline harness version promoted.",
      };
    }
    return this.comparator.compare(candidateId, metrics, baseline.id, baseline.metrics);
  }
}
