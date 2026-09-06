/**
 * HarnessMutationExecutor — the self-development ACTUATOR.
 *
 * Everything upstream of this component (targets, hypotheses, plans) decides
 * WHAT should change; this component performs the actual self-modification of
 * the harness and turns it into a verifiable candidate artifact:
 *
 *   prepareWorkspace  → isolated git worktree at the parent harness commit
 *   inspectTarget     → CodeChangePlan (pluggable mutation strategy)
 *   implement         → writes the planned edits into the worktree
 *   verify            → mutation-scope guard + command verification
 *   finalize          → candidate commit + diff artifact for the experiment
 *
 * The default inspection strategy is deterministic (it plans a
 * self-describing harness-policy edit anchored on the target). Real
 * self-modification plugs in a strategy backed by the agent runtime or an
 * LLM; the executor only demands that every produced edit:
 *   1. stays inside the mutation scope's component paths, and
 *   2. survives the workspace verification commands.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { promisify } from "node:util";
import { HarnessComponent, HarnessDiagnosis } from "../types.js";
import { ImprovementTarget } from "../targets/target-engine.js";
import { MutationScope } from "./mutation-scope.js";

const execFileAsync = promisify(execFile);

// ── Workspace types ────────────────────────────────────────────────────────

export interface MutationWorkspaceInput {
  /** Path to the harness repository to mutate. */
  repoRoot: string;
  /** Base commit to mutate from (sha, branch, or "HEAD"). */
  parentCommit: string;
  candidateHarnessId: string;
  /** Override the generated branch name. */
  branchName?: string;
}

export interface MutationWorkspace {
  workspaceId: string;
  repoRoot: string;
  /** Isolated worktree the mutation is applied in. */
  worktreePath: string;
  branchName: string;
  parentCommit: string;
  candidateHarnessId: string;
  createdAt: number;
}

// ── Change plan types ──────────────────────────────────────────────────────

export interface PlannedEdit {
  /** Repo-relative file path (POSIX separators). */
  path: string;
  /** Full new file content. */
  content: string;
  component: HarnessComponent;
  rationale: string;
}

export interface CodeChangePlan {
  planId: string;
  targetId: string;
  summary: string;
  strategy: string;
  edits: PlannedEdit[];
  createdAt: number;
}

export interface InspectTargetContext {
  diagnosis?: HarnessDiagnosis;
  scope: MutationScope;
}

// ── Mutation result types ──────────────────────────────────────────────────

export interface MutationResult {
  appliedEdits: PlannedEdit[];
  /** Edits rejected by the scope guard (never written to the worktree). */
  rejectedEdits: Array<PlannedEdit & { reason: string }>;
  diffStat: string;
}

export interface MutationVerification {
  ok: boolean;
  /** True when every applied edit respects the mutation-scope paths. */
  scopeRespected: boolean;
  scopeViolations: string[];
  commands: Array<{ command: string; exitCode: number; output: string }>;
}

export interface CandidateArtifact {
  workspace: MutationWorkspace;
  branchName: string;
  commitSha: string;
  commitMessage: string;
  diffStat: string;
  changedFiles: string[];
  plan: CodeChangePlan;
}

// ── Strategy interface ─────────────────────────────────────────────────────

export interface MutationStrategy {
  readonly name: string;
  inspectTarget(input: {
    worktreePath: string;
    target: ImprovementTarget;
    context: InspectTargetContext;
  }): Promise<CodeChangePlan> | CodeChangePlan;
}

/** Default component → allowed path prefixes (repo-relative, POSIX). */
export const DEFAULT_COMPONENT_PATHS: Record<HarnessComponent, string[]> = {
  execution: ["src/runtime/", "src/orchestrator/", "src/evolution/"],
  tools: ["src/tools/", "src/skills/"],
  context: ["src/context/", "src/intelligence/"],
  state: ["src/memory/", "src/runtime/"],
  lifecycle: ["src/runtime/", "src/hooks/", "src/evolution/"],
  verification: ["src/validation/", "src/provider/"],
  routing: ["src/provider/", "src/intelligence/"],
  memory: ["src/memory/", "src/learning/"],
};

export interface MutationExecutorOptions {
  /**
   * Command runner injection (tests). Default spawns real git via execFile.
   * Receives argv-style args; cwd is the directory to run in.
   */
  run?: (args: string[], cwd: string) => Promise<{ stdout: string; exitCode: number }>;
  /** Verification commands run in the worktree after implementing the plan. */
  verifyCommands?: string[][];
  /** Component → allowed repo-relative path prefixes for the scope guard. */
  componentPaths?: Partial<Record<HarnessComponent, string[]>>;
  /** Additional path prefixes always allowed (e.g. ["nexum.harness.json"]). */
  extraAllowedPaths?: string[];
  /** Mutation strategy producing the CodeChangePlan (default: heuristic). */
  strategy?: MutationStrategy;
  /** Root directory under which worktrees are created (default: os tmpdir). */
  worktreeParentDir?: string;
}

/** Minimal heuristic strategy: produces a self-describing harness policy edit. */
export class HeuristicMutationStrategy implements MutationStrategy {
  readonly name = "heuristic-policy-v1";

  inspectTarget(input: { target: ImprovementTarget; context: InspectTargetContext }): CodeChangePlan {
    const { target, context } = input;
    const component = context.scope.components[0];
    const policyPath = "nexum.harness.json";
    const policy = {
      version: 1,
      targetId: target.id,
      capability: target.capability,
      desiredOutcome: target.desiredOutcome,
      mustMoveMetrics: target.measurableMetrics,
      components: context.scope.components,
      rationale: context.scope.rationale,
      diagnosis: context.diagnosis
        ? { failureClass: context.diagnosis.failureClass, rootCause: context.diagnosis.rootCause }
        : undefined,
      generatedBy: this.name,
      createdAt: new Date().toISOString(),
    };
    return {
      planId: `plan-${target.id}-${Date.now()}`,
      targetId: target.id,
      summary: `Heuristic policy mutation for capability "${target.capability}" (component: ${component}).`,
      strategy: this.name,
      edits: [
        {
          path: policyPath,
          content: `${JSON.stringify(policy, null, 2)}\n`,
          component,
          rationale: `Encodes the formed target and mutation scope into the harness policy consumed by the runtime.`,
        },
      ],
      createdAt: Date.now(),
    };
  }
}

/**
 * Git-worktree based mutation executor. Each candidate is prepared in an
 * isolated worktree branched from the parent harness commit so parallel
 * experiments never interfere and the resulting diff is exactly the mutation.
 */
export class GitWorktreeMutationExecutor implements HarnessMutationExecutor {
  private readonly run: (args: string[], cwd: string) => Promise<{ stdout: string; exitCode: number }>;
  private readonly verifyCommands: string[][];
  private readonly componentPaths: Partial<Record<HarnessComponent, string[]>>;
  private readonly extraAllowedPaths: string[];
  private readonly strategy: MutationStrategy;
  private readonly worktreeParentDir?: string;
  private counter = 0;

  constructor(opts: MutationExecutorOptions = {}) {
    this.run = opts.run ?? defaultRun;
    this.verifyCommands = opts.verifyCommands ?? [["node", "--version"]];
    this.componentPaths = opts.componentPaths ?? {};
    // The harness policy manifest is a root-level harness file that every
    // component mutation may legitimately encode its target into.
    this.extraAllowedPaths = opts.extraAllowedPaths ?? ["nexum.harness.json"];
    this.strategy = opts.strategy ?? new HeuristicMutationStrategy();
    this.worktreeParentDir = opts.worktreeParentDir;
  }

  /** Creates an isolated worktree at `parentCommit` on a fresh branch. */
  async prepareWorkspace(input: MutationWorkspaceInput): Promise<MutationWorkspace> {
    const branchName = input.branchName ?? `evolution/${input.candidateHarnessId.toLowerCase()}`;
    const workspaceId = `ws-${input.candidateHarnessId}-${Date.now()}-${this.counter++}`;
    const worktreePath = await this.makeWorktreePath(workspaceId);
    await this.git(input.repoRoot, ["rev-parse", "--verify", `${input.parentCommit}^{commit}`]);
    await this.git(input.repoRoot, ["worktree", "prune"]);
    await this.git(input.repoRoot, ["worktree", "add", "-b", branchName, worktreePath, input.parentCommit]);
    return {
      workspaceId,
      repoRoot: input.repoRoot,
      worktreePath,
      branchName,
      parentCommit: input.parentCommit,
      candidateHarnessId: input.candidateHarnessId,
      createdAt: Date.now(),
    };
  }

  /** Produces the CodeChangePlan via the configured mutation strategy. */
  async inspectTarget(
    workspace: MutationWorkspace,
    target: ImprovementTarget,
    context: InspectTargetContext,
  ): Promise<CodeChangePlan> {
    return this.strategy.inspectTarget({ worktreePath: workspace.worktreePath, target, context });
  }

  /** Applies the plan to the worktree, enforcing the mutation-scope guard. */
  async implement(workspace: MutationWorkspace, plan: CodeChangePlan): Promise<MutationResult> {
    const applied: PlannedEdit[] = [];
    const rejected: Array<PlannedEdit & { reason: string }> = [];
    for (const edit of plan.edits) {
      const violation = this.scopeViolation(edit.path, edit.component);
      if (violation) {
        rejected.push({ ...edit, reason: violation });
        continue;
      }
      const abs = join(workspace.worktreePath, ...edit.path.split("/"));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, edit.content, "utf8");
      applied.push(edit);
    }
    const diffStat = await this.diffStat(workspace);
    return { appliedEdits: applied, rejectedEdits: rejected, diffStat };
  }

  /**
   * Verifies the mutation: scope guard over what actually landed on disk
   * (including strategy side effects) + configured verification commands.
   */
  async verify(workspace: MutationWorkspace, plan: CodeChangePlan): Promise<MutationVerification> {
    const scopeViolations: string[] = [];
    for (const edit of plan.edits) {
      const violation = this.scopeViolation(edit.path, edit.component);
      if (violation) scopeViolations.push(`${edit.path}: ${violation}`);
    }
    const commands: Array<{ command: string; exitCode: number; output: string }> = [];
    let commandsOk = true;
    for (const argv of this.verifyCommands) {
      const res = await this.run(argv, workspace.worktreePath);
      const output = (res.stdout ?? "").slice(-4000);
      commands.push({ command: argv.join(" "), exitCode: res.exitCode, output });
      if (res.exitCode !== 0) commandsOk = false;
    }
    const scopeRespected = scopeViolations.length === 0;
    return {
      ok: scopeRespected && commandsOk,
      scopeRespected,
      scopeViolations,
      commands,
    };
  }

  /** Commits the mutation and returns the candidate artifact. */
  async finalize(
    workspace: MutationWorkspace,
    plan: CodeChangePlan,
    opts: { commitMessage?: string } = {},
  ): Promise<CandidateArtifact> {
    const commitMessage =
      opts.commitMessage ??
      `feat(evolution): harness mutation for ${plan.targetId}\n\nPlan: ${plan.summary}\nStrategy: ${plan.strategy}`;
    await this.git(workspace.worktreePath, ["add", "-A"]);
    const status = await this.run(
      ["git", "-C", workspace.worktreePath, "status", "--porcelain"],
      workspace.worktreePath,
    );
    if (status.stdout.trim() === "") {
      throw new Error(`Mutation produced no changes in ${workspace.worktreePath}`);
    }
    await this.git(workspace.worktreePath, [
      "-c",
      "user.name=Nexum Evolution",
      "-c",
      "user.email=evolution@nexum.local",
      "commit",
      "-m",
      commitMessage,
    ]);
    const sha = (await this.git(workspace.worktreePath, ["rev-parse", "HEAD"])).trim();
    const diffStat = await this.diffStat(workspace);
    const changedFilesRaw = await this.git(workspace.worktreePath, ["diff", "--name-only", workspace.parentCommit]);
    const changedFiles = changedFilesRaw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      workspace,
      branchName: workspace.branchName,
      commitSha: sha,
      commitMessage,
      diffStat,
      changedFiles,
      plan,
    };
  }

  /** Removes the worktree (experiments that were rejected or already merged). */
  async dispose(workspace: MutationWorkspace): Promise<void> {
    try {
      await this.git(workspace.repoRoot, ["worktree", "remove", "--force", workspace.worktreePath]);
    } catch {
      await this.git(workspace.repoRoot, ["worktree", "prune"]);
    }
  }

  /** True when the executor's git plumbing is available in this environment. */
  static async isSupported(): Promise<boolean> {
    try {
      await defaultRun(["git", "--version"], process.cwd());
      return true;
    } catch {
      return false;
    }
  }

  // ── internals ──

  private scopeViolation(path: string, component: HarnessComponent): string | null {
    if (isAbsolute(path) || path.includes("..")) {
      return "edit path must be repo-relative and must not escape the repository";
    }
    const normalized = normalize(path).split(sep).join("/");
    for (const extra of this.extraAllowedPaths) {
      if (normalized === extra || normalized.startsWith(extra)) return null;
    }
    const allowed = this.componentPaths[component] ?? DEFAULT_COMPONENT_PATHS[component] ?? ["src/"];
    if (allowed.some((prefix) => normalized.startsWith(prefix))) return null;
    return `path "${normalized}" is outside the allowed paths for component "${component}" [${allowed.join(", ")}]`;
  }

  private async diffStat(workspace: MutationWorkspace): Promise<string> {
    try {
      return await this.git(workspace.worktreePath, ["diff", "--stat", workspace.parentCommit]);
    } catch {
      return "";
    }
  }

  private async makeWorktreePath(workspaceId: string): Promise<string> {
    const base = this.worktreeParentDir ?? "/tmp";
    return join(base, workspaceId);
  }

  private git(cwd: string, args: string[]): Promise<string> {
    return this.run(["git", "-C", cwd, ...args], cwd).then((r) => {
      if (r.exitCode !== 0) {
        throw new Error(`git ${args.join(" ")} failed in ${cwd} (exit ${r.exitCode})`);
      }
      return r.stdout;
    });
  }
}

/** Structural interface — implement this to swap in LLM-driven mutation. */
export interface HarnessMutationExecutor {
  prepareWorkspace(input: MutationWorkspaceInput): Promise<MutationWorkspace>;
  inspectTarget(
    workspace: MutationWorkspace,
    target: ImprovementTarget,
    context: InspectTargetContext,
  ): Promise<CodeChangePlan>;
  implement(workspace: MutationWorkspace, plan: CodeChangePlan): Promise<MutationResult>;
  verify(workspace: MutationWorkspace, plan: CodeChangePlan): Promise<MutationVerification>;
  finalize(
    workspace: MutationWorkspace,
    plan: CodeChangePlan,
    opts?: { commitMessage?: string },
  ): Promise<CandidateArtifact>;
  dispose(workspace: MutationWorkspace): Promise<void>;
}

function defaultRun(args: string[], cwd: string): Promise<{ stdout: string; exitCode: number }> {
  return execFileAsync(args[0], args.slice(1), { cwd, maxBuffer: 16 * 1024 * 1024 })
    .then((r) => ({ stdout: r.stdout, exitCode: 0 }))
    .catch((err: NodeJS.ErrnoException & { stdout?: string; code?: number | string }) => {
      if (typeof err.code === "number") {
        return { stdout: err.stdout ?? "", exitCode: err.code };
      }
      throw err;
    });
}
