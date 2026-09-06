/**
 * EvidenceAggregator — merges experience records into a multi-representation
 * digest for evolution decisions.
 *
 * S³Gym's key finding encoded here: NO single memory representation wins
 * across environments. Raw trajectory, summaries, and aggregated statistics
 * trade places by task class. So the aggregator maintains per-representation
 * predictive scores and exposes which representation to consult per task
 * class, instead of forcing one global representation.
 *
 * Evolution decisions therefore consume:
 *   raw trajectory  +  summary  +  aggregated statistics
 *   +  cross-task evidence  +  cross-model evidence
 */

import { ExperienceRecord, ExperienceDigest, ExperienceRepresentation, RepresentationPolicy } from "./types.js";

const REPRESENTATIONS: ExperienceRepresentation[] = ["raw_trajectory", "summary", "aggregated_statistics"];

export class EvidenceAggregator {
  /**
   * Builds a digest for one task class from its experience records.
   * `outcomesByRepresentation` is optional historical feedback: for each
   * representation, the hit-rate of predictions it fed that later held up.
   */
  digest(
    taskClass: string,
    records: ExperienceRecord[],
    representationFeedback?: Partial<Record<ExperienceRepresentation, number>>,
  ): ExperienceDigest {
    const total = records.length;
    const successes = records.filter((r) => r.outcome.verdict === "success").length;
    const successRate = total > 0 ? successes / total : 0;

    // Failure mode frequency (summary representation).
    const modeCounts = new Map<string, number>();
    for (const r of records) {
      if (!r.failureMode) continue;
      modeCounts.set(r.failureMode, (modeCounts.get(r.failureMode) ?? 0) + 1);
    }
    const failureModes = [...modeCounts.entries()]
      .map(([mode, count]) => ({ mode, count, share: count / (total || 1) }))
      .sort((a, b) => b.count - a.count);

    const verified = records.filter((r) => r.outcome.externallyVerified);
    const verifiedMeanConfidence =
      verified.length > 0 ? verified.reduce((acc, r) => acc + r.confidence, 0) / verified.length : 0;

    const representationScores = this.scoreRepresentations(records, representationFeedback);
    const bestRepresentation = REPRESENTATIONS.reduce(
      (best, rep) => (representationScores[rep] > representationScores[best] ? rep : best),
      "aggregated_statistics" as ExperienceRepresentation,
    );

    return {
      taskClass,
      totalRecords: total,
      successRate,
      failureModes,
      verifiedMeanConfidence,
      bestRepresentation,
      representationScores,
      crossModelEvidence: this.crossModelEvidence(taskClass, records),
      harnessVersions: [...new Set(records.map((r) => r.harnessVersion))],
      generatedAt: Date.now(),
    };
  }

  /**
   * Builds digests for every task class present in the record set — the
   * "cross-task evidence" view the evolution layer consumes.
   */
  digestAll(records: ExperienceRecord[]): ExperienceDigest[] {
    const byClass = new Map<string, ExperienceRecord[]>();
    for (const r of records) {
      const list = byClass.get(r.taskClass) ?? [];
      list.push(r);
      byClass.set(r.taskClass, list);
    }
    return [...byClass.entries()].map(([taskClass, recs]) => this.digest(taskClass, recs));
  }

  /**
   * Learns the representation policy: per task class, which representation
   * has been most predictive. Self-judged evidence is structurally
   * down-weighted at the record level (see TrajectoryAnalyzer); the policy
   * also records the global weights for downstream consumers.
   */
  learnPolicy(digests: ExperienceDigest[]): RepresentationPolicy {
    const byTaskClass: Record<string, ExperienceRepresentation> = {};
    for (const d of digests) {
      byTaskClass[d.taskClass] = d.bestRepresentation;
    }
    return {
      byTaskClass,
      default: "aggregated_statistics",
      selfJudgmentWeight: 0.35,
      verifiedWeight: 1.0,
    };
  }

  /**
   * Scores each representation's predictive value for this task class.
   * Without explicit feedback, we derive proxy scores from record structure:
   *  - raw_trajectory is predictive when trajectories are short and outcomes
   *    are consistent (patterns are legible).
   *  - summary is predictive when failure modes concentrate (a summary
   *    captures the recurring failure).
   *  - aggregated_statistics is predictive when there are enough records for
   *    statistics to stabilize.
   * With explicit feedback (hit-rates), feedback dominates the proxy scores.
   */
  private scoreRepresentations(
    records: ExperienceRecord[],
    feedback?: Partial<Record<ExperienceRepresentation, number>>,
  ): Record<ExperienceRepresentation, number> {
    const total = records.length || 1;
    const verifiedShare = records.filter((r) => r.outcome.externallyVerified).length / total;
    const avgLen = records.reduce((acc, r) => acc + r.actionSequence.length, 0) / total;
    const modeConcentration = records.length ? this.digestConcentration(records) : 0;

    const raw = clamp(verifiedShare * 0.5 + (avgLen > 0 && avgLen <= 12 ? 0.3 : 0.1));
    const summary = clamp(modeConcentration + 0.15);
    const stats = clamp((Math.min(total, 30) / 30) * 0.6 + verifiedShare * 0.2);

    const proxies: Record<ExperienceRepresentation, number> = {
      raw_trajectory: raw,
      summary,
      aggregated_statistics: stats,
    };

    // Explicit feedback (observed prediction hit-rate per representation)
    // overrides the structural proxies when enough samples exist.
    const result = { ...proxies };
    for (const rep of REPRESENTATIONS) {
      const fb = feedback?.[rep];
      if (typeof fb === "number" && fb >= 0 && fb <= 1) {
        result[rep] = 0.3 * proxies[rep] + 0.7 * fb;
      }
    }
    return result;
  }

  private digestConcentration(records: ExperienceRecord[]): number {
    const total = records.length || 1;
    const modeCounts = new Map<string, number>();
    for (const r of records) {
      if (!r.failureMode) continue;
      modeCounts.set(r.failureMode, (modeCounts.get(r.failureMode) ?? 0) + 1);
    }
    const shares = [...modeCounts.values()].map((c) => c / total);
    if (shares.length === 0) return 0.1;
    // Herfindahl-style concentration: high = few dominant failure modes.
    return clamp(shares.reduce((acc, s) => acc + s * s, 0));
  }

  /**
   * Cross-model evidence: compares outcome rates for the same task class
   * across executor models, exposing executor sensitivity directly.
   */
  private crossModelEvidence(taskClass: string, records: ExperienceRecord[]) {
    const byModel = new Map<string, ExperienceRecord[]>();
    for (const r of records) {
      const list = byModel.get(r.executorModel) ?? [];
      list.push(r);
      byModel.set(r.executorModel, list);
    }
    const models = [...byModel.keys()].sort();
    const evidence: Array<{
      fromModel: string;
      toModel: string;
      taskClass: string;
      outcomeDelta: number;
      samples: number;
    }> = [];
    for (let i = 0; i < models.length; i++) {
      for (const to of models.slice(i + 1)) {
        const fromRecs = byModel.get(models[i])!;
        const toRecs = byModel.get(to)!;
        const fromRate = fromRecs.filter((r) => r.outcome.verdict === "success").length / fromRecs.length;
        const toRate = toRecs.filter((r) => r.outcome.verdict === "success").length / toRecs.length;
        evidence.push({
          fromModel: models[i],
          toModel: to,
          taskClass,
          outcomeDelta: toRate - fromRate,
          samples: Math.min(fromRecs.length, toRecs.length),
        });
      }
    }
    return evidence;
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
