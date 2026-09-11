import type { HistoryEntry, PlanStep, StepOutcome } from "@nemesis-oss/nexum-core/runtime/types";

export type { HistoryEntry, PlanStep, StepOutcome, StepStatus } from "@nemesis-oss/nexum-core/runtime/types";

export interface StepRunner {
  run(step: PlanStep): Promise<StepOutcome>;
}

export interface Planner {
  replan(remaining: PlanStep[], history: HistoryEntry[]): Promise<PlanStep[]>;
}
