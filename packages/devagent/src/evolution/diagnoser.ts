/**
 * Harness Diagnoser for analyzing execution episodes into actionable subsystem diagnoses.
 *
 * Connects low-level execution evidence (tool events, loop aborts, premature completion)
 * to concrete root causes and expected impacts for the evolution planner.
 */

import { Episode } from "../learning/types.js";
import { classifyFailure, TaxonomySignals } from "./taxonomy.js";
import { Evidence, ExpectedImpact, FailureClass, HarnessDiagnosis } from "./types.js";

/** Maps a failure class to a standard remediation hypothesis and expected impact. */
function remediationFor(failureClass: FailureClass): { proposedFix: string; expectedImpact: ExpectedImpact } {
  switch (failureClass) {
    case "premature_completion":
    case "verification_gap":
      return {
        proposedFix: "Enforce mandatory verification pass over modified files before completing mission.",
        expectedImpact: { capability: 0.08, reliability: 0.15, cost: 0.05 },
      };
    case "loop_failure":
    case "retry_failure":
      return {
        proposedFix: "Tighten loop detection threshold and escalate earlier on repeated tool call signatures.",
        expectedImpact: { capability: 0.04, reliability: 0.12, cost: -0.05 },
      };
    case "tool_argument_error":
    case "tool_selection":
      return {
        proposedFix: "Prune distracting tool schemas and enhance JSON-schema argument descriptions.",
        expectedImpact: { capability: 0.06, reliability: 0.1, cost: -0.02 },
      };
    case "context_overflow":
      return {
        proposedFix: "Increase summarization frequency and aggressively compact older conversational turns.",
        expectedImpact: { capability: 0.05, reliability: 0.08, cost: -0.15 },
      };
    default:
      return {
        proposedFix: "Add targeted regression test coverage and trace execution boundaries.",
        expectedImpact: { capability: 0.02, reliability: 0.02, cost: 0.0 },
      };
  }
}

/** Extracts structured evidence items from episode tool calls and outcomes. */
function extractEvidence(episode: Episode): Evidence[] {
  const items: Evidence[] = [];
  items.push({
    type: "terminal_condition",
    summary: `Episode ended with terminal status: ${episode.terminal}`,
  });

  const failedCalls = episode.toolEvents.filter((e) => !e.ok);
  if (failedCalls.length > 0) {
    items.push({
      type: "tool_errors",
      summary: `${failedCalls.length} tool calls failed during episode`,
      detail: { errors: failedCalls.map((c) => ({ name: c.name, error: c.errorLabel })) },
    });
  }

  if (episode.grade) {
    items.push({
      type: "grade_verdict",
      summary: `Grader verdict was ${episode.grade.verdict} (score: ${episode.grade.score.toFixed(2)})`,
      detail: { signals: episode.grade.signals as unknown as Record<string, unknown> },
    });
  }

  return items;
}

export class HarnessDiagnoser {
  diagnoseEpisode(episode: Episode): HarnessDiagnosis | null {
    // Clean successful episodes with passing tests require no harness fix
    if (episode.grade?.verdict === "success" && episode.grade.signals.testsPassed) {
      return null;
    }

    const failedTools = episode.toolEvents.filter((e) => !e.ok);
    const lastError = failedTools[failedTools.length - 1]?.errorLabel;

    const signals: TaxonomySignals = {
      terminal: episode.terminal,
      testsRan: episode.grade?.signals.testsRan ?? false,
      testsPassed: episode.grade?.signals.testsPassed ?? null,
      toolErrorRate: episode.grade?.signals.toolErrorRate ?? 0,
      retriedSameToolMax: episode.grade?.signals.retriedSameToolMax ?? 0,
      loopAborted: episode.grade?.signals.loopAborted ?? false,
      turnCount: episode.grade?.signals.turnCount ?? episode.toolEvents.length,
      lastErrorLabel: lastError,
    };

    const classification = classifyFailure(signals);
    const { proposedFix, expectedImpact } = remediationFor(classification.failureClass);

    return {
      failureClass: classification.failureClass,
      component: classification.component,
      evidence: extractEvidence(episode),
      confidence: classification.confidence,
      rootCause: classification.reason,
      proposedFix,
      expectedImpact,
    };
  }
}
