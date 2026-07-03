export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  description: string;
  status: StepStatus;
  dependencies: string[];
  rollbackCommand?: string;
  retryCount: number;
}

export type StepOutcome =
  | { kind: "success"; output: Record<string, unknown> }
  | { kind: "retryable"; error: string }
  | { kind: "blocking"; error: string };

export interface StepRunner {
  run(step: PlanStep): Promise<StepOutcome>;
}

export interface HistoryEntry {
  stepId: string;
  outcome: StepOutcome;
  at: number;
}

export interface Planner {
  replan(remaining: PlanStep[], history: HistoryEntry[]): Promise<PlanStep[]>;
}
