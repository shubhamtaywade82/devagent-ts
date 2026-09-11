/**
 * TrajectoryAnalyzer — converts raw execution episodes into ExperienceRecords.
 *
 * The analyzer deliberately captures ALL of the evidence signals the S³Gym
 * research found predictive (measured outcomes, verifier evidence, executor
 * identity, harness version) and none of the noise (full result payloads).
 * It also computes a first-pass confidence that DOWN-WEIGHTS self-judged
 * outcomes, because self-judgment was shown to be a poor predictor of the
 * next improvement.
 */

import { Episode } from "../../learning/types.js";
import { classifyFailure, TaxonomySignals } from "../taxonomy.js";
import { ExperienceRecord, Outcome, VerificationEvidence } from "./types.js";

export interface TrajectoryAnalyzerOptions {
  /** Executor model id to bind to records produced now (fixed-executor bookkeeping). */
  executorModel?: string;
  /** Harness version id to bind to records produced now. */
  harnessVersion?: string;
  /** Weight applied to self-judged (non-verified) outcomes, 0..1. */
  selfJudgmentWeight?: number;
}

/** Infers a coarse task class from the episode goal. */
export function inferTaskClass(goal: string): string {
  const g = goal.toLowerCase();
  if (/(fix|bug|regression|broken|fails?|error)/.test(g)) return "bugfix";
  if (/(add|implement|feature|support|create)/.test(g)) return "feature";
  if (/(refactor|clean|rename|restructure|migrate)/.test(g)) return "refactor";
  if (/(test|spec|coverage)/.test(g)) return "testing";
  if (/(doc|readme|comment)/.test(g)) return "documentation";
  return "general";
}

export class TrajectoryAnalyzer {
  private readonly executorModel: string;
  private readonly harnessVersion: string;
  private readonly selfJudgmentWeight: number;

  constructor(opts: TrajectoryAnalyzerOptions = {}) {
    this.executorModel = opts.executorModel ?? "unknown";
    this.harnessVersion = opts.harnessVersion ?? "unversioned";
    this.selfJudgmentWeight = opts.selfJudgmentWeight ?? 0.35;
  }

  /** Converts a graded episode into an evidence-bound ExperienceRecord. */
  toExperienceRecord(episode: Episode): ExperienceRecord {
    const grade = episode.grade;
    const verdict: Outcome["verdict"] = grade?.verdict ?? (episode.terminal === "answered" ? "success" : "failure");
    // "Externally verified" = a real verifier ran and produced a definitive
    // verdict (pass OR fail). The S³Gym distinction is measured-vs-self-judged,
    // not success-vs-failure: a measured failure is still strong evidence.
    const externallyVerified = Boolean(
      grade?.signals.testsRan && grade?.signals.testsPassed !== null && grade?.signals.testsPassed !== undefined,
    );

    const evidence: VerificationEvidence = {
      testsRan: grade?.signals.testsRan ?? false,
      testsPassed: grade?.signals.testsPassed ?? null,
      toolErrorRate: grade?.signals.toolErrorRate ?? 0,
      loopAborted: grade?.signals.loopAborted ?? false,
      patchFailures: grade?.signals.patchFailures ?? 0,
      signals: {
        pathEscapes: grade?.signals.pathEscapes ?? 0,
        turnCount: grade?.signals.turnCount ?? episode.toolEvents.length,
      },
    };

    let failureMode = "";
    if (verdict !== "success") {
      const signals: TaxonomySignals = {
        terminal: episode.terminal,
        testsRan: grade?.signals.testsRan ?? false,
        testsPassed: grade?.signals.testsPassed ?? null,
        toolErrorRate: grade?.signals.toolErrorRate ?? 0,
        retriedSameToolMax: grade?.signals.retriedSameToolMax ?? 0,
        loopAborted: grade?.signals.loopAborted ?? false,
        turnCount: grade?.signals.turnCount ?? episode.toolEvents.length,
      };
      failureMode = classifyFailure(signals).failureClass;
    }

    // Confidence: verified outcomes are trustworthy; self-judged ones are
    // discounted by the selfJudgmentWeight (S³Gym: self-judgment predicts
    // poorly).
    const base = grade?.score ?? 0.5;
    const confidence = externallyVerified ? 0.6 + 0.4 * base : this.selfJudgmentWeight * base;

    return {
      episodeId: episode.id,
      taskClass: inferTaskClass(episode.goal),
      failureMode,
      contextSnapshot: this.buildContextSnapshot(episode),
      actionSequence: episode.toolEvents.map((e) => e.name),
      outcome: {
        verdict,
        score: grade?.score ?? (verdict === "success" ? 1 : 0),
        externallyVerified,
        terminal: episode.terminal,
      },
      verifierEvidence: evidence,
      executorModel: this.executorModel,
      harnessVersion: this.harnessVersion,
      transferable: "unknown",
      confidence,
      createdAt: Date.now(),
    };
  }

  /** Bulk conversion helper for the common "process last N episodes" path. */
  toExperienceRecords(episodes: Episode[]): ExperienceRecord[] {
    return episodes.map((e) => this.toExperienceRecord(e));
  }

  private buildContextSnapshot(episode: Episode): string {
    const toolCounts = new Map<string, number>();
    for (const ev of episode.toolEvents) {
      toolCounts.set(ev.name, (toolCounts.get(ev.name) ?? 0) + 1);
    }
    const topTools = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, n]) => `${name}×${n}`)
      .join(", ");
    return `goal="${episode.goal.slice(0, 120)}" tools=[${topTools}] turns=${episode.toolEvents.length} terminal=${episode.terminal}`;
  }
}
