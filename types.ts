export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  description: string;
  status: StepStatus;
  dependencies: string[]; // parent step IDs that must succeed first
  rollbackCommand?: string;
  retryCount: number;
}

export type StepOutcome =
  | { kind: "success"; output: Record<string, unknown> }
  | { kind: "retryable"; error: string } // syntax/test failures, patch mismatches, transient network blips
  | { kind: "blocking"; error: string }; // missing files, API errors, detected tool-call loops

// Injected, not implemented here: this is the boundary where a step
// actually turns into model turns / tool calls. That integration
// (how a PlanStep maps to Provider/Router + Registry.invoke calls)
// isn't specified yet — see the note at the end of this response.
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