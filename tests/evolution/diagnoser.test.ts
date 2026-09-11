import { HarnessDiagnoser } from "@nemesis-oss/nexum-devagent/evolution/diagnoser";
import { Episode } from "@nemesis-oss/nexum-devagent/learning/types";

describe("HarnessDiagnoser", () => {
  const diagnoser = new HarnessDiagnoser();

  it("returns null for a clean successful episode", () => {
    const episode: Episode = {
      id: "ep-1",
      goal: "Implement feature",
      startedAt: 100,
      endedAt: 200,
      toolEvents: [{ name: "run_tests", args: {}, ok: true, durationMs: 50, at: 150 }],
      activatedSkillIds: [],
      terminal: "answered",
      finalAssistantText: "Done",
      grade: {
        score: 1.0,
        signals: {
          testsRan: true,
          testsPassed: true,
          toolErrorRate: 0,
          pathEscapes: 0,
          patchFailures: 0,
          loopAborted: false,
          turnCount: 2,
          retriedSameToolMax: 0,
        },
        verdict: "success",
      },
    };

    const diagnosis = diagnoser.diagnoseEpisode(episode);
    expect(diagnosis).toBeNull();
  });

  it("diagnoses premature completion when tests failed but answered", () => {
    const episode: Episode = {
      id: "ep-2",
      goal: "Fix bug",
      startedAt: 100,
      endedAt: 300,
      toolEvents: [
        { name: "edit_file", args: {}, ok: true, durationMs: 20, at: 150 },
        { name: "run_tests", args: {}, ok: false, errorLabel: "Failures: 2", durationMs: 50, at: 250 },
      ],
      activatedSkillIds: [],
      terminal: "answered",
      finalAssistantText: "I fixed the issue successfully.",
      grade: {
        score: 0.3,
        signals: {
          testsRan: true,
          testsPassed: false,
          toolErrorRate: 0.5,
          pathEscapes: 0,
          patchFailures: 0,
          loopAborted: false,
          turnCount: 2,
          retriedSameToolMax: 0,
        },
        verdict: "failure",
      },
    };

    const diagnosis = diagnoser.diagnoseEpisode(episode);
    expect(diagnosis).not.toBeNull();
    expect(diagnosis!.failureClass).toBe("premature_completion");
    expect(diagnosis!.component).toBe("verification");
    expect(diagnosis!.evidence.length).toBeGreaterThan(0);
    expect(diagnosis!.proposedFix).toContain("verification pass");
  });

  it("diagnoses loop failure when loop aborted", () => {
    const episode: Episode = {
      id: "ep-3",
      goal: "Find route",
      startedAt: 100,
      endedAt: 300,
      toolEvents: [
        { name: "read_file", args: {}, ok: true, durationMs: 10, at: 120 },
        { name: "read_file", args: {}, ok: true, durationMs: 10, at: 140 },
        { name: "read_file", args: {}, ok: true, durationMs: 10, at: 160 },
      ],
      activatedSkillIds: [],
      terminal: "loop_abort",
      finalAssistantText: "Aborted",
      grade: {
        score: 0.1,
        signals: {
          testsRan: false,
          testsPassed: null,
          toolErrorRate: 0,
          pathEscapes: 0,
          patchFailures: 0,
          loopAborted: true,
          turnCount: 3,
          retriedSameToolMax: 3,
        },
        verdict: "failure",
      },
    };

    const diagnosis = diagnoser.diagnoseEpisode(episode);
    expect(diagnosis).not.toBeNull();
    expect(diagnosis!.failureClass).toBe("loop_failure");
    expect(diagnosis!.component).toBe("execution");
    expect(diagnosis!.proposedFix).toContain("loop detection");
  });
});
