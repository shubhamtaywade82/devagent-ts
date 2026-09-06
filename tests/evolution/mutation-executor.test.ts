import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  GitWorktreeMutationExecutor,
  HeuristicMutationStrategy,
  MutationStrategy,
} from "../../src/evolution/mutation/mutation-executor.js";
import { ImprovementTarget } from "../../src/evolution/targets/target-engine.js";
import { MutationScope } from "../../src/evolution/mutation/mutation-scope.js";
import { HarnessDiagnosis } from "../../src/evolution/types.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const res = await exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
  return res.stdout;
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mutrepo-"));
  await mkdir(join(root, "src", "tools"), { recursive: true });
  await exec("git", ["init", "-q", "-b", "main", root]);
  await writeFile(join(root, "src", "tools", "index.ts"), "export const tools = 1;\n", "utf8");
  await writeFile(join(root, "README.md"), "repo\n", "utf8");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

function target(): ImprovementTarget {
  return {
    id: "target-tool_utilization-1",
    capability: "tool_utilization",
    desiredOutcome: "Tool error rate drops",
    observableSymptoms: ["tool_selection failures"],
    measurableMetrics: ["reliability.toolErrorRate"],
    affectedComponents: ["tools"],
    confidence: 0.9,
    evaluationPlan: {
      successCriterion: "tool error rate drops",
      steps: [{ suite: "tool-calling", split: "visible", minRuns: 3 }],
      executorModels: ["qwen"],
    },
    sourceFailureClasses: ["tool_selection"],
    createdAt: Date.now(),
  };
}

function scope(): MutationScope {
  return {
    kind: "single_component",
    components: ["tools"],
    rationale: "default single-component scope",
  };
}

function diagnosis(): HarnessDiagnosis {
  return {
    failureClass: "tool_selection",
    component: "tools",
    evidence: [{ type: "tool_error", summary: "repeated tool argument failures" }],
    confidence: 0.8,
    rootCause: "tool schemas too broad",
    proposedFix: "prune tool schemas",
    expectedImpact: { capability: 0.05, reliability: 0.1, cost: 0 },
  };
}

describe("GitWorktreeMutationExecutor", () => {
  let repoRoot: string;
  let wsRoot: string;
  let executor: GitWorktreeMutationExecutor;

  beforeEach(async () => {
    repoRoot = await makeRepo();
    wsRoot = await mkdtemp(join(tmpdir(), "mutws-"));
    executor = new GitWorktreeMutationExecutor({
      worktreeParentDir: wsRoot,
      verifyCommands: [["node", "--version"]],
    });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(wsRoot, { recursive: true, force: true });
  });

  it("runs the full actuator: workspace → plan → implement → verify → finalize", async () => {
    const head = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
    const ws = await executor.prepareWorkspace({
      repoRoot,
      parentCommit: head,
      candidateHarnessId: "H1",
    });
    expect(ws.branchName).toBe("evolution/h1");
    expect(ws.worktreePath).toContain("ws-H1");

    const plan = await executor.inspectTarget(ws, target(), { diagnosis: diagnosis(), scope: scope() });
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].path).toBe("nexum.harness.json");

    const result = await executor.implement(ws, plan);
    expect(result.appliedEdits).toHaveLength(1);
    expect(result.rejectedEdits).toHaveLength(0);

    const verification = await executor.verify(ws, plan);
    expect(verification.ok).toBe(true);
    expect(verification.scopeRespected).toBe(true);
    expect(verification.commands.every((c) => c.exitCode === 0)).toBe(true);

    const artifact = await executor.finalize(ws, plan);
    expect(artifact.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(artifact.changedFiles).toEqual(["nexum.harness.json"]);
    expect(artifact.diffStat).toContain("nexum.harness.json");

    // The candidate commit content is the policy JSON produced by the strategy.
    const policy = JSON.parse(await readFile(join(ws.worktreePath, "nexum.harness.json"), "utf8"));
    expect(policy.capability).toBe("tool_utilization");
    expect(policy.components).toEqual(["tools"]);

    await executor.dispose(ws);
  });

  it("rejects edits outside the mutation scope's component paths", async () => {
    const head = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
    const ws = await executor.prepareWorkspace({ repoRoot, parentCommit: head, candidateHarnessId: "H2" });

    const plan = await executor.inspectTarget(ws, target(), { scope: scope() });
    const rogue = {
      ...plan,
      edits: [
        ...plan.edits,
        {
          path: "docs/evil.md",
          content: "out of scope\n",
          component: "tools" as const,
          rationale: "should be rejected",
        },
        {
          path: "../escape.md",
          content: "path traversal\n",
          component: "tools" as const,
          rationale: "should be rejected",
        },
      ],
    };

    const result = await executor.implement(ws, rogue);
    expect(result.appliedEdits).toHaveLength(1);
    expect(result.rejectedEdits).toHaveLength(2);
    expect(result.rejectedEdits[0].reason).toContain("outside the allowed paths");

    const verification = await executor.verify(ws, rogue);
    expect(verification.ok).toBe(false);
    expect(verification.scopeViolations.length).toBe(2);

    await executor.dispose(ws);
  });

  it("verification fails when a verify command exits non-zero", async () => {
    const strict = new GitWorktreeMutationExecutor({
      worktreeParentDir: repoRoot,
      verifyCommands: [["node", "-e", "process.exit(3)"]],
    });
    const head = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
    const ws = await strict.prepareWorkspace({ repoRoot, parentCommit: head, candidateHarnessId: "H3" });
    const plan = await strict.inspectTarget(ws, target(), { scope: scope() });
    await strict.implement(ws, plan);
    const verification = await strict.verify(ws, plan);
    expect(verification.ok).toBe(false);
    expect(verification.commands[0].exitCode).toBe(3);
    await strict.dispose(ws);
  });

  it("finalize refuses to create an empty candidate commit", async () => {
    const head = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
    const ws = await executor.prepareWorkspace({ repoRoot, parentCommit: head, candidateHarnessId: "H4" });
    const plan = await executor.inspectTarget(ws, target(), { scope: scope() });
    await executor.implement(ws, plan);
    await executor.finalize(ws, plan);
    // Finalizing again without further changes must fail (no empty commit).
    await expect(executor.finalize(ws, plan)).rejects.toThrow(/no changes/i);
    await executor.dispose(ws);
  });

  it("supports custom strategies for real self-modification", async () => {
    const custom: MutationStrategy = {
      name: "custom-test-strategy",
      inspectTarget: (input) => ({
        planId: "custom-1",
        targetId: input.target.id,
        summary: "custom strategy edit",
        strategy: "custom-test-strategy",
        edits: [
          {
            path: "src/tools/index.ts",
            content: "export const tools = 2; // mutated\n",
            component: "tools",
            rationale: "mutate the tools module itself",
          },
        ],
        createdAt: Date.now(),
      }),
    };
    const exec2 = new GitWorktreeMutationExecutor({
      worktreeParentDir: repoRoot,
      strategy: custom,
      verifyCommands: [["node", "--version"]],
    });
    const head = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
    const ws = await exec2.prepareWorkspace({ repoRoot, parentCommit: head, candidateHarnessId: "H5" });
    const plan = await exec2.inspectTarget(ws, target(), { scope: scope() });
    await exec2.implement(ws, plan);
    const verification = await exec2.verify(ws, plan);
    expect(verification.ok).toBe(true);
    const artifact = await exec2.finalize(ws, plan);
    expect(artifact.changedFiles).toEqual(["src/tools/index.ts"]);
    await exec2.dispose(ws);
  });

  it("default heuristic strategy is deterministic and self-describing", () => {
    const strategy = new HeuristicMutationStrategy();
    const plan = strategy.inspectTarget({ target: target(), context: { scope: scope() } });
    expect(plan.strategy).toBe("heuristic-policy-v1");
    expect(plan.targetId).toBe(target().id);
  });
});
