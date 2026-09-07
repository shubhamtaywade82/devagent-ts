import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  AgentDeclinedError,
  AgentMutationError,
  AgentMutationStrategy,
  AgentMutationRequest,
} from "../../src/evolution/mutation/agent-mutation.js";
import {
  EngineeringChatClient,
  NexumEngineeringAgentRuntime,
  chatClientFromProvider,
} from "../../src/evolution/mutation/nexum-agent-runtime.js";
import { ChatMessage, ChatResponse, Provider } from "../../src/provider/provider.js";
import { ClosedLoopEngine } from "../../src/evolution/engine-v2.js";
import { HarnessRegistry } from "../../src/evolution/registry.js";
import { TaskExecutionResult } from "../../src/evolution/evaluator.js";
import { ImprovementTarget } from "../../src/evolution/targets/target-engine.js";
import { MutationScope } from "../../src/evolution/mutation/mutation-scope.js";
import { HarnessDiagnosis } from "../../src/evolution/types.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const res = await exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
  return res.stdout;
}

/** Same tiny-harness repo as agent-mutation.test.ts: real implementation source. */
async function makeHarnessRepo(): Promise<{ repoRoot: string; wsRoot: string; head: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "nexumagentrepo-"));
  await mkdir(join(repoRoot, "src", "tools"), { recursive: true });
  await writeFile(
    join(repoRoot, "src", "tools", "schemas.ts"),
    ["export const toolSchemas = [", '  { name: "run_shell", parameters: "*" },', "];", ""].join("\n"),
    "utf8",
  );
  await exec("git", ["init", "-q", "-b", "main", repoRoot]);
  await git(repoRoot, ["add", "-A"]);
  await git(repoRoot, ["commit", "-q", "-m", "init"]);
  const head = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
  const wsRoot = await mkdtemp(join(tmpdir(), "nexumagentws-"));
  return { repoRoot, wsRoot, head };
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
  return { kind: "single_component", components: ["tools"], rationale: "default single-component scope" };
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

function results(successRate: number): TaskExecutionResult[] {
  const specs: Array<[string, boolean, boolean]> = [
    ["v1", successRate >= 0.34, false],
    ["v2", successRate >= 0.34, false],
    ["v3", successRate >= 0.67, false],
    ["h1", successRate >= 0.34, true],
    ["h2", successRate >= 0.67, true],
    ["h3", successRate, true],
  ];
  return specs.map(([taskId, success, isHeldOut]) => ({
    taskId,
    success,
    verificationPassed: success,
    toolCalls: 4,
    toolErrors: success ? 0 : 1,
    tokens: 1800,
    latencyMs: 900,
    loopAborted: false,
    isHeldOut,
  }));
}

// ── Fake chat client ──────────────────────────────────────────────────────────

type Turn = (messages: ChatMessage[]) => ChatResponse | Promise<ChatResponse>;

/**
 * Scripted multi-turn chat client: returns queued responses in order and
 * records every message so tests can assert on the conversation the runtime
 * built (tool results fed back, error corrections, etc.).
 */
class FakeChat implements EngineeringChatClient {
  readonly name = "fake-chat";
  turns: Turn[] = [];
  readonly allMessages: ChatMessage[][] = [];

  chat(messages: ChatMessage[]): Promise<ChatResponse> {
    this.allMessages.push(messages.map((m) => ({ ...m })));
    const turn = this.turns.shift();
    if (!turn) throw new Error(`FakeChat exhausted: received turn ${this.allMessages.length}`);
    return Promise.resolve(turn(messages));
  }

  static call(name: string, args: unknown): ChatResponse {
    return {
      message: { role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] },
      done: false,
    } as ChatResponse;
  }

  static text(content: string): ChatResponse {
    return { message: { role: "assistant", content }, done: false } as ChatResponse;
  }

  /** Tool messages fed back to the model so far (role "tool"), JSON-parsed. */
  toolResults(): Array<Record<string, unknown>> {
    const last = this.allMessages[this.allMessages.length - 1] ?? [];
    return last.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content) as Record<string, unknown>);
  }
}

function request(
  overrides: Partial<AgentMutationRequest> = {},
): AgentMutationRequest & { worktree: NonNullable<AgentMutationRequest["worktree"]> } {
  // The workspace view is fs-backed by the strategy; unit tests build one
  // directly over a temp dir via the strategy's public flow instead. This
  // minimal view is enough for runtime-level tests.
  const root = "__SET_BY_TEST__";
  return {
    worktree: {
      worktreePath: root,
      repoRoot: root,
      parentCommit: "HEAD",
      readFile: async (p) => {
        try {
          return await readFile(join(root, ...p.split("/")), "utf8");
        } catch {
          return null;
        }
      },
      listFiles: async (prefix) => {
        const { readdir } = await import("node:fs/promises");
        const out: string[] = [];
        const walk = async (dir: string): Promise<void> => {
          let entries;
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            if (entry.name === ".git") continue;
            const abs = join(dir, entry.name);
            const rel = abs
              .slice(root.length + 1)
              .split("/")
              .join("/");
            if (entry.isDirectory()) await walk(abs);
            else if (!prefix || rel.startsWith(prefix)) out.push(rel);
          }
        };
        await walk(root);
        return out.sort();
      },
    },
    target: target(),
    scope: scope(),
    diagnosis: diagnosis(),
    allowedPaths: ["src/tools/", "nexum.harness.json"],
    ...overrides,
  } as AgentMutationRequest & { worktree: NonNullable<AgentMutationRequest["worktree"]> };
}

describe("NexumEngineeringAgentRuntime (production agent wiring)", () => {
  let repoRoot: string;
  let wsRoot: string;
  let head: string;

  beforeEach(async () => {
    ({ repoRoot, wsRoot, head } = await makeHarnessRepo());
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(wsRoot, { recursive: true, force: true });
  });

  /** Runtime-level test request pointed at the real fixture repo. */
  function reqAtRepo(overrides: Partial<AgentMutationRequest> = {}): AgentMutationRequest {
    return request({
      worktree: {
        worktreePath: repoRoot,
        repoRoot,
        parentCommit: head,
        readFile: async (p) => {
          try {
            return await readFile(join(repoRoot, ...p.split("/")), "utf8");
          } catch {
            return null;
          }
        },
        listFiles: async (prefix) => {
          const { readdir } = await import("node:fs/promises");
          const out: string[] = [];
          const walk = async (dir: string): Promise<void> => {
            let entries;
            try {
              entries = await readdir(dir, { withFileTypes: true });
            } catch {
              return;
            }
            for (const entry of entries) {
              if (entry.name === ".git") continue;
              const abs = join(dir, entry.name);
              const rel = abs
                .slice(repoRoot.length + 1)
                .split("/")
                .join("/");
              if (entry.isDirectory()) await walk(abs);
              else if (!prefix || rel.startsWith(prefix)) out.push(rel);
            }
          };
          await walk(repoRoot);
          return out.sort();
        },
      },
      ...overrides,
    });
  }

  it("runs the bounded tool loop: inspect → propose_edit → finish, and the strategy mutates the real source", async () => {
    const chat = new FakeChat();
    chat.turns.push(() => FakeChat.call("list_files", { prefix: "src/tools" }));
    chat.turns.push((messages) => {
      // Second turn: the runtime must have fed the file list back as a tool result.
      const toolMsgs = messages.filter((m) => m.role === "tool");
      expect(toolMsgs.length).toBe(1);
      const parsed = JSON.parse(toolMsgs[0].content) as { files: string[] };
      expect(parsed.files).toEqual(["src/tools/schemas.ts"]);
      return FakeChat.call("read_file", { path: "src/tools/schemas.ts" });
    });
    chat.turns.push((messages) => {
      const toolMsgs = messages.filter((m) => m.role === "tool");
      const last = JSON.parse(toolMsgs[toolMsgs.length - 1].content) as { content: string };
      expect(last.content).toContain('parameters: "*"');
      return FakeChat.call("propose_edit", {
        path: "src/tools/schemas.ts",
        content: last.content.replace('parameters: "*"', 'parameters: "{ command: string }"'),
        rationale: "narrow the run_shell schema",
      });
    });
    chat.turns.push(() => FakeChat.call("finish", { summary: "Narrowed run_shell schema." }));

    const runtime = new NexumEngineeringAgentRuntime({ chat, maxTurns: 8 });
    const strategy = new AgentMutationStrategy({ runtime });
    expect(strategy.name).toBe("agent:nexum-engineering");

    const plan = await strategy.inspectTarget({
      worktreePath: repoRoot,
      target: target(),
      context: {
        diagnosis: diagnosis(),
        scope: scope(),
        repoRoot,
        parentCommit: head,
      },
    });

    expect(plan.strategy).toBe("agent:nexum-engineering");
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].path).toBe("src/tools/schemas.ts");
    expect(plan.edits[0].component).toBe("tools");
    expect(plan.edits[0].content).toContain('parameters: "{ command: string }"');
    expect(plan.summary).toContain("Narrowed run_shell schema.");
    // Investigation trail from the real tool calls.
    expect(plan.summary).toContain("investigated:");
  });

  it("feeds propose_edit scope violations back as tool errors the agent can self-correct", async () => {
    const chat = new FakeChat();
    chat.turns.push(() =>
      FakeChat.call("propose_edit", { path: "README.md", content: "out of scope\n", rationale: "smuggle" }),
    );
    chat.turns.push((messages) => {
      const toolMsgs = messages.filter((m) => m.role === "tool");
      const last = JSON.parse(toolMsgs[toolMsgs.length - 1].content) as { error?: string };
      expect(last.error).toContain("not under any allowed prefix");
      const original = "x";
      void original;
      return FakeChat.call("propose_edit", {
        path: "src/tools/schemas.ts",
        content: "corrected\n",
        rationale: "in scope now",
      });
    });
    chat.turns.push(() => FakeChat.call("finish", { summary: "corrected" }));

    const runtime = new NexumEngineeringAgentRuntime({ chat, maxTurns: 8 });
    const strategy = new AgentMutationStrategy({ runtime });
    const plan = await strategy.inspectTarget({
      worktreePath: repoRoot,
      target: target(),
      context: { scope: scope(), repoRoot, parentCommit: head },
    });
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].path).toBe("src/tools/schemas.ts");
  });

  it("rejects out-of-scope JSON-string proposals at queue time and honestly declines the sneaky finish", async () => {
    const chat = new FakeChat();
    // JSON-string arguments (non-Ollama provider shape) must still parse…
    chat.turns.push(() =>
      FakeChat.call(
        "propose_edit",
        JSON.stringify({ path: "README.md", content: "smuggled\n", rationale: "outside tools/" }),
      ),
    );
    // …but the runtime rejects the QUEUE here? No: propose_edit rejects at queue
    // time with an error tool result, so the agent's finish leaves zero valid
    // proposals → declined outcome (honest), NOT a plan.
    chat.turns.push((messages) => {
      const toolMsgs = messages.filter((m) => m.role === "tool");
      const last = JSON.parse(toolMsgs[toolMsgs.length - 1].content) as { error?: string };
      expect(last.error).toContain("not under any allowed prefix");
      return FakeChat.call("finish", { summary: "trying to sneak it through anyway" });
    });

    const runtime = new NexumEngineeringAgentRuntime({ chat, maxTurns: 8 });
    const strategy = new AgentMutationStrategy({ runtime });
    await expect(
      strategy.inspectTarget({
        worktreePath: repoRoot,
        target: target(),
        context: { scope: scope(), repoRoot, parentCommit: head },
      }),
    ).rejects.toBeInstanceOf(AgentDeclinedError);
  });

  it("honor the decline tool: no plan is produced", async () => {
    const chat = new FakeChat();
    chat.turns.push((messages) => {
      // The system prompt must carry the safety contract and allowed paths.
      const sys = messages.find((m) => m.role === "system");
      expect(sys?.content).toContain("NO direct write or shell access");
      expect(sys?.content).toContain("src/tools/");
      return FakeChat.call("decline", { reason: "target requires a cross-component rewrite; unsafe in this scope" });
    });

    const runtime = new NexumEngineeringAgentRuntime({ chat, maxTurns: 4 });
    const strategy = new AgentMutationStrategy({ runtime });
    await expect(
      strategy.inspectTarget({
        worktreePath: repoRoot,
        target: target(),
        context: { scope: scope(), repoRoot, parentCommit: head },
      }),
    ).rejects.toBeInstanceOf(AgentDeclinedError);
  });

  it("aborts when the turn budget is exhausted without finish/decline", async () => {
    const chat = new FakeChat();
    for (let i = 0; i < 5; i++) chat.turns.push(() => FakeChat.text("thinking…"));

    const runtime = new NexumEngineeringAgentRuntime({ chat, maxTurns: 4 });
    await expect(runtime.proposeMutation(reqAtRepo())).rejects.toBeInstanceOf(AgentMutationError);
  });

  it("nudges pure-text turns and still lets the loop finish", async () => {
    const chat = new FakeChat();
    chat.turns.push(() => FakeChat.text("I will use tools now."));
    chat.turns.push((messages) => {
      // The nudge must have been appended after the text-only assistant turn.
      const users = messages.filter((m) => m.role === "user");
      expect(users[users.length - 1].content).toContain("Respond only through the provided tools");
      return FakeChat.call("propose_edit", {
        path: "src/tools/schemas.ts",
        content: "export const toolSchemas = [];\n",
        rationale: "in-scope",
      });
    });
    chat.turns.push(() => FakeChat.call("finish", { summary: "done after nudge" }));

    const runtime = new NexumEngineeringAgentRuntime({ chat, maxTurns: 6 });
    const response = await runtime.proposeMutation(reqAtRepo());
    expect(response.edits).toHaveLength(1);
    expect(response.summary).toBe("done after nudge");
  });

  it("returns an honest decline when the agent finishes with zero proposals", async () => {
    const chat = new FakeChat();
    chat.turns.push(() => FakeChat.call("read_file", { path: "src/tools/schemas.ts" }));
    chat.turns.push(() => FakeChat.call("finish", { summary: "nothing safe to change" }));

    const runtime = new NexumEngineeringAgentRuntime({ chat, maxTurns: 6 });
    const response = await runtime.proposeMutation(reqAtRepo());
    expect(response.edits).toHaveLength(0);
    expect(response.declined?.reason).toContain("without any proposed edit");
    expect(response.investigation.join(" ")).toContain("read_file(src/tools/schemas.ts)");
  });

  it("rejects oversized edits at queue time with a readable tool error", async () => {
    const chat = new FakeChat();
    chat.turns.push(() =>
      FakeChat.call("propose_edit", { path: "src/tools/schemas.ts", content: "x".repeat(100), rationale: "small" }),
    );
    chat.turns.push(() => FakeChat.call("finish", { summary: "nothing usable" }));
    const runtime = new NexumEngineeringAgentRuntime({ chat, maxTurns: 6, maxEditBytes: 8 });
    const response = await runtime.proposeMutation(reqAtRepo());
    const results = chat.toolResults();
    expect((results[0] as { error: string }).error).toContain("per-edit cap");
    expect(response.declined).toBeDefined();
  }, 20000);

  it("reports unknown tools back to the agent and continues the loop", async () => {
    const chat = new FakeChat();
    chat.turns.push(() => FakeChat.call("delete_everything", {}));
    chat.turns.push((messages) => {
      const toolMsgs = messages.filter((m) => m.role === "tool");
      const last = JSON.parse(toolMsgs[toolMsgs.length - 1].content) as { error?: string };
      expect(last.error).toContain("unknown tool");
      return FakeChat.call("finish", { summary: "ok, staying with the protocol" });
    });
    const runtime = new NexumEngineeringAgentRuntime({ chat, maxTurns: 6 });
    const response = await runtime.proposeMutation(reqAtRepo());
    expect(response.edits).toHaveLength(0);
    expect(response.declined).toBeDefined();
  });

  it("fires the onTurn observability hook per completed turn", async () => {
    const chat = new FakeChat();
    chat.turns.push(() => FakeChat.call("list_files", {}));
    chat.turns.push(() => FakeChat.call("finish", { summary: "done" }));
    const turns: Array<[number, string[]]> = [];
    const runtime = new NexumEngineeringAgentRuntime({
      chat,
      maxTurns: 4,
      onTurn: (n, calls) => turns.push([n, calls]),
    });
    await runtime.proposeMutation(reqAtRepo());
    expect(turns).toEqual([
      [1, ["list_files"]],
      [2, ["finish"]],
    ]);
  });

  it("chatClientFromProvider forwards tools and pinned model to provider.chat", async () => {
    const calls: Array<{ messages: ChatMessage[]; opts: Record<string, unknown> }> = [];
    const fakeProvider = {
      chat: (messages: ChatMessage[], opts: Record<string, unknown> = {}) => {
        calls.push({ messages, opts });
        return Promise.resolve(FakeChat.text("unused"));
      },
    } as unknown as Provider;

    const client = chatClientFromProvider(fakeProvider, "pinned-model");
    await client.chat([{ role: "user", content: "hi" }], {
      tools: [{ type: "function", function: { name: "t", description: "", parameters: {} } }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.model).toBe("pinned-model");
    expect(Array.isArray(calls[0].opts.tools)).toBe(true);
  });
});

describe("ClosedLoopEngine with agentRuntime (production wiring, no explicit executor)", () => {
  let repoRoot: string;
  let wsRoot: string;
  let head: string;
  let registry: HarnessRegistry;

  beforeEach(async () => {
    ({ repoRoot, wsRoot, head } = await makeHarnessRepo());
    registry = new HarnessRegistry(":memory:");
  });

  afterEach(async () => {
    registry.close();
    await rm(repoRoot, { recursive: true, force: true });
    await rm(wsRoot, { recursive: true, force: true });
  });

  it("auto-builds the agent-backed executor and runs a full self-developing cycle", async () => {
    const chat = new FakeChat();
    // The production agent inspects then proposes over the REAL worktree: the
    // runtime hands the model the actual file content via tool results.
    chat.turns.push(() => FakeChat.call("read_file", { path: "src/tools/schemas.ts" }));
    chat.turns.push((messages) => {
      const toolMsgs = messages.filter((m) => m.role === "tool");
      const last = JSON.parse(toolMsgs[toolMsgs.length - 1].content) as { content: string };
      expect(last.content).toContain("run_shell");
      return FakeChat.call("propose_edit", {
        path: "src/tools/schemas.ts",
        content: last.content.replace('parameters: "*"', 'parameters: "{ command: string }"'),
        rationale: "narrow schema to cut tool errors",
      });
    });
    chat.turns.push(() => FakeChat.call("finish", { summary: "Narrowed run_shell parameter schema." }));

    const engine = new ClosedLoopEngine({
      registry,
      executorModels: ["qwen3-coder"],
      agentRuntime: new NexumEngineeringAgentRuntime({ chat, maxTurns: 8 }),
      agentVerifyCommands: [["node", "--version"]],
    });

    const observation = engine.observe([
      {
        id: "ep-1",
        goal: "Fix tool selection",
        startedAt: 1000,
        endedAt: 2000,
        terminal: "loop_abort",
        toolEvents: [
          { name: "read_file", args: {}, ok: true, durationMs: 50, at: 1001 },
          {
            name: "run_shell",
            args: {},
            ok: false,
            durationMs: 100,
            at: 1002,
            errorLabel: "Argument validation failed",
          },
        ],
        activatedSkillIds: [],
        finalAssistantText: "",
        grade: {
          verdict: "failure",
          score: 0.2,
          signals: {
            testsRan: true,
            testsPassed: false,
            toolErrorRate: 0.7,
            pathEscapes: 0,
            patchFailures: 0,
            loopAborted: true,
            turnCount: 5,
            retriedSameToolMax: 2,
          },
        },
      },
    ]);

    const res = await engine.runEvolutionCycle({
      experimentId: "exp-nexum-agent-1",
      parentHarnessId: "H0",
      parentCommit: head,
      candidateHarnessId: "H1",
      repoRoot,
      target: observation.target!,
      diagnosis: observation.diagnoses[0],
      scope: { kind: "single_component", components: ["tools"], rationale: "pinned" },
      baselineResults: results(0.4),
      experienceDigest: "cap=tool_utilization failures=12",
      evaluateCandidate: () => results(0.9),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mutation.plan!.strategy).toBe("agent:nexum-engineering");
    expect(res.mutation.artifact!.changedFiles).toEqual(["src/tools/schemas.ts"]);
    expect(res.outcome.twoStage.decision).toBe("eligible");
    // Workspace disposed on exit; candidate branch survives.
    const branchHead = (await git(repoRoot, ["rev-parse", "evolution/h1"])).trim();
    expect(branchHead).toBe(res.mutation.artifact!.commitSha);
    const { stat } = await import("node:fs/promises");
    await expect(stat(res.mutation.workspace!.worktreePath)).rejects.toBeTruthy();
  });

  it("still requires SOME actuator: no mutationExecutor and no agentRuntime throws", async () => {
    const engine = new ClosedLoopEngine({ registry });
    await expect(
      engine.runEvolutionCycle({
        experimentId: "exp-none",
        parentHarnessId: "H0",
        parentCommit: head,
        candidateHarnessId: "H1",
        repoRoot,
        target: target(),
        diagnosis: diagnosis(),
        scope: scope(),
        baselineResults: results(0.4),
        evaluateCandidate: () => results(0.9),
      }),
    ).rejects.toThrow("agentRuntime");
  });
});
