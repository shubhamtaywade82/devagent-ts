/**
 * ActivationMonitor — post-activation regression detection driven by
 * OPERATIONAL TELEMETRY, not benchmark reruns.
 *
 * The lifecycle's ACTIVE → REGRESSED → ROLLBACK path is only meaningful if
 * something continuously watches the live harness. This monitor:
 *
 *   1. holds a per-harness performance ENVELOPE derived from the parent
 *      harness's acceptance evaluation (the "expected performance band"),
 *   2. ingests production telemetry samples (success rate, false success
 *      rate, tool error rate, loop aborts, verification failures, token
 *      consumption, latency, task-class distribution),
 *   3. aggregates the samples and classifies the harness as
 *      healthy | degrading | regressed against the envelope.
 *
 * A "regressed" verdict is the trigger for ACTIVE → REGRESSED → ROLLBACK;
 * "degrading" is the early-warning band that asks for more observation.
 */

export interface OperationalTelemetry {
  at: number;
  harnessId: string;
  experimentId?: string;
  /** Number of production episodes this sample aggregates. */
  episodes: number;
  taskSuccessRate: number;
  falseSuccessRate: number;
  toolErrorRate: number;
  loopAbortRate: number;
  verificationFailureRate: number;
  avgTokens: number;
  avgLatencyMs: number;
  /** Share of episodes per task class in this sample. */
  taskClassDistribution?: Record<string, number>;
}

export type EnvelopeMetric =
  | "taskSuccessRate"
  | "falseSuccessRate"
  | "toolErrorRate"
  | "loopAbortRate"
  | "verificationFailureRate"
  | "avgTokens"
  | "avgLatencyMs";

export interface EnvelopeSpec {
  metric: EnvelopeMetric;
  /** Expected value from the parent/acceptance evaluation. */
  baseline: number;
  direction: "higher_is_better" | "lower_is_better";
  /** Relative deviation that counts as early degradation (0.1 = 10%). */
  warnThreshold: number;
  /** Relative deviation that counts as a hard regression. */
  regressThreshold: number;
}

export interface ActivationEnvelope {
  harnessId: string;
  experimentId?: string;
  metrics: EnvelopeSpec[];
  /** Minimum aggregated episodes before a verdict is issued. */
  minSampleSize: number;
  /** Baseline task-class distribution for drift detection. */
  baselineTaskClassDistribution?: Record<string, number>;
  /** Max absolute share drift per task class before a degradation flag. */
  maxDistributionDrift?: number;
}

export type ActivationHealthStatus = "insufficient_samples" | "healthy" | "degrading" | "regressed";

export interface ActivationViolation {
  metric: string;
  observed: number;
  baseline: number;
  /** Relative deviation (positive = worse than baseline). */
  relativeDelta: number;
  severity: "degradation" | "regression";
  detail: string;
}

export interface ActivationHealth {
  harnessId: string;
  status: ActivationHealthStatus;
  sampleEpisodes: number;
  samples: number;
  violations: ActivationViolation[];
  /** Max absolute task-class share drift (when distributions were provided). */
  distributionDrift: number | null;
  rationale: string;
}

export interface ActivationMonitorOptions {
  minSampleSize?: number;
  /** Warn / regress thresholds per direction for auto-derived envelopes. */
  defaultWarnThreshold?: number;
  defaultRegressThreshold?: number;
  maxDistributionDrift?: number;
}

const TELEMETRY_KEYS: EnvelopeMetric[] = [
  "taskSuccessRate",
  "falseSuccessRate",
  "toolErrorRate",
  "loopAbortRate",
  "verificationFailureRate",
  "avgTokens",
  "avgLatencyMs",
];

/**
 * Watches active harness versions against their expected performance
 * envelope using live operational telemetry. Keeps full sample history per
 * harness so the health report can be replayed for provenance.
 */
export class ActivationMonitor {
  private readonly minSampleSize: number;
  private readonly defaultWarn: number;
  private readonly defaultRegress: number;
  private readonly maxDistributionDrift: number;
  private readonly envelopes = new Map<string, ActivationEnvelope>();
  private readonly samples = new Map<string, OperationalTelemetry[]>();

  constructor(opts: ActivationMonitorOptions = {}) {
    this.minSampleSize = opts.minSampleSize ?? 10;
    this.defaultWarn = opts.defaultWarnThreshold ?? 0.05;
    this.defaultRegress = opts.defaultRegressThreshold ?? 0.15;
    this.maxDistributionDrift = opts.maxDistributionDrift ?? 0.25;
  }

  /** Registers (or replaces) the expected performance envelope for a harness. */
  setEnvelope(envelope: ActivationEnvelope): void {
    this.envelopes.set(envelope.harnessId, envelope);
  }

  /**
   * Derives an envelope from the parent harness's evaluation metrics —
   * the new harness must at least hold the band it inherited.
   */
  envelopeFromBaseline(input: {
    harnessId: string;
    experimentId?: string;
    baseline: {
      taskSuccessRate: number;
      falseSuccessRate: number;
      toolErrorRate: number;
      loopAbortRate: number;
      verificationFailureRate: number;
      avgTokens: number;
      avgLatencyMs: number;
    };
    minSampleSize?: number;
    taskClassDistribution?: Record<string, number>;
  }): ActivationEnvelope {
    return {
      harnessId: input.harnessId,
      experimentId: input.experimentId,
      minSampleSize: input.minSampleSize ?? this.minSampleSize,
      baselineTaskClassDistribution: input.taskClassDistribution,
      maxDistributionDrift: this.maxDistributionDrift,
      metrics: [
        spec(
          "taskSuccessRate",
          input.baseline.taskSuccessRate,
          "higher_is_better",
          this.defaultWarn,
          this.defaultRegress,
        ),
        spec(
          "falseSuccessRate",
          input.baseline.falseSuccessRate,
          "lower_is_better",
          this.defaultWarn,
          this.defaultRegress,
        ),
        spec("toolErrorRate", input.baseline.toolErrorRate, "lower_is_better", this.defaultWarn, this.defaultRegress),
        spec("loopAbortRate", input.baseline.loopAbortRate, "lower_is_better", this.defaultWarn, this.defaultRegress),
        spec(
          "verificationFailureRate",
          input.baseline.verificationFailureRate,
          "lower_is_better",
          this.defaultWarn,
          this.defaultRegress,
        ),
        // Cost metrics get wider bands: token/latency growth is common and
        // only matters when it explodes.
        spec("avgTokens", input.baseline.avgTokens, "lower_is_better", 0.15, 0.5),
        spec("avgLatencyMs", input.baseline.avgLatencyMs, "lower_is_better", 0.25, 1.0),
      ],
    };
  }

  /** Ingests one aggregated production telemetry sample. */
  ingest(sample: OperationalTelemetry): void {
    const list = this.samples.get(sample.harnessId) ?? [];
    list.push(sample);
    this.samples.set(sample.harnessId, list);
  }

  samplesFor(harnessId: string): readonly OperationalTelemetry[] {
    return this.samples.get(harnessId) ?? [];
  }

  /**
   * Evaluates the live harness against its envelope. Returns
   * insufficient_samples until minSampleSize aggregated episodes exist.
   */
  evaluate(harnessId: string): ActivationHealth {
    const envelope = this.envelopes.get(harnessId);
    if (!envelope) {
      return noEnvelope(harnessId, this.samples.get(harnessId) ?? []);
    }
    const allSamples = this.samples.get(harnessId) ?? [];
    const relevant = allSamples.filter(
      (s) => !envelope.experimentId || !s.experimentId || s.experimentId === envelope.experimentId,
    );
    const sampleEpisodes = relevant.reduce((acc, s) => acc + s.episodes, 0);
    if (sampleEpisodes < envelope.minSampleSize) {
      return {
        harnessId,
        status: "insufficient_samples",
        sampleEpisodes,
        samples: relevant.length,
        violations: [],
        distributionDrift: null,
        rationale: `Only ${sampleEpisodes} aggregated episode(s); envelope requires ${envelope.minSampleSize}.`,
      };
    }

    const aggregated = aggregate(relevant);
    const violations: ActivationViolation[] = [];

    for (const specItem of envelope.metrics) {
      const observed = aggregated[specItem.metric];
      if (observed === undefined) continue;
      const relativeDelta = relativeWorse(specItem, observed);
      if (relativeDelta >= specItem.regressThreshold) {
        violations.push({
          metric: specItem.metric,
          observed,
          baseline: specItem.baseline,
          relativeDelta,
          severity: "regression",
          detail: `${specItem.metric} at ${fmt(observed)} vs baseline ${fmt(specItem.baseline)} (−${pct(relativeDelta)} relative, limit ${pct(specItem.regressThreshold)})`,
        });
      } else if (relativeDelta >= specItem.warnThreshold) {
        violations.push({
          metric: specItem.metric,
          observed,
          baseline: specItem.baseline,
          relativeDelta,
          severity: "degradation",
          detail: `${specItem.metric} at ${fmt(observed)} vs baseline ${fmt(specItem.baseline)} (−${pct(relativeDelta)} relative, warn ${pct(specItem.warnThreshold)})`,
        });
      }
    }

    let distributionDrift: number | null = null;
    if (envelope.baselineTaskClassDistribution) {
      distributionDrift = distributionMaxDrift(
        envelope.baselineTaskClassDistribution,
        aggregatedDistribution(relevant),
      );
      if (distributionDrift > (envelope.maxDistributionDrift ?? this.maxDistributionDrift)) {
        violations.push({
          metric: "task_class_distribution",
          observed: distributionDrift,
          baseline: 0,
          relativeDelta: distributionDrift,
          severity: "degradation",
          detail: `Task-class distribution drifted by ${pct(distributionDrift)} (max ${pct(envelope.maxDistributionDrift ?? this.maxDistributionDrift)}); envelope comparisons may no longer be like-for-like.`,
        });
      }
    }

    const status: ActivationHealthStatus = violations.some((v) => v.severity === "regression")
      ? "regressed"
      : violations.length > 0
        ? "degrading"
        : "healthy";

    const rationale =
      status === "regressed"
        ? `Hard regression detected: ${violations
            .filter((v) => v.severity === "regression")
            .map((v) => v.detail)
            .join("; ")}`
        : status === "degrading"
          ? `Early degradation detected: ${violations.map((v) => v.detail).join("; ")}`
          : `All envelope metrics within tolerance over ${sampleEpisodes} episode(s).`;

    return { harnessId, status, sampleEpisodes, samples: relevant.length, violations, distributionDrift, rationale };
  }

  /** Convenience: the verdict that should trigger ACTIVE → REGRESSED. */
  isRegressed(harnessId: string): boolean {
    return this.evaluate(harnessId).status === "regressed";
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function spec(
  metric: EnvelopeMetric,
  baseline: number,
  direction: EnvelopeSpec["direction"],
  warn: number,
  regress: number,
): EnvelopeSpec {
  return { metric, baseline, direction, warnThreshold: warn, regressThreshold: regress };
}

/** Episode-weighted mean of every telemetry channel. */
function aggregate(samples: OperationalTelemetry[]): Record<EnvelopeMetric, number> {
  const total = Math.max(
    samples.reduce((acc, s) => acc + s.episodes, 0),
    Number.EPSILON,
  );
  const out = {} as Record<EnvelopeMetric, number>;
  for (const key of TELEMETRY_KEYS) {
    out[key] = samples.reduce((acc, s) => acc + s[key] * s.episodes, 0) / total;
  }
  return out;
}

function aggregatedDistribution(samples: OperationalTelemetry[]): Record<string, number> {
  const total = samples.reduce((acc, s) => acc + s.episodes, 0);
  const out: Record<string, number> = {};
  for (const s of samples) {
    if (!s.taskClassDistribution) continue;
    for (const [cls, share] of Object.entries(s.taskClassDistribution)) {
      out[cls] = (out[cls] ?? 0) + share * s.episodes;
    }
  }
  if (total <= 0) return out;
  for (const cls of Object.keys(out)) out[cls] /= total;
  return out;
}

function distributionMaxDrift(baseline: Record<string, number>, observed: Record<string, number>): number {
  let max = 0;
  const classes = new Set([...Object.keys(baseline), ...Object.keys(observed)]);
  for (const cls of classes) {
    const drift = Math.abs((baseline[cls] ?? 0) - (observed[cls] ?? 0));
    if (drift > max) max = drift;
  }
  return max;
}

/** Positive relative deviation in the "worse" direction; 0 when better. */
function relativeWorse(specItem: EnvelopeSpec, observed: number): number {
  const base = specItem.baseline;
  if (specItem.direction === "higher_is_better") {
    return base > 0 ? Math.max(0, (base - observed) / base) : observed > 0 ? 1 : 0;
  }
  return base > 0 ? Math.max(0, (observed - base) / base) : observed > 0 ? 1 : 0;
}

function noEnvelope(harnessId: string, samples: OperationalTelemetry[]): ActivationHealth {
  return {
    harnessId,
    status: "insufficient_samples",
    sampleEpisodes: samples.reduce((acc, s) => acc + s.episodes, 0),
    samples: samples.length,
    violations: [],
    distributionDrift: null,
    rationale: "No performance envelope registered for the active harness.",
  };
}

function fmt(v: number): string {
  return v < 1 ? v.toFixed(3) : v < 100 ? v.toFixed(1) : Math.round(v).toString();
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
