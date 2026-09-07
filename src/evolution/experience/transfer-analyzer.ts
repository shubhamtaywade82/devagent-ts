/**
 * TransferAnalyzer — decides whether an experience (or a harness improvement)
 * transfers across task classes and executor models.
 *
 * Encodes the Self-Developing Agents finding that visible improvement
 * frequently failed to transfer to held-out tasks: an experience is marked
 * transferable only when the same pattern is associated with consistent
 * outcomes in more than one task class or executor model. Single-context
 * patterns stay `false`; unanalyzed patterns stay `"unknown"`.
 */

import { ExperienceRecord } from "./types.js";

export interface TransferVerdict {
  episodeId: string;
  transferable: boolean | "unknown";
  /** Human-readable justification recorded for auditability. */
  rationale: string;
  /** Supporting contexts in which the pattern reproduced. */
  supportingContexts: string[];
}

export interface TransferAnalysis {
  verdicts: TransferVerdict[];
  /** Share of analyzed records judged transferable (0..1). */
  transferRate: number;
  /** Share still unknown. */
  unknownRate: number;
}

export interface TransferAnalyzerOptions {
  /** Minimum contexts (task classes or executor models) for a transfer verdict. */
  minContexts?: number;
  /** Maximum outcome deviation tolerated across contexts, 0..1. */
  maxOutcomeDeviation?: number;
}

export class TransferAnalyzer {
  private readonly minContexts: number;
  private readonly maxOutcomeDeviation: number;

  constructor(opts: TransferAnalyzerOptions = {}) {
    this.minContexts = opts.minContexts ?? 2;
    this.maxOutcomeDeviation = opts.maxOutcomeDeviation ?? 0.15;
  }

  /**
   * Groups records by their failure-mode / success pattern signature and
   * checks whether each pattern behaves consistently across contexts
   * (task class × executor model).
   */
  analyze(records: ExperienceRecord[]): TransferAnalysis {
    if (records.length === 0) {
      return { verdicts: [], transferRate: 0, unknownRate: 0 };
    }

    // Signature = failure mode for failures, or "success" for successes.
    const bySignature = new Map<string, ExperienceRecord[]>();
    for (const r of records) {
      const sig = r.failureMode || "success";
      const list = bySignature.get(sig) ?? [];
      list.push(r);
      bySignature.set(sig, list);
    }

    const verdicts: TransferVerdict[] = [];
    for (const [signature, recs] of bySignature.entries()) {
      const contexts = new Set(recs.map((r) => `${r.taskClass}@${r.executorModel}`));

      if (contexts.size < this.minContexts) {
        verdicts.push({
          episodeId: recs[0].episodeId,
          transferable: "unknown",
          rationale: `Pattern "${signature}" observed in a single context (${[...contexts][0]}); needs more contexts before a transfer verdict.`,
          supportingContexts: [...contexts],
        });
        for (const r of recs.slice(1)) {
          verdicts.push({
            episodeId: r.episodeId,
            transferable: "unknown",
            rationale: `Pattern "${signature}" observed in a single context.`,
            supportingContexts: [...contexts],
          });
        }
        continue;
      }

      // Check outcome consistency of the pattern across contexts.
      const rates = new Map<string, number>();
      for (const ctx of contexts) {
        const inCtx = recs.filter((r) => `${r.taskClass}@${r.executorModel}` === ctx);
        rates.set(ctx, inCtx.filter((r) => r.outcome.verdict === "success").length / inCtx.length);
      }
      const values = [...rates.values()];
      const deviation = Math.max(...values) - Math.min(...values);

      const transferable = deviation <= this.maxOutcomeDeviation;
      const rationale = transferable
        ? `Pattern "${signature}" is consistent across ${contexts.size} contexts (deviation ${(deviation * 100).toFixed(1)}%).`
        : `Pattern "${signature}" is context-dependent (outcome deviation ${(deviation * 100).toFixed(1)}% across ${contexts.size} contexts).`;

      for (const r of recs) {
        verdicts.push({
          episodeId: r.episodeId,
          transferable,
          rationale,
          supportingContexts: [...contexts],
        });
      }
    }

    const decided = verdicts.filter((v) => v.transferable !== "unknown");
    const transferableCount = decided.filter((v) => v.transferable === true).length;
    return {
      verdicts,
      transferRate: decided.length > 0 ? transferableCount / decided.length : 0,
      unknownRate: verdicts.length > 0 ? (verdicts.length - decided.length) / verdicts.length : 0,
    };
  }

  /**
   * Transfer score for a candidate harness: how much of the experience
   * supporting the candidate's improvement is verified transferable.
   * Used by the generalization gate as transfer evidence.
   */
  transferScoreFor(records: ExperienceRecord[], harnessVersion: string): number {
    const forVersion = records.filter((r) => r.harnessVersion === harnessVersion);
    if (forVersion.length === 0) return 0;
    const analysis = this.analyze(forVersion);
    // Unknown evidence contributes half weight — it neither supports nor
    // contradicts transferability.
    return analysis.transferRate + 0.5 * analysis.unknownRate;
  }
}
