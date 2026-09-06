/**
 * Candidate Comparator for evaluating harness mutations across multi-objective Pareto dimensions:
 * Capability, Reliability, Efficiency, and Generalization.
 *
 * Implements strict regression gates: candidate harness versions that improve training
 * task success but degrade reliability or held-out generalization are rejected.
 */

import { ComparisonResult, EvaluationMetrics } from "./types.js";

export interface ScoreDeltas {
  capability: number;
  reliability: number;
  efficiency: number;
  generalization: number;
}

/** Computes dimensional deltas between candidate and baseline metrics. */
export function computeDeltas(candidate: EvaluationMetrics, baseline: EvaluationMetrics): ScoreDeltas {
  const capCand = (candidate.capability.taskSuccessRate + candidate.capability.verificationPassRate) / 2;
  const capBase = (baseline.capability.taskSuccessRate + baseline.capability.verificationPassRate) / 2;

  // For reliability, lower error/abort rates represent higher reliability score
  const relCand = 1 - (candidate.reliability.toolErrorRate + candidate.reliability.falseSuccessRate) / 2;
  const relBase = 1 - (baseline.reliability.toolErrorRate + baseline.reliability.falseSuccessRate) / 2;

  // Efficiency delta: positive means fewer tokens consumed (more efficient)
  const tokenDelta =
    (baseline.efficiency.avgTokens - candidate.efficiency.avgTokens) / (baseline.efficiency.avgTokens || 1);

  const genCand = (candidate.generalization.heldOutScore + candidate.generalization.transferScore) / 2;
  const genBase = (baseline.generalization.heldOutScore + baseline.generalization.transferScore) / 2;

  return {
    capability: capCand - capBase,
    reliability: relCand - relBase,
    efficiency: tokenDelta,
    generalization: genCand - genBase,
  };
}

export class CandidateComparator {
  compare(
    candidateId: string,
    candidate: EvaluationMetrics,
    baselineId: string,
    baseline: EvaluationMetrics,
  ): ComparisonResult {
    const deltas = computeDeltas(candidate, baseline);

    // Hard regression gates: reject if reliability or generalization suffered
    if (deltas.reliability < -0.05) {
      return {
        candidateId,
        baselineId,
        decision: "reject",
        scoreDeltas: deltas,
        rationale: `Rejected due to reliability regression: ${(deltas.reliability * 100).toFixed(1)}%`,
      };
    }

    if (deltas.generalization < -0.05) {
      return {
        candidateId,
        baselineId,
        decision: "reject",
        scoreDeltas: deltas,
        rationale: `Rejected due to held-out/transfer generalization regression: ${(deltas.generalization * 100).toFixed(1)}%`,
      };
    }

    // Unacceptable capability drop
    if (deltas.capability < -0.02) {
      return {
        candidateId,
        baselineId,
        decision: "reject",
        scoreDeltas: deltas,
        rationale: `Rejected due to capability drop: ${(deltas.capability * 100).toFixed(1)}%`,
      };
    }

    // Promotion criteria: genuine gain in capability or reliability with bounded token cost
    const hasCapabilityGain = deltas.capability >= 0.03;
    const hasReliabilityGain = deltas.reliability >= 0.04;
    const tokenCostAcceptable = deltas.efficiency >= -0.25; // allowed max 25% token overhead

    if ((hasCapabilityGain || hasReliabilityGain) && tokenCostAcceptable) {
      return {
        candidateId,
        baselineId,
        decision: "promote",
        scoreDeltas: deltas,
        rationale: `Promoted: capability delta +${(deltas.capability * 100).toFixed(1)}%, reliability delta +${(deltas.reliability * 100).toFixed(1)}%`,
      };
    }

    return {
      candidateId,
      baselineId,
      decision: "inconclusive",
      scoreDeltas: deltas,
      rationale: "Candidate performance deltas did not reach the significance threshold for promotion.",
    };
  }
}
