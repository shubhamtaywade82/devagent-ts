/**
 * Hypothesis generator for the Nexum Harness Evolution System.
 *
 * Translates an identified subsystem weakness into a scoped, testable mutation
 * hypothesis with an explicit predicted effect and evaluation criteria.
 */

import { HarnessDiagnosis, HarnessHypothesis } from "./types.js";

/** Generates a unique hypothesis identifier based on timestamp and component. */
function generateHypothesisId(component: string): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `hyp-${component}-${Date.now()}-${rand}`;
}

/** Formulates a concrete hypothesis from a diagnosed subsystem weakness. */
export function formulateHypothesis(diagnosis: HarnessDiagnosis): HarnessHypothesis {
  const statement = `Modifying ${diagnosis.component} to address ${diagnosis.failureClass}: ${diagnosis.proposedFix}`;
  const predictedEffect = `Expected capability delta: +${(diagnosis.expectedImpact.capability * 100).toFixed(1)}%, reliability delta: +${(diagnosis.expectedImpact.reliability * 100).toFixed(1)}%`;
  const evaluationPlan = `Run regression test suite and benchmark harness targeting ${diagnosis.component} subsystem before candidate promotion.`;

  return {
    id: generateHypothesisId(diagnosis.component),
    targetComponent: diagnosis.component,
    statement,
    predictedEffect,
    evaluationPlan,
    createdAt: Date.now(),
  };
}
