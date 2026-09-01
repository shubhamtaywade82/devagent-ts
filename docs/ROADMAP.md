# Nexum Implementation Roadmap

Status: proposed (post-rename baseline). This document is the master plan for
evolving Nexum from its current state into the agent runtime platform
described below. It supersedes ad-hoc planning — new work should be scoped
against a phase here, and phases should be checked off as they land.

Related: [`SPEC.md`](./SPEC.md) (frozen TUI contract), [`REBRANDING.md`](./REBRANDING.md)
(DevAgent → Nexum rename, merged), [`tui-capability-spec.md`](./tui-capability-spec.md).

## 0. Premise

The DevAgent → Nexum rename (`rename/nexum`, merged) changed identity only:
package name `@nemesis-oss/nexum`, CLI, `NEXUM_*` config with `.devagent/` /
`DEVAGENT_*` back-compat, Node ≥22. It did not touch the runtime.

The repository already contains substantial infrastructure —
`src/{provider,runtime,orchestrator,context,intelligence,memory,learning,
skills,tools,mcp,lsp,safety,policy,tui,cli,benchmark,browser,exchange,
backtest,asl}` — including a capability-based model router, checkpoint/resume,
parallel dependency-aware execution, a 35+ tool runtime, LSP-backed code
intelligence, Rails semantic indexing, a benchmark harness, memory/learning,
MCP integration, Docker sandboxing, path-contained filesystem operations, and
loop detection. The TUI is frozen per `SPEC.md`: one permanent layout, one
active view, activity strip, prompt, context strip — a terminal-native agent
operating environment, not a dashboard.

**Strategy: vertical evolution, not a rewrite.** Every phase below extends or
hardens an existing subsystem. None of them replace the frozen TUI contract,
none hardcode a single provider into the runtime, and none require a new
repo/package split — this stays one cohesive application with clean module
boundaries until real reuse demands otherwise.

## Target architecture

```
                                NEXUM
                                  |
                  +---------------+---------------+
                  |                               |
            Agent Runtime                   Interaction
                  |                               |
       +----------+----------+                CLI / TUI
       |          |          |
    Planner   Executor   Verifier
       |          |          |
       +----------+----------+
                  |
            Context Engine
                  |
       +----------+--------------+
       |          |              |
     Index      Memory         Skills
       |          |              |
       +----------+--------------+
                  |
             Tool Runtime
                  |
          +-------+--------+
          |                |
     Native Tools          MCP
          |                |
          +-------+--------+
                  |
            Model Gateway
                  |
          +-------+--------+
          |       |        |
       Ollama  OpenAI  Anthropic
          |
    Cloud + Local
```

Nexum owns orchestration, context, tools, memory, skills, verification, and
UX. Models are interchangeable infrastructure behind the Model Gateway.

## Phases

Each phase lists its module targets and the concrete deliverable that closes
it. Phases are ordered by dependency, not by priority theatre — later phases
assume earlier ones are load-bearing.

### Phase 0 — Baseline and contracts

Freeze current state before adding anything.

- `docs/ARCHITECTURE.md` — current-state system diagram and module map.
- `docs/ADR/001..006` — runtime actors, provider abstraction, tool runtime,
  MCP, context engine, TUI model.
- `docs/PRD.md`, `docs/TDD.md`.
- `docs/FEATURE-MATRIX.md` — parity matrix against Claude Code, Codex CLI,
  Cursor, Aider, OpenCode, OpenHands, Cline, Roo Code, Gemini CLI, Continue.
  Each row: `SUPPORTED` / `PARTIAL` / `MISSING` / `NEXUM DIFFERENTIATOR`.
  This becomes the master backlog for phases 1–21.

### Phase 1 — Model Gateway 2.0

`src/provider/{types,Provider,ModelCatalog,Router,CapabilityResolver,
UsageTracker,CostTracker,BudgetManager,CacheManager,FailoverManager}.ts` +
`providers/{ollama,openai,anthropic,gemini}/`.

Capabilities: chat, stream, tools, vision, thinking, embeddings,
structured-output, json-schema, model-metadata, usage, pricing, caching.

Add cost-aware routing on top of the existing capability router:

```ts
interface ModelProfile {
  id: string;
  provider: string;
  capabilities: Capability[];
  contextWindow: number;
  inputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  outputCostPerMillion: number;
  qualityScores: Record<TaskType, number>;
  latencyScore: number;
}
```

Routing pipeline: capability filter → quality → context fit → budget →
latency → model.

### Phase 2 — Inference Controller

`src/inference/{InferenceController,InferencePolicy,EscalationPolicy,
RetryPolicy,ContextPolicy,BudgetPolicy,InferenceTrace}.ts`

The decision layer between runtime and provider: whether to call an LLM at
all, which provider/model, how much context, whether to escalate, retry, use
cache, or parallelize.

### Phase 3 — Repository Intelligence 2.0

`src/intelligence/{WorkspaceIndexer,TreeSitter,SymbolIndex,ReferenceIndex,
ImportGraph,CallGraph,DependencyGraph,GitGraph,SemanticIndex,
RepositoryRanker,IncrementalIndexer}`

Generalizes the existing LSP/Rails intelligence. Retrieval order: exact
symbol → LSP → ripgrep → AST → dependency graph → semantic search → git
history. Rank before sending anything to the model — never pipe raw vector
search results in.

### Phase 4 — Context Engine

`src/context/{ContextBuilder,ContextBudget,ContextRanker,ContextCompressor,
ContextCache,RetrievalPlanner,ContextTrace}`

Inputs: user request, workspace, current files, git, memory, skills, docs,
tools, MCP. Output: `optimal_context` with per-source attribution (e.g.
repository 31%, conversation 14%, memory 9%, LSP 8%, git 6%, docs 7%, tools
10%, other 15%) and every item traceable back to its source.

### Phase 5 — Skills Engine

`src/skills/{loader,registry,resolver,matcher,lifecycle,composer,validator}.ts`
+ `marketplace/`

Extends the existing Markdown skill packages. Skills declare triggers, tools,
and preferred models in frontmatter; a matcher activates skills against a
request, contributing tools/instructions/workflows/verification into the run.

### Phase 6 — Agent Runtime 2.0

`src/agent/{Agent,IntentResolver,Planner,TaskGraph,Executor,Supervisor,
Reflector,Repairer,Verifier,SessionManager}.ts`

Formalizes the existing plan-step/parallel-execution/checkpoint runtime into:
intent → plan → task DAG → schedule → execute → verify → reflect → repair →
re-verify → complete.

### Phase 7 — Multi-agent orchestration

`src/agents/{AgentDefinition,AgentRegistry,AgentSpawner,AgentSupervisor,
AgentMailbox,AgentScheduler}.ts` + `policies/`

Built-in roles: Architect, Coder, Reviewer, Tester, Security, Researcher,
Docs, Debugger, Performance, DevOps, Database. Spawning is gated by task
complexity → agent budget → 0/1/N agents; provider concurrency and cost
budgets are enforced centrally, not per-agent.

### Phase 8 — Tool Runtime 2.0

Formalize the existing 35+ tool runtime around one contract:

```ts
interface Tool {
  id: string;
  version: string;
  description: string;
  inputSchema: JSONSchema7;
  capabilities: ToolCapability[];
  risk: RiskLevel;
  execute(ctx: ToolContext, input: unknown): Promise<ToolResult>;
}
```

Lifecycle: discovered → selected → authorized → invoked → running →
completed/failed/cancelled. Add dry-run, preview, rollback, timeout,
cancellation, streaming, resource limits, idempotency, audit trail.

### Phase 9 — MCP 2.0

Make the existing MCP integration first-class: discovery → capabilities →
authentication → tool adapter → permission policy → tool registry. Support
stdio, HTTP, SSE where applicable, resources, prompts, tools, sampling,
server lifecycle, health monitoring. MCP tools must be indistinguishable from
native tools to the executor.

### Phase 10 — Verification System

`src/verification/{VerificationPipeline,Check,CheckRegistry,TestRunner,
LinterRunner,TypeCheckRunner,BuildRunner,SecurityRunner,RegressionRunner}.ts`

Pipeline: format → lint → type check → tests → build → security → diff
review → LLM review — adaptive, so a README change doesn't trigger the full
suite.

### Phase 11 — Git as a first-class runtime actor

Extend existing git tooling with ChangeSet, Checkpoint, Rollback, branch
manager, commit planner, conflict resolver, PR planner, PR reviewer. Flow:
task → workspace checkpoint → changes → verification → diff review → commit
→ PR.

### Phase 12 — Persistent execution trace

`src/trace/{Event,EventStore,TraceRecorder,TraceReader,TraceQuery,
ReplayEngine}.ts`

Every runtime transition emits an event (`session.started`,
`intent.detected`, `skill.activated`, `plan.created`, `task.started`,
`agent.spawned`, `context.retrieved`, `model.selected`,
`inference.started`, `tool.started`, `mcp.call.started`, `file.changed`,
`verification.failed`, `reflection.started`, `retry.started`,
`git.commit.created`, `session.completed`, …). TUI, CLI logs, debugging,
metrics, replay, and any future web UI all consume this one stream.

### Phase 13 — TUI 2.0

Baseline stays `SPEC.md` — not replaced. Views: Conversation, Execution,
Tasks, Git, Logs, Memory, Models, MCP over the fixed
Header/Active-View/Activity-Strip/Prompt/Context-Strip layout. Dynamic
per-actor states (running/finished/failed with inline actions) belong in the
view model, not hard-coded components.

### Phase 14 — Input system

Expand input handling: normal prompt, slash command, `@skill`, `@file`,
`@symbol`, image, clipboard, file path, URL, GitHub issue/PR, stack trace,
terminal output, MCP resource. Classify into intent categories (QUESTION,
EDIT, REFACTOR, DEBUG, REVIEW, TEST, RESEARCH, DOCUMENT, GIT, DEVOPS,
ARCHITECTURE) and map input → `UiCommand`; the runtime decides what happens
next.

### Phase 15 — Command system

Expand the slash-command registry (`/agent`, `/agents`, `/plan`, `/tasks`,
`/context`, `/model`, `/models`, `/skill`, `/skills`, `/mcp`, `/tools`,
`/memory`, `/search`, `/review`, `/test`, `/fix`, `/refactor`, `/git`,
`/diff`, `/replay`, `/trace`, `/session`, `/checkpoint`, `/resume`,
`/doctor`, `/config`), each reachable by typing, palette, keyboard, and
programmatic API.

### Phase 16 — Mission Control overlay

No second dashboard. A `Ctrl+B` overlay lists agent status
(running/waiting/done); selecting one focuses it in the existing Active View.
Layout stays unchanged per `SPEC.md`.

### Phase 17 — Local/cloud intelligence

Default escalation policy: local → fast → cached → cloud medium → cloud
large → premium, keyed to task difficulty rather than user-selected model
alone. This is where local-model cost/quality tiers (e.g. Ollama-hosted
models) become directly useful to the Phase 1 router.

### Phase 18 — Benchmarking / Model Arena

Extend the existing benchmark harness (already covers JSON/tool calling,
reasoning, agentic loops, error recovery, execution) into a persistent
scoring system: model quality, tool accuracy, planning, repo navigation, edit
success, test-fix success, latency, tokens/sec, cost, cache effectiveness.
The Phase 1 router consumes historical scores + cost + latency + task
complexity.

### Phase 19 — Security

`src/security/{PermissionManager,PolicyEngine,SecretRedactor,SandboxPolicy,
ToolRiskClassifier,ApprovalManager,AuditLog}`

Risk levels: READ, LOW_WRITE, WRITE, DESTRUCTIVE, NETWORK, CREDENTIAL,
SYSTEM. E.g. `read_file` → AUTO; `git push` → approval; `rm -rf` →
BLOCK/explicit override; production deploy → explicit approval.

### Phase 20 — Memory & learning 2.0

Split the existing memory/learning architecture into Conversation, Repository,
User Preference, Agent, Skill, Failure, and Decision memory. Flow: task →
retrieve relevant memories → execute → outcome → grade → reflection → store
lesson.

### Phase 21 — Autonomous mode

Explicit autonomy levels L0–L5 (Ask → Suggest → Execute-with-approval →
Execute-low-risk-auto → Autonomous-within-policy → Fully-autonomous-sandbox),
gating tool permissions, agent spawning, model escalation, network, git, MCP,
and verification strictness.

### Phase 22 — General agent platform

Only after coding quality is proven. Generalize `AgentDefinition`,
`SkillSet`, `ToolSet`, `MemoryPolicy`, `ModelPolicy`, `VerificationPolicy`,
`AutonomyPolicy` so CodingAgent, TradingAgent, ResearchAgent, DevOpsAgent,
DatabaseAgent, SecurityAgent, and DocumentationAgent all run on the same
Nexum runtime. This is the point Nexum stops being a coding-agent CLI and
becomes the general agent platform.

## Execution order

```
0  Freeze architecture + feature matrix
1  Provider / Model Gateway 2.0
2  Inference Controller
3  Context Engine
4  Repository Intelligence
5  Skills Engine
6  Agent Runtime
7  Tool Runtime
8  MCP
9  Multi-Agent Orchestration
10 Verification
11 Git / Change Management
12 Execution Trace + Replay
13 TUI 2.0
14 Input / Command UX
15 Security / Permissions
16 Memory / Learning
17 Model Arena
18 Autonomous Modes
19 Headless / CI mode
20 External API / SDK
21 General-purpose Agents
```

Note this differs from the phase numbering above in one place: Context
Engine and Repository Intelligence are pulled forward (before Skills/Agent
Runtime) because the agent runtime and skills matcher both depend on ranked
context being available first.

## The critical architectural rule

One runtime, three thin front-ends:

```
                       Nexum Runtime
                            |
             +--------------+--------------+
             |              |              |
            CLI            TUI            API
             |              |              |
             +--------------+--------------+
                            |
                         Events
                            |
                    Execution Trace
```

`SPEC.md` already states the TUI renderer is a pure reflection of runtime
state and that business logic must stay outside the renderer — this rule
generalizes that constraint to the CLI and any future API surface: no
runtime logic duplicated per front-end.

## What not to do

- Rewrite the whole codebase.
- Replace the frozen TUI (`SPEC.md`) with another dashboard.
- Hardcode a specific provider (e.g. Ollama) into the agent runtime.
- Make every task multi-agent by default.
- Invoke an expensive model for every operation.
- Send the entire repository to the model instead of ranked context.
- Expose every tool on every turn.
- Make LLMs responsible for deterministic safety controls.
- Duplicate logic between CLI and TUI.

## First milestone: Agent Runtime Foundation

Already in place: provider abstraction, model catalog, capability router,
checkpoint/resume, tool registry, MCP, LSP, memory, skills, sandbox, existing
TUI.

New for this milestone: `InferenceController`, cost/usage accounting, model
benchmark scores, Context Engine v2, execution trace, replay, agent
supervisor, approval policy engine, adaptive verification, model escalation.

Acceptance suite — Nexum must, end to end, on a real repository:

1. Understand a repository.
2. Plan a multi-step task.
3. Retrieve targeted context.
4. Select appropriate tools.
5. Use MCP.
6. Spawn a specialist agent.
7. Modify multiple files.
8. Run tests.
9. Diagnose a failure.
10. Repair it.
11. Verify again.
12. Create a git commit.
13. Resume after interruption.
14. Replay the execution.
15. Explain what happened.

That suite passing is what closes out Phase 0–12 and green-lights Phase 13
onward.
