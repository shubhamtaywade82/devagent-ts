# Hybrid Cloud-Orchestration Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the six already-built-but-dormant hybrid local/cloud components (`HeuristicRouter`, `LocalWorker`, `SelfConsistency`, `ModelAvailabilityChecker`, the `delegate_to_local` tool) into the live turn loop in `src/cli/agent.ts`, per the user-approved "Final Full E2E Implementation Plan: Hybrid Local-Cloud Architecture" doc, while reusing this codebase's existing Agent/Router/tool-registry primitives instead of duplicating the doc's pseudo-code classes (`CloudOrchestrator`, `Executor`, `Validator` already exist here as `Agent.runUserMessage`, `Router`, `tools.registry`).

**Architecture:** Layer 1 (heuristic gate) runs before the turn loop and can escalate straight to the primary/cloud model, skipping the existing quick-model-first attempt. For prompts the gate calls "unknown" and that don't require tool evidence, a self-consistency sample check on the quick model provides a second, cheap escalation signal. Once escalated (by any of the existing three mechanisms — heuristic gate, self-consistency, or the model's own `escalate_task` call), the primary model is offered a new `delegate_to_local` tool so it can push simple boilerplate back down to the local `LocalWorker` instead of generating it itself — the "cloud-first, delegate down" half of the doc's architecture. `Router` also stops throwing on a subscription-gated cloud candidate instead of failing the whole turn.

**Tech Stack:** TypeScript, Jest. No new dependencies.

## Global Constraints

- Do not introduce new top-level classes that duplicate existing Agent/Router/Registry responsibilities — this plan is wiring, not a rewrite.
- `Verifier` (same-model self-critique) and `KeyManager` (multi-cloud-model concurrency) stay unwired per explicit user decision context gathered before this plan — `Verifier` reproduces a documented dead end (`src/cli/agent.ts` comment, lines ~377-384: minicpm5-1b rubber-stamps its own output when asked to self-critique) and `KeyManager` has no caller since nothing in this plan issues concurrent calls to two different cloud models. Both remain as tested, dormant code; do not delete them, do not wire them into this plan's tasks.
- Every new/changed behavior is covered by a test that asserts the *new* behavior; every existing test whose asserted behavior this plan intentionally changes must be updated in the same task that causes the change, so `npm test` stays green after each task.
- Follow existing code conventions exactly: `Tool` subclasses in `src/tools/`, optional hybrid components stored as `X | undefined` fields set once in the constructor (mirrors `localWorker`/`verifier`/`selfConsistency`), `onStatus` emits as user-facing strings, config flags read via `fromEnv(...) !== "false" && (file.x ?? true)` for default-true flags.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/provider/router.ts` | Modify: treat a subscription-required `ProviderError` as recoverable so a 403-gated cloud candidate doesn't kill the whole turn. |
| `tests/provider/router.test.ts` | Add: covering test. |
| `src/cli/config.ts` | Modify: add `enableHeuristicGate` flag (default true). |
| `tests/cli/config.test.ts` | Add: covering test. |
| `src/cli/agent.ts` | Modify: `heuristicRouter` becomes optional (undefined when disabled); wire the Layer-1 heuristic gate + self-consistency check before the turn loop; force-include and wire up `delegate_to_local` once escalated; inject the delegation system-prompt addendum once. |
| `tests/cli/agent-capability-routing.test.ts` | Modify 3 existing tests whose asserted behavior changes; add 3 new tests (heuristic-gate opt-out, self-consistency agree/diverge, delegation round-trip). |
| `src/tools/delegate-tool.ts` | Rewrite: turn the existing raw-schema constants into a registrable `DelegateToLocalTool extends Tool`, backed by `LocalWorker`. |
| `tests/tools/delegate-tool.test.ts` | New file: unit tests for the tool. |
| `src/cli/agent-tools.ts` | Modify: add `registerHybridTools(localWorker)` that registers `DelegateToLocalTool` when a `LocalWorker` is present. |

---

### Task 1: Router — treat a subscription-required error as recoverable

**Files:**
- Modify: `src/provider/router.ts:73-83` (the `isRecoverable` method)
- Test: `tests/provider/router.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this only widens `Router.isRecoverable`'s existing boolean contract.

- [ ] **Step 1: Write the failing test**

Add to `tests/provider/router.test.ts`, after the `"treats a 'does not support tools' ProviderError as recoverable and falls through"` test (after line 126):

```ts
  it("treats a subscription-required ProviderError as recoverable and falls through to the next cloud candidate", async () => {
    const local = new Provider({ tier: "local", model: "x" });
    const cloud = new Provider({ tier: "cloud", model: "x", apiKey: "k" });
    const catalog = new ModelCatalog(local, cloud);

    jest.spyOn(local, "availableModels").mockResolvedValue({ models: [] });
    jest.spyOn(cloud, "availableModels").mockResolvedValue({
      data: [{ id: "llama3.3:70b" }, { id: "qwen3.5:8b" }],
    });
    await catalog.refresh();

    const cloudChat = jest
      .spyOn(cloud, "chat")
      .mockRejectedValueOnce(new ProviderError("Ollama cloud 403: subscription required for llama3.3:70b"))
      .mockResolvedValueOnce(okResponse("from second cloud model"));

    const router = new Router({ local, cloud, catalog, logger: { warn: jest.fn() } });
    const result = await router.route("coding", [{ role: "user", content: "hi" }]);

    expect(result.message.content).toBe("from second cloud model");
    expect(cloudChat).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/provider/router.test.ts -t "subscription-required"`
Expected: FAIL — the first `cloud.chat` rejection propagates because `isRecoverable` doesn't yet recognize a subscription error, so `router.route` rejects instead of returning `"from second cloud model"`.

- [ ] **Step 3: Write minimal implementation**

In `src/provider/router.ts`, in `isRecoverable`:

```ts
  private isRecoverable(e: unknown): boolean {
    if (e instanceof RateLimitError) return true;
    if (e instanceof TimeoutError) return true;
    if (e instanceof TypeError) return true;
    // The catalog's capability filter should already exclude these, but if a
    // model still gets picked that rejects tool schemas outright, that's a
    // wrong-candidate problem, not a fatal one — try the next candidate.
    if (e instanceof ProviderError && /does not support tools/i.test(e.message)) return true;
    // Same reasoning for a candidate gated behind a paid subscription tier —
    // ModelAvailabilityChecker should ideally have filtered it out already,
    // but if it slips through, don't fail the whole turn over it.
    if (e instanceof ProviderError && /subscription/i.test(e.message)) return true;
    return false;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/provider/router.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/provider/router.ts tests/provider/router.test.ts
git commit -m "fix: treat subscription-required cloud errors as recoverable in Router"
```

---

### Task 2: Config — add `enableHeuristicGate` flag

**Files:**
- Modify: `src/cli/config.ts`
- Test: `tests/cli/config.test.ts`

**Interfaces:**
- Produces: `CliConfig.enableHeuristicGate: boolean` (default `true`), overridable via `DEVAGENT_HEURISTIC_GATE=false` env var or `enableHeuristicGate: false` in the workspace config file. Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Add to `tests/cli/config.test.ts`, as a new top-level `describe` block appended after the existing `"workspace root resolution..."` block:

```ts
describe("enableHeuristicGate flag", () => {
  const originalEnv = { ...process.env };
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "config-test-"));
    process.env.DEVAGENT_WORKSPACE = workspaceRoot;
    delete process.env.DEVAGENT_HEURISTIC_GATE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to true", () => {
    expect(loadConfig().enableHeuristicGate).toBe(true);
  });

  it("is false when DEVAGENT_HEURISTIC_GATE=false", () => {
    process.env.DEVAGENT_HEURISTIC_GATE = "false";
    expect(loadConfig().enableHeuristicGate).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/cli/config.test.ts -t "enableHeuristicGate"`
Expected: FAIL — `loadConfig().enableHeuristicGate` is `undefined`, not `true`/`false`.

- [ ] **Step 3: Write minimal implementation**

In `src/cli/config.ts`, add to the `CliConfig` interface (near the other hybrid-architecture flags, after `enableAvailabilityCheck?: boolean;`):

```ts
  /** Layer-1 heuristic gate: skip the quick-model attempt entirely when the
   * prompt matches an explicit complexity trigger (debug/architecture/proof/
   * multi-step/etc.), escalating straight to the primary model instead.
   * Default true. Disable with DEVAGENT_HEURISTIC_GATE=false. */
  enableHeuristicGate?: boolean;
```

Add to the `ConfigFile` interface, after `enableAvailabilityCheck?: boolean;`:

```ts
  enableHeuristicGate?: boolean;
```

In `loadConfig()`'s return object, after the `enableAvailabilityCheck` line:

```ts
    enableHeuristicGate: fromEnv("DEVAGENT_HEURISTIC_GATE") !== "false" && (file.enableHeuristicGate ?? true),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/cli/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts tests/cli/config.test.ts
git commit -m "feat: add enableHeuristicGate config flag"
```

---

### Task 3: Agent — wire `HeuristicRouter` as the Layer-1 escalation gate

**Files:**
- Modify: `src/cli/agent.ts`
- Test: `tests/cli/agent-capability-routing.test.ts`

**Interfaces:**
- Consumes: `CliConfig.enableHeuristicGate` (Task 2), `HeuristicRouter.classify(prompt): HeuristicResult` (already built, `src/provider/heuristic-router.ts`).
- Produces: `Agent.heuristicRouter: HeuristicRouter | undefined` (was non-optional `HeuristicRouter`). `escalated` can now become `true` before the turn loop starts. This is consumed by Task 4 (self-consistency, same code block) and Task 6 (delegation force-include, reads `escalated`).

This task **intentionally changes observable behavior**: prompts matching a `CLOUD_TRIGGERS` pattern in `HeuristicRouter` (e.g. containing "implement", "architecture", "debug", "why", "trade-off") now skip the quick-model attempt and go straight to the primary/escalated model. Three existing tests assert the *old* behavior (no pre-filter) and must be updated in this task, not left broken.

- [ ] **Step 1: Write the failing tests**

In `tests/cli/agent-capability-routing.test.ts`, replace the test titled `"attempts the local quick model first even for a code-writing request (no pre-filter gate anymore)"` (the whole `it(...)` block) with:

```ts
  it("escalates immediately via the heuristic pre-filter for an implementation request, skipping the quick attempt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      return chatResponse("implemented");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model" },
      events: { onStatus },
    });

    const reply = await agent.runUserMessage("implement JWT authentication in AuthController");

    expect(reply).toBe("implemented");
    expect(onStatus).toHaveBeenCalledWith(
      expect.stringContaining('escalating to primary model: heuristic pre-filter matched "algorithm"'),
    );
    expect(chatBodies()[0].model).toBe("test-model");
  });

  it("skips the heuristic pre-filter when enableHeuristicGate is false, trying the quick model first as before", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      return chatResponse("implemented");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model", enableHeuristicGate: false },
      events: { onStatus },
    });

    await agent.runUserMessage("implement JWT authentication in AuthController");

    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("delegating task to local/minicpm5-1b"));
    expect(chatBodies()[0].model).toBe("minicpm5-1b");
  });
```

In the same file, in the test `"escalates to the primary model when the quick model calls escalate_task, preserving full conversation history"`, replace the prompt (it currently matches the heuristic gate's own "debug"/"algorithm" triggers via "implement"/"refactor", which would now short-circuit before the quick model ever runs — defeating the point of this tool-driven-escalation test):

Change:
```ts
    const reply = await agent.runUserMessage("implement a complex multi-file refactor");
```
to:
```ts
    const reply = await agent.runUserMessage("reorganize the user settings module so it matches the rest of the codebase");
```

And change the two assertions further down that check for the old substring:
```ts
    expect(turn1Messages.some((m) => m.role === "user" && String(m.content).includes("complex multi-file refactor"))).toBe(true);
```
to:
```ts
    expect(turn1Messages.some((m) => m.role === "user" && String(m.content).includes("user settings module"))).toBe(true);
```

Replace the test `"routes escalation to the installed reasoning model when the original message hinted at reasoning"` in full (its prompt also trips the heuristic gate's "design" trigger via "architecture"/"trade-offs", so the tool-driven `escalate_task` round-trip it exercised no longer happens for this prompt — it now escalates in one shot):

```ts
  it("routes straight to the installed reasoning model when the heuristic gate and the reasoning hint both match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
          { name: "deepseek-r1:8b", capabilities: ["thinking", "completion", "tools"], details: { parameter_size: "8B" } },
        ]);
      }
      return chatResponse("here are the trade-offs");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "primary-model" },
      events: { onStatus },
    });

    const reply = await agent.runUserMessage("What are the trade-offs of this architecture before we commit to it?");

    expect(reply).toBe("here are the trade-offs");
    expect(onStatus).toHaveBeenCalledWith(
      expect.stringContaining('escalating to primary model: heuristic pre-filter matched "design"'),
    );
    // escalationHint (vision/reasoning) is computed from the raw message regardless
    // of which mechanism triggered escalation, so a heuristic-triggered turn still
    // routes to the installed reasoning model, not just the primary/default model.
    expect(chatBodies()[0].model).toBe("deepseek-r1:8b");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/cli/agent-capability-routing.test.ts`
Expected: FAIL — `heuristicRouter` is not yet consulted, so all three rewritten/new tests see the old (quick-model-first) behavior instead.

- [ ] **Step 3: Write minimal implementation**

In `src/cli/agent.ts`, change the field declaration (around line 80):

```ts
  readonly heuristicRouter: HeuristicRouter;
```
to:
```ts
  readonly heuristicRouter: HeuristicRouter | undefined;
```

Change the constructor assignment (around line 130):

```ts
    // ── Hybrid local-cloud architecture: instantiate all components ─────────
    this.heuristicRouter = new HeuristicRouter();
```
to:
```ts
    // ── Hybrid local-cloud architecture: instantiate all components ─────────
    // Layer-1 gate: undefined when disabled, mirroring the other optional
    // hybrid components below (localWorker/verifier/selfConsistency).
    this.heuristicRouter = cfg.enableHeuristicGate ? new HeuristicRouter() : undefined;
```

In `runUserMessage`, insert between the existing `let escalated = false;` and `await this.ensureCatalog();` (around line 335-337):

```ts
    let escalated = false;
    let delegationAddendumInjected = false;
    const injectDelegationAddendum = () => {
      if (this.localWorker && !delegationAddendumInjected) {
        this.conversation.pushSystemMessage(LOCAL_DELEGATION_SYSTEM_ADDENDUM);
        delegationAddendumInjected = true;
      }
    };

    // Layer-1 heuristic gate: an explicit complexity trigger (debug/architecture/
    // proof/multi-step/etc.) skips the quick-model attempt entirely instead of
    // waiting for the quick model to discover it's out of its depth and call
    // escalate_task.
    if (this.heuristicRouter) {
      const heuristic = this.heuristicRouter.classify(userMessage);
      if (heuristic.decision === "cloud") {
        escalated = true;
        injectDelegationAddendum();
        this.emit(
          "onStatus",
          `escalating to primary model: heuristic pre-filter matched "${heuristic.trigger}"`,
        );
      }
    }

    await this.ensureCatalog();
```

`injectDelegationAddendum` and `LOCAL_DELEGATION_SYSTEM_ADDENDUM` are used here in preparation for Task 6 (which adds the import and the two other call sites); the import itself is added in Task 6 to keep this task's diff focused on the gate. For this task alone, temporarily stub the constant inline so the file compiles:

Add this import near the top of `src/cli/agent.ts`, in the "Hybrid local-cloud architecture" import block (it will be reused as-is by Task 6, no further edit needed there):

```ts
import { LOCAL_DELEGATION_SYSTEM_ADDENDUM } from "../tools/delegate-tool.js";
```

(`LOCAL_DELEGATION_SYSTEM_ADDENDUM` already exists as an export in the current `src/tools/delegate-tool.ts` — Task 5 rewrites that file but keeps this export, so this import stays valid across both tasks regardless of execution order.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/cli/agent-capability-routing.test.ts`
Expected: PASS — all tests in the file, including the untouched ones (vision routing, tool-error recovery, `maxActiveTools` cap), stay green.

- [ ] **Step 5: Run the full suite to check for other collateral prompts**

Run: `npx jest`
Expected: PASS. (Already verified by manual regex trace during planning that no other test file's `runUserMessage(...)` prompts collide with `HeuristicRouter`'s `CLOUD_TRIGGERS`/`LOCAL_TRIGGERS` patterns — `tests/cli/agent-conversation.test.ts`, `agent-resume.test.ts`, `agent-events.test.ts`. If this run surfaces an unexpected failure, it means a prompt in one of those files matches a trigger pattern; fix by rewording that test's prompt the same way this task reworded `agent-capability-routing.test.ts`'s prompts, not by weakening the trigger patterns.)

- [ ] **Step 6: Commit**

```bash
git add src/cli/agent.ts tests/cli/agent-capability-routing.test.ts
git commit -m "feat: wire HeuristicRouter as the Layer-1 escalation gate"
```

---

### Task 4: Agent — wire `SelfConsistency` for ambiguous, tool-evidence-free turns

**Files:**
- Modify: `src/cli/agent.ts`
- Test: `tests/cli/agent-capability-routing.test.ts`

**Interfaces:**
- Consumes: `Agent.selfConsistency: SelfConsistency | undefined` (already built and instantiated, gated on `cfg.enableSelfConsistency`, default `false`), `SelfConsistency.evaluate(prompt): Promise<SelfConsistencyResult>` (`src/provider/self-consistency.ts`), `requiresToolEvidence` (existing local variable in `runUserMessage`), the `heuristic` variable and `injectDelegationAddendum`/`escalated` from Task 3's block.
- Produces: nothing new for other tasks — this only adds a second escalation trigger inside the block Task 3 created.

This task only fires when `enableSelfConsistency` is explicitly turned on (default off), so it changes no default-config test's behavior.

- [ ] **Step 1: Write the failing tests**

Add to `tests/cli/agent-capability-routing.test.ts`:

```ts
  it("stays on the quick model when self-consistency samples agree on an ambiguous prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      return chatResponse("call it Account");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: {
        workspaceRoot: dir,
        tier: "local",
        model: "primary-model",
        quickModel: "minicpm5-1b",
        enableSelfConsistency: true,
      },
      events: { onStatus },
    });

    const reply = await agent.runUserMessage("should I call this a UserAccount or an Account");

    expect(reply).toBe("call it Account");
    expect(onStatus).not.toHaveBeenCalledWith(expect.stringContaining("low self-consistency agreement"));
    // chatBodies()[0..2] are the 3 self-consistency samples; [3] is the real quick turn.
    expect(chatBodies()[3].model).toBe("minicpm5-1b");
  });

  it("escalates to the primary model when self-consistency samples diverge on an ambiguous prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      if (call === 2) return chatResponse("call it Account");
      if (call === 3) return chatResponse("call it UserProfile");
      if (call === 4) return chatResponse("neither, use Customer");
      return chatResponse("here's my recommendation");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: {
        workspaceRoot: dir,
        tier: "local",
        model: "primary-model",
        quickModel: "minicpm5-1b",
        enableSelfConsistency: true,
      },
      events: { onStatus },
    });

    const reply = await agent.runUserMessage("should I call this a UserAccount or an Account");

    expect(reply).toBe("here's my recommendation");
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("low self-consistency agreement"));
    // chatBodies()[0..2] are the 3 diverging samples; [3] is the escalated primary-model turn.
    expect(chatBodies()[3].model).toBe("primary-model");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/cli/agent-capability-routing.test.ts -t "self-consistency"`
Expected: FAIL — `selfConsistency` is never consulted yet, so both tests only see 2 fetch calls (catalog + the direct quick turn), not 5.

- [ ] **Step 3: Write minimal implementation**

In `src/cli/agent.ts`, extend the block Task 3 added:

```ts
    if (this.heuristicRouter) {
      const heuristic = this.heuristicRouter.classify(userMessage);
      if (heuristic.decision === "cloud") {
        escalated = true;
        injectDelegationAddendum();
        this.emit(
          "onStatus",
          `escalating to primary model: heuristic pre-filter matched "${heuristic.trigger}"`,
        );
      } else if (heuristic.decision === "unknown" && !requiresToolEvidence && this.selfConsistency) {
        // Self-consistency, not verbalized self-confidence: measures agreement
        // across independent samples rather than asking the model to judge its
        // own output (that approach was tried and rejected — see the comment
        // above requiresToolEvidence's verifyingLookup/verifyingRecovery usage).
        const sc = await this.selfConsistency.evaluate(userMessage);
        if (sc.shouldEscalate) {
          escalated = true;
          injectDelegationAddendum();
          this.emit(
            "onStatus",
            `escalating to primary model: low self-consistency agreement (${sc.score.toFixed(2)})`,
          );
        }
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/cli/agent-capability-routing.test.ts`
Expected: PASS — all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/cli/agent.ts tests/cli/agent-capability-routing.test.ts
git commit -m "feat: wire SelfConsistency as an escalation signal for ambiguous, tool-free prompts"
```

---

### Task 5: `DelegateToLocalTool` — convert to a registrable `Tool`

**Files:**
- Rewrite: `src/tools/delegate-tool.ts`
- Test: `tests/tools/delegate-tool.test.ts` (new file)

**Interfaces:**
- Consumes: `LocalWorker` (`src/provider/local-worker.ts`, already built) via constructor injection, matching the `Tool` base class contract (`src/tools/tool.ts`).
- Produces: `export class DelegateToLocalTool extends Tool` with `name === "delegate_to_local"`, `call(args): Promise<{success: true, output: string} | {success: false, error: string}>`. `export const LOCAL_DELEGATION_SYSTEM_ADDENDUM: string` (unchanged, already consumed by Task 3/4/6). Consumed by Task 6.

The current file only exports a raw `OllamaToolSchema` constant and a `parseDelegateArgs` helper — neither is ever imported anywhere else in `src/` (verified: `grep -rn "DELEGATE_TO_LOCAL_TOOL\|parseDelegateArgs" src` outside this file returns nothing), so both are dead weight now that a real `Tool` subclass replaces them; this task deletes them rather than keeping two parallel definitions of the same schema.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/delegate-tool.test.ts`:

```ts
import { DelegateToLocalTool } from "../../src/tools/delegate-tool.js";
import type { LocalWorker, LocalResult } from "../../src/provider/local-worker.js";

function makeWorker(result: LocalResult): LocalWorker {
  return { execute: jest.fn(async () => result) } as unknown as LocalWorker;
}

describe("DelegateToLocalTool", () => {
  it("exposes the delegate_to_local schema", () => {
    const tool = new DelegateToLocalTool(makeWorker({ success: true, attempts: 1 }));
    expect(tool.schema.function.name).toBe("delegate_to_local");
    expect(tool.schema.function.parameters).toMatchObject({
      required: ["task_type", "prompt", "expected_output"],
    });
  });

  it("returns success:true with the worker's output on success", async () => {
    const worker = makeWorker({ success: true, output: "interface User { name: string; }", attempts: 1 });
    const tool = new DelegateToLocalTool(worker);

    const result = await tool.call({
      task_type: "ts_interface",
      prompt: "Generate an interface for User with name:string",
      expected_output: "typescript",
    });

    expect(result).toEqual({ success: true, output: "interface User { name: string; }" });
    expect(worker.execute).toHaveBeenCalledWith({
      type: "ts_interface",
      prompt: "Generate an interface for User with name:string",
      expectedOutput: "typescript",
      examples: undefined,
    });
  });

  it("returns success:false with the worker's error on failure, without throwing", async () => {
    const worker = makeWorker({ success: false, error: "Output failed validation after 2 attempts", attempts: 2 });
    const tool = new DelegateToLocalTool(worker);

    const result = await tool.call({
      task_type: "regex",
      prompt: "Write a regex for email addresses",
      expected_output: "regex",
    });

    expect(result).toEqual({ success: false, error: "Output failed validation after 2 attempts" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/tools/delegate-tool.test.ts`
Expected: FAIL with a compile/import error — `DelegateToLocalTool` doesn't exist yet in `src/tools/delegate-tool.ts`.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/tools/delegate-tool.ts`:

```ts
import { Tool } from "./tool.js";
import { LocalWorker, LocalTask, LocalTaskType, LocalOutputType } from "../provider/local-worker.js";

/**
 * Exposed to the primary/cloud model once a turn has escalated, letting it
 * delegate simple, stateless boilerplate back down to the local quick model
 * instead of spending primary-model tokens generating it itself.
 */
export class DelegateToLocalTool extends Tool {
  constructor(private readonly worker: LocalWorker) {
    super();
  }

  get name(): string {
    return "delegate_to_local";
  }

  get description(): string {
    return [
      "Delegates a simple, stateless coding task to a fast local model.",
      "USE for: TypeScript interface generation, regex patterns, Jest test skeletons, data format conversion, log/error extraction.",
      "DO NOT use for: complex logic, debugging, multi-step reasoning, framework APIs, or anything requiring cross-file context.",
      "If this tool returns { success: false }, handle the task yourself — do not call it again.",
    ].join(" ");
  }

  get tags(): string[] {
    return ["meta", "delegation"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        task_type: {
          type: "string",
          enum: ["ts_interface", "regex", "parse", "format", "test_skeleton", "boilerplate"],
          description: "Category of the delegated task.",
        },
        prompt: {
          type: "string",
          description:
            "Explicit, self-contained prompt for the local model. Include exact inputs and expected output format. Keep under 400 tokens.",
        },
        expected_output: {
          type: "string",
          enum: ["typescript", "json", "regex", "text", "code"],
          description: "The output type the local model should produce.",
        },
        examples: {
          type: "array",
          description: "Optional few-shot examples to guide the local model.",
          items: {
            type: "object",
            properties: { input: { type: "string" }, output: { type: "string" } },
            required: ["input", "output"],
          },
        },
      },
      required: ["task_type", "prompt", "expected_output"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const task: LocalTask = {
      type: args.task_type as LocalTaskType,
      prompt: String(args.prompt ?? ""),
      expectedOutput: args.expected_output as LocalOutputType,
      examples: Array.isArray(args.examples)
        ? (args.examples as Array<{ input: string; output: string }>)
        : undefined,
    };

    const result = await this.worker.execute(task);
    if (result.success) {
      return { success: true, output: result.output };
    }
    return { success: false, error: result.error ?? result.validationError ?? "local generation failed" };
  }
}

/** System-prompt addendum injected once a turn escalates, telling the primary
 * model it can delegate boilerplate back down instead of writing it itself. */
export const LOCAL_DELEGATION_SYSTEM_ADDENDUM = `
You have access to the \`delegate_to_local\` tool for generating boilerplate, TypeScript interfaces, regex patterns, test skeletons, and parsing logs.
Use it to save tokens on deterministic tasks. If it returns { "success": false }, handle the task yourself without calling it again.
Never delegate tasks that require reasoning, debugging, framework knowledge, or cross-file context.
`.trim();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/tools/delegate-tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm no other file depended on the deleted exports**

Run: `npx jest`
Expected: PASS. (Confirmed during planning via `grep -rn "DELEGATE_TO_LOCAL_TOOL\|parseDelegateArgs" src` that nothing outside the old `delegate-tool.ts` imported them.)

- [ ] **Step 6: Commit**

```bash
git add src/tools/delegate-tool.ts tests/tools/delegate-tool.test.ts
git commit -m "refactor: turn delegate-tool.ts into a registrable Tool backed by LocalWorker"
```

---

### Task 6: Agent — register, force-include, and exercise `delegate_to_local`

**Files:**
- Modify: `src/cli/agent-tools.ts`
- Modify: `src/cli/agent.ts`
- Test: `tests/cli/agent-capability-routing.test.ts`

**Interfaces:**
- Consumes: `DelegateToLocalTool` (Task 5), `Agent.localWorker: LocalWorker | undefined` (already built/instantiated), the `escalated`/`injectDelegationAddendum` machinery from Tasks 3-4.
- Produces: `AgentToolManager.registerHybridTools(localWorker: LocalWorker | undefined): void`.

- [ ] **Step 1: Write the failing test**

Add to `tests/cli/agent-capability-routing.test.ts`:

```ts
  it("offers delegate_to_local and injects the delegation system prompt once escalated, and executes a real delegation round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      if (call === 2) return toolCallResponse("escalate_task", { reason: "needs real logic" });
      if (call === 3) {
        return toolCallResponse("delegate_to_local", {
          task_type: "ts_interface",
          prompt: "Generate an interface for User with name:string",
          expected_output: "typescript",
        });
      }
      // Turn 4: LocalWorker's own generate() call, dispatched to the quick provider.
      if (call === 4) return chatResponse("interface User { name: string; }");
      return chatResponse("done, used the delegated interface");
    });

    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "primary-model", quickModel: "minicpm5-1b" },
    });

    const reply = await agent.runUserMessage(
      "reorganize the user settings module so it matches the rest of the codebase",
    );

    expect(reply).toBe("done, used the delegated interface");

    const bodies = chatBodies();
    // turn 0: quick model, escalates via escalate_task.
    expect(bodies[0].model).toBe("minicpm5-1b");
    // turn 1: primary model, now offered delegate_to_local and the delegation
    // system-prompt addendum, calls it.
    expect(bodies[1].tools?.some((t: any) => t.function.name === "delegate_to_local")).toBe(true);
    expect(
      bodies[1].messages.some((m: any) => String(m.content ?? "").includes("delegate_to_local")),
    ).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/cli/agent-capability-routing.test.ts -t "delegation round-trip"`
Expected: FAIL — `delegate_to_local` isn't registered, so the tool call in the mock's `call === 3` branch is never actually issued by the primary model turn (the test's own mock always returns it regardless, but `bodies[1].tools` won't contain `delegate_to_local` and the registry would reject the call with `unknown tool: delegate_to_local` if it were issued for real, so the reply diverges from `"done, used the delegated interface"`).

- [ ] **Step 3: Write minimal implementation**

In `src/cli/agent-tools.ts`, add the import (alongside the other tool imports):

```ts
import { DelegateToLocalTool } from "../tools/delegate-tool.js";
import type { LocalWorker } from "../provider/local-worker.js";
```

Add a new method to `AgentToolManager`, alongside `registerBaseTools`:

```ts
  registerHybridTools(localWorker: LocalWorker | undefined): void {
    if (!localWorker) return;
    this.registry.register(new DelegateToLocalTool(localWorker));
  }
```

In `src/cli/agent.ts`, call it right after `registerBaseTools` (around line 179):

```ts
    this.tools = new AgentToolManager();
    this.tools.registerBaseTools(cfg.workspaceRoot, (stream, chunk) => this.emit("onShellOutput", stream, chunk));
    this.tools.registerHybridTools(this.localWorker);
```

Still in `src/cli/agent.ts`, in the two remaining places that set `escalated = true;` outside Task 3/4's block, call `injectDelegationAddendum();` right after each assignment.

First site — the `verifying` branch (around line 425, inside `if (verifying && !(assistantMessage.tool_calls ?? []).length) { ... }`):

```ts
          escalated = true;
          injectDelegationAddendum();
```
(was just `escalated = true;`)

Second site — the `escalate_task` tool-result branch (around line 503-506):

```ts
            if (name === "escalate_task" && result.escalate === true) {
              escalated = true;
              injectDelegationAddendum();
              this.emit("onStatus", `escalating to ${escalationHint ?? "the primary model"}: ${result.reason}`);
            }
```

Finally, force-include `delegate_to_local` in `activeTools` once escalated, mirroring the existing `escalate_task` force-include block (around line 360-365):

```ts
        // escalate_task must always be offered while still on the local model —
        // heuristic/LLM tool-selection scoring could otherwise leave it out.
        if (!escalated && !activeTools.some((t) => t.name === "escalate_task")) {
          const escalateTool = this.tools.registry.getTools().find((t) => t.name === "escalate_task");
          if (escalateTool) activeTools.push(escalateTool);
        }
        // Symmetric: delegate_to_local must always be offered once escalated —
        // it's the primary model's way to push boilerplate back down instead of
        // spending its own tokens on it.
        if (escalated && this.localWorker && !activeTools.some((t) => t.name === "delegate_to_local")) {
          const delegateTool = this.tools.registry.getTools().find((t) => t.name === "delegate_to_local");
          if (delegateTool) activeTools.push(delegateTool);
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/cli/agent-capability-routing.test.ts`
Expected: PASS — all tests in the file.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/agent-tools.ts src/cli/agent.ts tests/cli/agent-capability-routing.test.ts
git commit -m "feat: register delegate_to_local and wire it in once a turn escalates"
```

---

## Self-Review

**Spec coverage** (against the doc's "Final Full E2E Implementation Plan" 4-layer pipeline, adapted to reuse existing primitives):
- Layer 1 (Heuristic Router as default gate) → Task 3.
- Confidence/borderline signal ("self-consistency for borderline cases") → Task 4.
- Layer 2/3 (Local Worker / Cloud Orchestrator split, cloud delegates boilerplate down) → Tasks 5-6, reusing the existing escalated-primary-model path as "Cloud Orchestrator" instead of building a new class.
- Layer 4 (Execution & Validation) → already covered by `LocalWorker.validateOutput`'s existing structural checks (TS declaration shape, brace balance, JSON.parse, regex compile) — no new work; the doc's heavier `tsc`/`eslint`-subprocess `Validator` class is deliberately not built (out of scope — flag as a follow-up if stricter validation is ever needed).
- "Avoid runtime subscription errors" (`ModelAvailabilityChecker` doc section) → Task 1 closes the actual crash path (`Router.isRecoverable`); `ModelAvailabilityChecker.refreshAll()` already runs at Agent startup (pre-existing code, not part of this plan).
- `Verifier`, `KeyManager` → explicitly out of scope, documented in Global Constraints.

**Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code.

**Type consistency:** `LocalTask`/`LocalResult`/`LocalTaskType`/`LocalOutputType` (Task 5) match `src/provider/local-worker.ts`'s existing exported names exactly (verified by reading the file before writing this plan). `HeuristicResult`/`SelfConsistencyResult` field names (`decision`, `trigger`, `score`, `shouldEscalate`) match `src/provider/heuristic-router.ts` and `src/provider/self-consistency.ts` exactly. `Tool` base class shape (`name`, `description`, `tags`, `parameters`, `call`) matches `src/tools/tool.ts` exactly, mirrored from the existing `EscalateTaskTool` in `src/tools/escalate-tool.ts`.

---

## Follow-ups (explicitly out of scope for this plan)

- **`Verifier` (same-model self-critique):** left unwired. If revisited, redesign so the critique runs on the *primary* model reviewing the *quick* model's draft, not the quick model critiquing itself — the documented failure mode is specific to a 1B model judging its own output.
- **`KeyManager` (concurrent multi-cloud-model binding):** left unwired. Only becomes useful once something in the turn loop issues concurrent calls to two different cloud models — e.g. if `delegate_to_local` ever grows a cloud-target variant instead of always running locally.
- **`tsc`/`eslint`-based structural validation** for delegated TypeScript output, beyond `LocalWorker`'s current in-process checks — heavier tooling, only worth it if the lightweight checks prove insufficient in practice.
