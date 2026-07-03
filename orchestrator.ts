import { PlanStep, StepRunner, Planner, HistoryEntry } from "./types";

export class OrchestratorError extends Error {}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_REPLANS = 5;

export interface OrchestratorOptions {
  steps: PlanStep[];
  runner: StepRunner;
  planner: Planner;
  runRollback: (command: string) => Promise<void>; // must route through the sandboxed ShellTool, not raw exec
  maxRetries?: number;
  maxReplans?: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export class Orchestrator {
  private steps: Map<string, PlanStep>;
  private readonly runner: StepRunner;
  private readonly planner: Planner;
  private readonly runRollback: (command: string) => Promise<void>;
  private readonly maxRetries: number;
  private readonly maxReplans: number;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private readonly executedOrder: PlanStep[] = [];
  private readonly history: HistoryEntry[] = [];
  private replanCount = 0;

  constructor(opts: OrchestratorOptions) {
    this.steps = new Map(opts.steps.map((s) => [s.id, s]));
    this.runner = opts.runner;
    this.planner = opts.planner;
    this.runRollback = opts.runRollback;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxReplans = opts.maxReplans ?? DEFAULT_MAX_REPLANS;
    this.logger = opts.logger ?? console;
  }

  async run(): Promise<PlanStep[]> {
    let order = this.topologicalOrder();

    for (;;) {
      const next = order.find((s) => s.status === "pending" && this.dependenciesSatisfied(s));
      if (!next) break;

      const replanNeeded = await this.runStep(next);
      if (!replanNeeded) continue;

      this.replanCount += 1;
      if (this.replanCount > this.maxReplans) {
        throw new OrchestratorError(`exceeded ${this.maxReplans} re-plans — aborting to avoid an unbounded loop`);
      }

      const remaining = order.filter((s) => s.status !== "completed" && s.status !== "failed");
      const revised = await this.planner.replan(remaining, this.history);
      this.applyReplan(revised);
      order = this.topologicalOrder();
    }

    if ([...this.steps.values()].some((s) => s.status === "failed")) {
      await this.rollbackAll();
    }

    return [...this.steps.values()];
  }

  private dependenciesSatisfied(step: PlanStep): boolean {
    return step.dependencies.every((depId) => this.steps.get(depId)?.status === "completed");
  }

  // Returns true if this outcome should trigger RE_PLAN.
  private async runStep(step: PlanStep): Promise<boolean> {
    step.status = "running";
    const outcome = await this.runner.run(step);
    this.history.push({ stepId: step.id, outcome, at: Date.now() });

    if (outcome.kind === "success") {
      step.status = "completed";
      this.executedOrder.push(step);
      return false;
    }

    if (outcome.kind === "retryable" && step.retryCount < this.maxRetries) {
      step.retryCount += 1;
      step.status = "pending"; // same step, same dependencies, try again
      this.logger.warn(`[Orchestrator] ${step.id} retry ${step.retryCount}/${this.maxRetries}: ${outcome.error}`);
      return false;
    }

    // Exhausted retries, or a blocking outcome — either way this step
    // is done, and downstream work needs a new plan, not another attempt.
    step.status = "failed";
    this.cascadeFailure(step.id);
    this.logger.warn(`[Orchestrator] ${step.id} failed — triggering RE_PLAN: ${outcome.error}`);
    return true;
  }

  private cascadeFailure(failedId: string): void {
    for (const step of this.steps.values()) {
      if (step.status === "pending" && step.dependencies.includes(failedId)) {
        step.status = "skipped";
        this.cascadeFailure(step.id); // propagate transitively
      }
    }
  }

  private applyReplan(revised: PlanStep[]): void {
    for (const step of revised) {
      this.steps.set(step.id, step);
    }
  }

  private topologicalOrder(): PlanStep[] {
    const visited = new Set<string>();
    const order: PlanStep[] = [];

    const visit = (step: PlanStep, stack: Set<string>) => {
      if (visited.has(step.id)) return;
      if (stack.has(step.id)) throw new OrchestratorError(`dependency cycle detected at ${step.id}`);

      stack.add(step.id);
      for (const depId of step.dependencies) {
        const dep = this.steps.get(depId);
        if (!dep) throw new OrchestratorError(`${step.id} depends on unknown step ${depId}`);
        visit(dep, stack);
      }
      stack.delete(step.id);
      visited.add(step.id);
      order.push(step);
    };

    for (const step of this.steps.values()) visit(step, new Set());
    return order;
  }

  // Reverse-chronological rollback of everything actually executed.
  // runRollback must route through the sandboxed shell tool — a
  // rollback command is still model-originated executable content.
  private async rollbackAll(): Promise<void> {
    for (const step of [...this.executedOrder].reverse()) {
      if (!step.rollbackCommand) continue;
      this.logger.info(`[Orchestrator] rolling back ${step.id}: ${step.rollbackCommand}`);
      await this.runRollback(step.rollbackCommand);
    }
  }
}
