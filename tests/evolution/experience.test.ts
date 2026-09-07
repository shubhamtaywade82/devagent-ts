import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExperienceStore } from "../../src/evolution/experience/experience-store.js";
import { TrajectoryAnalyzer, inferTaskClass } from "../../src/evolution/experience/trajectory-analyzer.js";
import { EvidenceAggregator } from "../../src/evolution/experience/evidence-aggregator.js";
import { TransferAnalyzer } from "../../src/evolution/experience/transfer-analyzer.js";
import { ExperienceRecord } from "../../src/evolution/experience/types.js";
import { Episode } from "../../src/learning/types.js";

function makeEpisode(id: string, goal: string, ok: boolean): Episode {
  return {
    id,
    goal,
    startedAt: 1000,
    endedAt: 2000,
    terminal: ok ? "answered" : "loop_abort",
    toolEvents: [
      { name: "read_file", args: {}, ok: true, durationMs: 50, at: 1001 },
      { name: "run_shell", args: {}, ok, durationMs: 100, at: 1002, errorLabel: ok ? undefined : "command_failed" },
      { name: "run_shell", args: {}, ok, durationMs: 100, at: 1003, errorLabel: ok ? undefined : "command_failed" },
    ],
    activatedSkillIds: [],
    finalAssistantText: "",
    grade: {
      verdict: ok ? "success" : "failure",
      score: ok ? 0.9 : 0.2,
      signals: {
        testsRan: true,
        testsPassed: ok,
        toolErrorRate: ok ? 0 : 0.7,
        pathEscapes: 0,
        patchFailures: 0,
        loopAborted: !ok,
        turnCount: 4,
        retriedSameToolMax: ok ? 0 : 3,
      },
    },
  };
}

function makeRecord(partial: Partial<ExperienceRecord>): ExperienceRecord {
  return {
    episodeId: "ep-x",
    taskClass: "bugfix",
    failureMode: "",
    contextSnapshot: "goal=test",
    actionSequence: ["read_file", "edit_file"],
    outcome: { verdict: "success", score: 0.9, externallyVerified: true, terminal: "answered" },
    verifierEvidence: { testsRan: true, testsPassed: true, toolErrorRate: 0, loopAborted: false, patchFailures: 0 },
    executorModel: "qwen3-coder",
    harnessVersion: "H0",
    transferable: "unknown",
    confidence: 0.9,
    createdAt: Date.now(),
    ...partial,
  };
}

describe("TrajectoryAnalyzer", () => {
  it("binds measured evidence, executor, and harness version into records", () => {
    const analyzer = new TrajectoryAnalyzer({ executorModel: "qwen3-coder", harnessVersion: "H7" });
    const rec = analyzer.toExperienceRecord(makeEpisode("ep-1", "Fix the login bug", false));
    expect(rec.episodeId).toBe("ep-1");
    expect(rec.executorModel).toBe("qwen3-coder");
    expect(rec.harnessVersion).toBe("H7");
    expect(rec.outcome.externallyVerified).toBe(true);
    expect(rec.verifierEvidence.testsPassed).toBe(false);
    expect(rec.actionSequence).toEqual(["read_file", "run_shell", "run_shell"]);
    expect(rec.failureMode).toBeTruthy();
  });

  it("down-weights self-judged (non-verified) evidence per the S³Gym finding", () => {
    const analyzer = new TrajectoryAnalyzer({ executorModel: "m", harnessVersion: "H0" });
    const ep = makeEpisode("ep-self", "Refactor utils", true);
    ep.grade = undefined; // no grader — self-judged only
    const rec = analyzer.toExperienceRecord(ep);
    expect(rec.outcome.externallyVerified).toBe(false);
    expect(rec.confidence).toBeLessThan(0.4);
  });

  it("infers task classes from goals", () => {
    expect(inferTaskClass("fix the broken build")).toBe("bugfix");
    expect(inferTaskClass("add support for retry")).toBe("feature");
    expect(inferTaskClass("refactor the parser")).toBe("refactor");
    expect(inferTaskClass("hello world")).toBe("general");
  });
});

describe("ExperienceStore", () => {
  let tmpDir: string;
  let store: ExperienceStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "experience-test-"));
    store = new ExperienceStore(join(tmpDir, "experience.db"));
  });

  afterEach(async () => {
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("persists and retrieves records with full provenance", () => {
    const rec = makeRecord({});
    store.save(rec);
    const loaded = store.getByEpisode("ep-x");
    expect(loaded).toEqual(rec);
  });

  it("lists by task class and harness version", () => {
    store.save(makeRecord({ episodeId: "a", taskClass: "bugfix", harnessVersion: "H1" }));
    store.save(makeRecord({ episodeId: "b", taskClass: "feature", harnessVersion: "H2" }));
    store.save(makeRecord({ episodeId: "c", taskClass: "bugfix", harnessVersion: "H2" }));
    expect(store.listByTaskClass("bugfix")).toHaveLength(2);
    expect(store.listByHarnessVersion("H2")).toHaveLength(2);
    expect(store.count()).toBe(3);
  });

  it("updates transferability after transfer analysis", () => {
    store.save(makeRecord({ episodeId: "a" }));
    store.setTransferable(["a"], true);
    expect(store.getByEpisode("a")?.transferable).toBe(true);
  });
});

describe("EvidenceAggregator", () => {
  const aggregator = new EvidenceAggregator();

  it("digests failure mode frequency and verified confidence", () => {
    const records = [
      makeRecord({
        episodeId: "1",
        failureMode: "loop_failure",
        outcome: { verdict: "failure", score: 0.2, externallyVerified: true, terminal: "loop_abort" },
      }),
      makeRecord({
        episodeId: "2",
        failureMode: "loop_failure",
        outcome: { verdict: "failure", score: 0.3, externallyVerified: true, terminal: "loop_abort" },
      }),
      makeRecord({ episodeId: "3", failureMode: "" }),
    ];
    const digest = aggregator.digest("bugfix", records);
    expect(digest.totalRecords).toBe(3);
    expect(digest.successRate).toBeCloseTo(1 / 3);
    expect(digest.failureModes[0].mode).toBe("loop_failure");
    expect(digest.failureModes[0].share).toBeCloseTo(2 / 3);
    expect(digest.verifiedMeanConfidence).toBeGreaterThan(0);
  });

  it("selects the best representation per task class (no universal winner)", () => {
    // Sparse data → statistics representation weak; concentrated failure mode → summary strong.
    const sparse = [
      makeRecord({
        episodeId: "1",
        failureMode: "loop_failure",
        outcome: { verdict: "failure", score: 0.2, externallyVerified: false, terminal: "loop_abort" },
      }),
    ];
    const digest = aggregator.digest("bugfix", sparse, {
      raw_trajectory: 0.9,
      summary: 0.2,
      aggregated_statistics: 0.1,
    });
    expect(digest.bestRepresentation).toBe("raw_trajectory");
  });

  it("learns a representation policy across task classes", () => {
    const digests = [
      aggregator.digest("bugfix", [
        makeRecord({ episodeId: "1" }),
        makeRecord({ episodeId: "2" }),
        makeRecord({ episodeId: "3" }),
      ]),
      aggregator.digest("feature", [makeRecord({ episodeId: "4", taskClass: "feature" })]),
    ];
    const policy = aggregator.learnPolicy(digests);
    expect(Object.keys(policy.byTaskClass)).toEqual(["bugfix", "feature"]);
    expect(policy.selfJudgmentWeight).toBeLessThan(policy.verifiedWeight);
  });

  it("computes cross-model evidence exposing executor sensitivity", () => {
    const records = [
      makeRecord({ episodeId: "1", executorModel: "qwen" }),
      makeRecord({ episodeId: "2", executorModel: "qwen" }),
      makeRecord({
        episodeId: "3",
        executorModel: "gemini",
        outcome: { verdict: "failure", score: 0.1, externallyVerified: true, terminal: "error" },
      }),
      makeRecord({
        episodeId: "4",
        executorModel: "gemini",
        outcome: { verdict: "failure", score: 0.1, externallyVerified: true, terminal: "error" },
      }),
    ];
    const digest = aggregator.digest("bugfix", records);
    expect(digest.crossModelEvidence).toHaveLength(1);
    // Models sorted alphabetically: from=gemini (0% success), to=qwen (100%) → +1.
    expect(digest.crossModelEvidence[0].outcomeDelta).toBeCloseTo(1);
  });
});

describe("TransferAnalyzer", () => {
  const analyzer = new TransferAnalyzer();

  it("marks single-context patterns as unknown transfer", () => {
    const records = [makeRecord({ episodeId: "1", taskClass: "bugfix", executorModel: "qwen" })];
    const analysis = analyzer.analyze(records);
    expect(analysis.verdicts[0].transferable).toBe("unknown");
    expect(analysis.unknownRate).toBe(1);
  });

  it("marks consistent cross-context patterns as transferable", () => {
    const records = [
      makeRecord({ episodeId: "1", taskClass: "bugfix", executorModel: "qwen" }),
      makeRecord({ episodeId: "2", taskClass: "feature", executorModel: "qwen" }),
      makeRecord({ episodeId: "3", taskClass: "bugfix", executorModel: "gemini" }),
    ];
    const analysis = analyzer.analyze(records);
    const verdict = analysis.verdicts.find((v) => v.episodeId === "1")!;
    expect(verdict.transferable).toBe(true);
    expect(verdict.supportingContexts.length).toBeGreaterThanOrEqual(2);
  });

  it("marks context-dependent patterns as NOT transferable (held-out lesson)", () => {
    const records = [
      makeRecord({ episodeId: "1", taskClass: "bugfix", executorModel: "qwen" }),
      makeRecord({
        episodeId: "2",
        taskClass: "feature",
        executorModel: "qwen",
        outcome: { verdict: "failure", score: 0.1, externallyVerified: true, terminal: "error" },
      }),
    ];
    const analysis = analyzer.analyze(records);
    const verdict = analysis.verdicts.find((v) => v.episodeId === "1")!;
    expect(verdict.transferable).toBe(false);
    expect(analysis.transferRate).toBe(0);
  });

  it("computes a transfer score for a harness version's experience", () => {
    const records = [
      makeRecord({ episodeId: "1", harnessVersion: "H1", taskClass: "bugfix", executorModel: "qwen" }),
      makeRecord({ episodeId: "2", harnessVersion: "H1", taskClass: "feature", executorModel: "gemini" }),
      makeRecord({ episodeId: "3", harnessVersion: "H2", taskClass: "bugfix", executorModel: "qwen" }),
    ];
    // H1's success pattern reproduces in 2 contexts → transferable.
    expect(analyzer.transferScoreFor(records, "H1")).toBeGreaterThan(0.5);
    // H2 single-context → unknown only → half weight.
    expect(analyzer.transferScoreFor(records, "H2")).toBeCloseTo(0.5);
  });
});
