/**
 * Experience Engine types for Nexum's evidence-grounded experience learning.
 *
 * Inspired by the S³Gym findings from the Self-Developing Agents research:
 *
 *  - No single memory representation wins across environments: raw history,
 *    summaries, and aggregated statistics trade places depending on the task
 *    class. So experience must be stored in MULTIPLE representations and the
 *    predictive representation selected per task class.
 *  - Self-judgment (LLM reflection alone) is a poor predictor of the next
 *    improvement. So every experience record carries verifier evidence, and
 *    reflection-derived lessons are weighted below measured outcomes.
 *  - Some updates improve performance while others cause sustained
 *    degradation. So every record binds the harness version and executor
 *    model that produced it, enabling outcome attribution.
 */

/** How the experience is represented when fed to evolution decisions. */
export type ExperienceRepresentation = "raw_trajectory" | "summary" | "aggregated_statistics";

export interface Outcome {
  /** Verdict from the grader or external verifier. */
  verdict: "success" | "partial" | "failure";
  /** 0..1 composite score. */
  score: number;
  /** True when external verification (tests/verifier) confirmed the outcome. */
  externallyVerified: boolean;
  /** Terminal condition of the episode. */
  terminal: string;
}

export interface VerificationEvidence {
  /** Tests ran and passed during the episode. */
  testsRan: boolean;
  testsPassed: boolean | null;
  /** Measured tool error rate (0..1). */
  toolErrorRate: number;
  /** Loop detector aborted the episode. */
  loopAborted: boolean;
  /** Patch attempts that failed to apply. */
  patchFailures: number;
  /** Any additional verifier signal payload. */
  signals?: Record<string, unknown>;
}

/**
 * A single unit of harness experience with full provenance. Unlike a Lesson
 * (which is reflection-derived task knowledge), an ExperienceRecord is a
 * measured, evidence-bound observation used by the EVOLUTION layer to decide
 * which harness changes to attempt and which to avoid.
 */
export interface ExperienceRecord {
  episodeId: string;
  /** Class of task, e.g. "bugfix", "feature", "refactor", "benchmark". */
  taskClass: string;
  /** Classified failure mode (empty when the episode succeeded). */
  failureMode: string;
  /** Compact snapshot of the relevant context (goal, environment, constraints). */
  contextSnapshot: string;
  /** Ordered tool-call names — the raw trajectory skeleton. */
  actionSequence: string[];
  outcome: Outcome;
  verifierEvidence: VerificationEvidence;
  /** Executor model that ran the episode (fixed-executor attribution). */
  executorModel: string;
  /** Harness version (H id) that was active during the episode. */
  harnessVersion: string;
  /** Whether this experience is expected to transfer across task classes. */
  transferable: boolean | "unknown";
  /** Confidence in the record's predictive value (0..1). */
  confidence: number;
  createdAt: number;
}

/** Aggregated, multi-representation view of experience for one task class. */
export interface ExperienceDigest {
  taskClass: string;
  totalRecords: number;
  successRate: number;
  /** Failure mode → frequency, sorted descending. */
  failureModes: Array<{ mode: string; count: number; share: number }>;
  /** Mean confidence across records that were externally verified. */
  verifiedMeanConfidence: number;
  /** Which representation has been most predictive for this task class. */
  bestRepresentation: ExperienceRepresentation;
  /** Per-representation predictive scores (computed against later outcomes). */
  representationScores: Record<ExperienceRepresentation, number>;
  /** Cross-model: outcome deltas observed when the executor model changed. */
  crossModelEvidence: CrossModelEvidence[];
  /** Harness versions represented in this digest. */
  harnessVersions: string[];
  generatedAt: number;
}

/** Evidence about how an experience transfers across executor models. */
export interface CrossModelEvidence {
  fromModel: string;
  toModel: string;
  taskClass: string;
  /** Outcome delta (success rate to − success rate from), −1..1. */
  outcomeDelta: number;
  samples: number;
}

/**
 * Learned policy: which experience representation to consult for a given task
 * class, and how much to weight self-judged vs verified evidence.
 */
export interface RepresentationPolicy {
  /** taskClass → best representation. */
  byTaskClass: Record<string, ExperienceRepresentation>;
  /** Global default when the task class is unknown. */
  default: ExperienceRepresentation;
  /** Weight multiplier for self-judged (reflection-only) evidence, 0..1. */
  selfJudgmentWeight: number;
  /** Weight multiplier for externally verified evidence, 0..1. */
  verifiedWeight: number;
}
