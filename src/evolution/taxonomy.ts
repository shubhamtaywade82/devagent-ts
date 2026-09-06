/**
 * Failure Taxonomy for attributing execution failures to harness subsystems.
 *
 * Connects low-level execution signals to high-level failure classes and the
 * responsible harness component: E (execution), T (tools), C (context), S (state),
 * L (lifecycle), or V (verification).
 */

import { FailureClass, HarnessComponent } from "./types.js";

export interface TaxonomySignals {
  terminal: string;
  testsRan: boolean;
  testsPassed: boolean | null;
  toolErrorRate: number;
  retriedSameToolMax: number;
  loopAborted: boolean;
  turnCount: number;
  maxTurnsHit?: boolean;
  filesModified?: number;
  lastErrorLabel?: string;
}

export interface TaxonomyClassification {
  failureClass: FailureClass;
  component: HarnessComponent;
  confidence: number;
  reason: string;
}

/** Determines if the failure is attributable to verification/lifecycle boundary. */
function checkVerificationGap(signals: TaxonomySignals): TaxonomyClassification | null {
  if (signals.terminal === "answered" && signals.testsPassed === false) {
    return {
      failureClass: "premature_completion",
      component: "verification",
      confidence: 0.95,
      reason: "Agent completed task while verification tests were failing",
    };
  }
  if (signals.terminal === "answered" && (signals.filesModified ?? 0) > 0 && !signals.testsRan) {
    return {
      failureClass: "verification_gap",
      component: "verification",
      confidence: 0.85,
      reason: "Files modified without running verification tests before answering",
    };
  }
  return null;
}

/** Determines if the failure is attributable to execution loop or retries. */
function checkExecutionFailure(signals: TaxonomySignals): TaxonomyClassification | null {
  if (signals.loopAborted || signals.terminal === "loop_abort") {
    return {
      failureClass: "loop_failure",
      component: "execution",
      confidence: 0.9,
      reason: "Orchestrator aborted execution due to repetitive tool call cycle",
    };
  }
  if (signals.retriedSameToolMax >= 3) {
    return {
      failureClass: "retry_failure",
      component: "lifecycle",
      confidence: 0.8,
      reason: "Repeated failures on the same tool without recovering or escalating",
    };
  }
  return null;
}

/** Determines if the failure is attributable to tools or protocol schemas. */
function checkToolFailure(signals: TaxonomySignals): TaxonomyClassification | null {
  if (signals.toolErrorRate > 0.4) {
    const isArgError = signals.lastErrorLabel?.includes("Argument") ?? false;
    return {
      failureClass: isArgError ? "tool_argument_error" : "tool_selection",
      component: "tools",
      confidence: 0.85,
      reason: isArgError ? "Tool call arguments violated tool schema" : "High tool error rate during task execution",
    };
  }
  return null;
}

/** Classifies an observed telemetry signal into a failure class and component. */
export function classifyFailure(signals: TaxonomySignals): TaxonomyClassification {
  const verification = checkVerificationGap(signals);
  if (verification) return verification;

  const execution = checkExecutionFailure(signals);
  if (execution) return execution;

  const tool = checkToolFailure(signals);
  if (tool) return tool;

  if (signals.maxTurnsHit || (signals.turnCount > 25 && signals.terminal === "turn_budget")) {
    return {
      failureClass: "context_overflow",
      component: "context",
      confidence: 0.75,
      reason: "Task exceeded turn ceiling without reaching resolution",
    };
  }

  return {
    failureClass: "unknown",
    component: "execution",
    confidence: 0.3,
    reason: "No strong subsystem pattern matched the observed signals",
  };
}
