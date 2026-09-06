/**
 * Evolution Planner for scheduling and scoping single-component harness mutations.
 *
 * Enforces the Single-Component Scoping Principle: mutations are strictly confined
 * to one subsystem at a time to prevent multi-subsystem regression ripples.
 */

import { formulateHypothesis } from "./hypothesis.js";
import { HarnessComponent, HarnessDiagnosis, HarnessHypothesis } from "./types.js";

export interface EvolutionPlan {
  id: string;
  targetComponent: HarnessComponent;
  hypothesis: HarnessHypothesis;
  diagnosesCount: number;
  recommendedBenchmarkCategories: string[];
  createdAt: number;
}

/** Maps a harness component to relevant benchmark categories in src/benchmark. */
function benchmarkCategoriesFor(component: HarnessComponent): string[] {
  switch (component) {
    case "execution":
    case "lifecycle":
      return ["agentic-looping", "error-recovery", "escalation"];
    case "tools":
      return ["tool-calling", "execution"];
    case "context":
    case "memory":
      return ["reasoning", "thinking", "agentic-looping"];
    case "verification":
      return ["error-recovery", "tool-calling", "execution"];
    case "routing":
      return ["escalation", "tool-calling"];
    default:
      return ["execution", "agentic-looping"];
  }
}

export class EvolutionPlanner {
  /** Aggregates diagnoses, ranks by frequency/confidence, and selects highest-impact target. */
  createPlan(diagnoses: HarnessDiagnosis[]): EvolutionPlan | null {
    if (diagnoses.length === 0) return null;

    // Group diagnoses by target component
    const componentScores = new Map<HarnessComponent, { totalScore: number; list: HarnessDiagnosis[] }>();
    for (const d of diagnoses) {
      const existing = componentScores.get(d.component) ?? { totalScore: 0, list: [] };
      existing.totalScore += d.confidence;
      existing.list.push(d);
      componentScores.set(d.component, existing);
    }

    // Pick component with highest aggregated confidence
    let bestComponent: HarnessComponent = diagnoses[0].component;
    let maxScore = -1;
    for (const [comp, data] of componentScores.entries()) {
      if (data.totalScore > maxScore) {
        maxScore = data.totalScore;
        bestComponent = comp;
      }
    }

    const componentDiagnoses = componentScores.get(bestComponent)!.list;
    // Select the diagnosis with the highest individual confidence
    const primaryDiagnosis = componentDiagnoses.reduce((best, cur) => (cur.confidence > best.confidence ? cur : best));
    const hypothesis = formulateHypothesis(primaryDiagnosis);
    const id = `plan-${bestComponent}-${Date.now()}`;

    return {
      id,
      targetComponent: bestComponent,
      hypothesis,
      diagnosesCount: componentDiagnoses.length,
      recommendedBenchmarkCategories: benchmarkCategoriesFor(bestComponent),
      createdAt: Date.now(),
    };
  }
}
