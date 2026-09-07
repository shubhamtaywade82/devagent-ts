import { ActivationMonitor, OperationalTelemetry } from "../../src/evolution/monitoring/activation-monitor.js";

function sample(over: Partial<OperationalTelemetry> = {}): OperationalTelemetry {
  return {
    at: Date.now(),
    harnessId: "H1",
    episodes: 10,
    taskSuccessRate: 0.6,
    falseSuccessRate: 0.1,
    toolErrorRate: 0.2,
    loopAbortRate: 0.1,
    verificationFailureRate: 0.2,
    avgTokens: 2000,
    avgLatencyMs: 1200,
    ...over,
  };
}

function baselineEnvelope(monitor: ActivationMonitor, harnessId = "H1") {
  return monitor.envelopeFromBaseline({
    harnessId,
    experimentId: "exp-001",
    baseline: {
      taskSuccessRate: 0.6,
      falseSuccessRate: 0.1,
      toolErrorRate: 0.2,
      loopAbortRate: 0.1,
      verificationFailureRate: 0.2,
      avgTokens: 2000,
      avgLatencyMs: 1200,
    },
    minSampleSize: 10,
  });
}

describe("ActivationMonitor", () => {
  it("reports insufficient_samples before minSampleSize episodes", () => {
    const monitor = new ActivationMonitor();
    monitor.setEnvelope(baselineEnvelope(monitor));
    monitor.ingest(sample({ episodes: 5 }));
    const health = monitor.evaluate("H1");
    expect(health.status).toBe("insufficient_samples");
    expect(health.sampleEpisodes).toBe(5);
  });

  it("reports healthy when live telemetry holds the inherited band", () => {
    const monitor = new ActivationMonitor();
    monitor.setEnvelope(baselineEnvelope(monitor));
    monitor.ingest(sample());
    const health = monitor.evaluate("H1");
    expect(health.status).toBe("healthy");
    expect(health.violations).toHaveLength(0);
    expect(health.rationale).toContain("within tolerance");
  });

  it("aggregates episode-weighted telemetry across samples", () => {
    const monitor = new ActivationMonitor();
    monitor.setEnvelope(baselineEnvelope(monitor));
    // 10 episodes at 0.6 success + 10 at 0.6 → aggregated 0.6.
    monitor.ingest(sample({ episodes: 10, taskSuccessRate: 0.6 }));
    monitor.ingest(sample({ episodes: 10, taskSuccessRate: 0.6 }));
    const health = monitor.evaluate("H1");
    expect(health.status).toBe("healthy");
    expect(health.sampleEpisodes).toBe(20);
  });

  it("flags degradation inside the warn band before the regression band", () => {
    const monitor = new ActivationMonitor();
    monitor.setEnvelope(baselineEnvelope(monitor));
    // Success 0.6 → 0.555 = −7.5% relative (warn 5%, regress 15%).
    monitor.ingest(sample({ taskSuccessRate: 0.555 }));
    const health = monitor.evaluate("H1");
    expect(health.status).toBe("degrading");
    expect(health.violations[0].severity).toBe("degradation");
    expect(health.violations[0].metric).toBe("taskSuccessRate");
  });

  it("classifies a hard drop as regressed — the ACTIVE → REGRESSED trigger", () => {
    const monitor = new ActivationMonitor();
    monitor.setEnvelope(baselineEnvelope(monitor));
    // Success 0.6 → 0.45 = −25% relative, beyond the 15% regression band.
    monitor.ingest(sample({ taskSuccessRate: 0.45, toolErrorRate: 0.4 }));
    const health = monitor.evaluate("H1");
    expect(health.status).toBe("regressed");
    expect(monitor.isRegressed("H1")).toBe(true);
    const severe = health.violations.filter((v) => v.severity === "regression");
    expect(severe.map((v) => v.metric)).toEqual(expect.arrayContaining(["taskSuccessRate", "toolErrorRate"]));
  });

  it("treats metric IMPROVEMENTS as healthy, never as violations", () => {
    const monitor = new ActivationMonitor();
    monitor.setEnvelope(baselineEnvelope(monitor));
    monitor.ingest(
      sample({ taskSuccessRate: 0.9, falseSuccessRate: 0.02, toolErrorRate: 0.05, avgTokens: 1000, avgLatencyMs: 600 }),
    );
    expect(monitor.evaluate("H1").status).toBe("healthy");
  });

  it("flags task-class distribution drift as a degradation signal", () => {
    const monitor = new ActivationMonitor();
    const envelope = baselineEnvelope(monitor);
    envelope.baselineTaskClassDistribution = { coding: 0.7, review: 0.3 };
    monitor.setEnvelope(envelope);
    monitor.ingest(
      sample({
        taskClassDistribution: { coding: 0.3, review: 0.7 }, // 0.4 abs drift
      }),
    );
    const health = monitor.evaluate("H1");
    expect(health.status).toBe("degrading");
    expect(health.violations.some((v) => v.metric === "task_class_distribution")).toBe(true);
    expect(health.distributionDrift).toBeCloseTo(0.4);
  });

  it("keeps per-harness histories independent", () => {
    const monitor = new ActivationMonitor();
    monitor.setEnvelope(baselineEnvelope(monitor, "H2"));
    monitor.ingest(sample({ harnessId: "H2", taskSuccessRate: 0.2 }));
    monitor.ingest(sample({ harnessId: "H1", taskSuccessRate: 0.2 })); // no envelope
    expect(monitor.isRegressed("H2")).toBe(true);
    // H1 has samples but no envelope → honest 'insufficient' verdict.
    expect(monitor.evaluate("H1").status).toBe("insufficient_samples");
    expect(monitor.evaluate("H1").rationale).toContain("No performance envelope");
  });

  it("exposes the full sample history for provenance replay", () => {
    const monitor = new ActivationMonitor();
    monitor.ingest(sample());
    monitor.ingest(sample());
    expect(monitor.samplesFor("H1")).toHaveLength(2);
  });
});
