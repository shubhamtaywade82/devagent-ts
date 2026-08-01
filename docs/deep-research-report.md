Given everything we've discussed over the past few months (your `devagent-ts`, `ollama-client`, agent framework, trading agents, and long-term goal of building an AI platform), **I would not stop at buying Ollama Pro.** I'd treat it as the infrastructure layer for a much larger system.

## Phase 1 (Week 1): Validate Ollama Pro

Don't write much code yet. Prove the platform.

### 1. Buy Ollama Pro

### 2. Build a provider package

```
packages/provider-ollama/
```

Implement:

* Chat
* Streaming
* Tool Calling
* Embeddings
* Model Listing
* Pull Local Models
* Cloud Models
* Vision
* Thinking models

Keep it provider-agnostic:

```ts
interface LLMProvider {
  chat()
  stream()
  embed()
  models()
  tools()
}
```

Everything in your framework should use this interface.

---

## Phase 2 (Week 1–2): Model Router

Don't hardcode models.

```
packages/router/
```

Example routing:

| Task                     | Model            |
| ------------------------ | ---------------- |
| Repository planning      | glm-5.2          |
| Code generation          | kimi-k2.7-code   |
| Repository understanding | qwen3.5-122b     |
| Review                   | gpt-oss-120b     |
| Deep reasoning           | nemotron-3-ultra |
| Fast edits               | gemma4           |

The router decides automatically.

---

## Phase 3: Repository Intelligence

This is where Claude Code gets much of its value.

Build:

```
packages/indexer/

Workspace Indexer

Tree-sitter

Import Graph

Call Graph

Reference Graph

Git Analyzer

Recent Files

PageRank

Embedding Builder
```

Then store it.

---

## Phase 4: Semantic Memory

Instead of sending whole files:

```
Repository

↓

Chunk

↓

Embed

↓

Vector DB

↓

Retrieve

↓

Prompt Builder
```

Use:

* LanceDB
* SQLite-VSS
* or another local vector store

---

## Phase 5: Tool Registry

Instead of:

```ts
if(tool==="read")
```

Create:

```
ToolRegistry

↓

ReadFile

WriteFile

EditFile

Rename

Git

Ripgrep

Terminal

Docker

Web

MCP

Testing
```

Every tool becomes a plugin.

---

## Phase 6: Planner

Instead of:

```
Prompt

↓

LLM

↓

Tool
```

Use:

```
Planner

↓

Task Graph

↓

Executor

↓

Verifier

↓

Reflection

↓

Retry
```

That architecture scales much better.

---

## Phase 7: CLI

Your CLI should resemble:

```
devagent

chat

edit

review

commit

plan

test

explain

index

models

doctor

plugins

memory

config
```

---

## Phase 8: TUI

Only after the backend is solid.

```
Explorer

Repository Graph

Chat

Terminal

Logs

Tool Calls

Model

Memory
```

The UI becomes a thin client over the agent runtime.

---

# Your roadmap

```text
Provider
      ↓
Router
      ↓
Memory
      ↓
Repository Index
      ↓
Tool Registry
      ↓
Planner
      ↓
Executor
      ↓
Reflection
      ↓
Verification
      ↓
CLI
      ↓
TUI
```

---

# Where I think your project can become unique

Don't try to build another Claude Code.

Build something that is **more extensible**.

Imagine this:

```
devagent-ts

├── Coding Agent

├── Trading Agent

├── Research Agent

├── Documentation Agent

├── DevOps Agent

├── Architecture Agent

├── Security Agent

├── Database Agent

└── Custom Agents
```

Every one of them shares:

* Memory
* Model Router
* Tool Registry
* Context Engine
* Planner
* Executor

Only their prompts, tools, and workflows differ.

That is significantly more ambitious than cloning a coding assistant—it becomes a general-purpose agent framework.

## My recommendation

If you decide to buy **Ollama Pro**, I would commit to a **3–6 month roadmap** focused on building `devagent-ts` into a modular platform rather than a single coding CLI. The milestones I'd prioritize are:

1. **Provider abstraction** (Ollama Cloud + local Ollama, with room for other providers later).
2. **Model router** with task-based model selection.
3. **Repository intelligence** (Tree-sitter, dependency graph, embeddings, incremental indexing).
4. **Plugin-based tool registry**.
5. **Planner → Executor → Verifier → Reflection** execution pipeline.
6. **CLI**, then **TUI** once the core runtime is stable.

That sequence gives you a reusable foundation for every agent you've described building, not just a coding assistant.

# AI CLI Coding Agents: Feature Inventory and Architecture Roadmap

**Feature Inventory:** Modern AI-powered coding assistants like Claude Code, Cursor CLI, Aider, and OpenAI’s Codex CLI all expose rich terminal-based workflows. For example, Cursor CLI supports both interactive and scripted modes, lets you switch among models (GPT-5, Claude 4, Gemini, etc.), spawn background sub-agents, and use the MCP protocol for tool integration. Anthropic’s **Claude Code** similarly offers cross-repo editing (bug fixes, refactors), architecture Q&A, automated test/lint execution, and Git operations (history search, merge conflict resolution, commits/PRs). The open-source **Aider** CLI adds on rich context handling: it works with cloud or local LLMs, builds a codebase map for large projects, supports 100+ languages, has built‑in Git integration (generating commit messages, diffs, PRs), IDE integrations via inline comments, multimodal context (images, webpages, voice input), and automated linting/testing after edits. Likewise, **OpenAI’s Codex CLI** (OpenCode) provides advanced features such as resuming saved sessions, including images or web content as context, spawning subagents for subtasks, performing web search from the CLI, offloading tasks to the cloud, calling external tools via MCP, enforcing sandbox permissions, and even generating shell command completions. These products demonstrate the baseline capabilities (interactive code editing, debugging, testing, version control, multimodel support, tool use, etc.) that our agent must match.

* **Cursor CLI:** Offers a conversational terminal interface and a non-interactive “script” mode; supports on-the-fly model switching and parallel agent threads; integrates the Model Context Protocol (MCP) to use external tools (files, search, git, etc.).
* **Claude Code (Anthropic):** A terminal AI agent pointing at your code directory. It can edit/fix code across files, answer questions about architecture/logic, run and fix tests, and handle Git tasks (search history, merge conflicts, commits/PRs).
* **Aider CLI:** An open-source agent that maps large repositories and exposes them to the LLM. It supports cloud/local LLMs, dozens of languages, and rich tools: it parses the repo (Tree-sitter) for context, generates Git diffs/commit messages, adds inline comments in your editor, and even handles images, web context, and voice input; it automatically lints/tests the code after changes.
* **OpenAI Codex CLI:** Enables multiturn coding chats. Features include saving/loading chat sessions, including screenshots or image prompts, splitting work into sub-agents, invoking web search, offloading computation to cloud workers, JSON function-calling (MCP), controlling permissions (/permissions), and shell autocomplete support.

Each of these tools exposes a superset of basic coding assistant features (file editing, debugging, PR generation, testing) plus advanced capabilities (contextual search, multi-model routing, chaining tools via MCP, etc.). Our agent must incorporate these features in a unified framework.

## Subsystems and Interfaces for Full Parity

To match and exceed the capabilities above, our system will be organized into modular subsystems, each with clear interfaces and responsibilities. Key components include:

* **LLM Provider Layer:** An abstract interface (`LLMProvider`) that hides the details of each model API. It will support chat completions, streaming, and embeddings, and be provider-agnostic (able to plug in Ollama, OpenAI, Anthropic, local LLMs, etc.). This is similar to how [Fowler et al.](41†L179-L187) describe a “Core AI Model” component. For example, Ollama’s API is compatible with OpenAI/Anthropic endpoints and can be accessed via a standardized chat/embed interface. All higher-level logic calls through this interface.
* **Model Router:** A routing layer that dynamically selects the appropriate model for each task. E.g., use a smaller fast model for simple edits, and a larger reasoning model for heavy planning or code analysis. The router can be rule-based or learned; for now we’ll encode mappings like (“planning”→glm-5.2, “code-gen”→kimi-k2.7-code, “long analysis”→qwen3.5-122B) as suggested by our planning phase. This avoids hardcoding one model everywhere.
* **Repository Indexer (Context Engine):** A system to analyze and summarize the codebase. We will use Tree‑sitter to parse files and extract symbols, imports, and call graphs, and build a dependency graph (file imports graph, call graph, symbol index, etc.). This allows semantic queries rather than brute-force file dumps. For example, recent research has shown how a Tree-Sitter–backed “knowledge graph” (stored in SQLite) can answer structural code queries via MCP tools, rather than repeatedly reading raw files. Our indexer will maintain data like file PageRank (for context prioritization), recent edits, and documentation, all to feed into context retrieval. Indexing must be **incremental**: watch for file changes, re-parse only updated code, and update the graph.
* **Semantic Memory (Vector Store):** Instead of re-sending whole files, we’ll chunk code and docs and embed them into a local vector database (e.g. SQLite-VSS, LanceDB, or Chroma). During prompting, the agent retrieves the most relevant chunks (by embedding similarity or keyword search) to include as context. This “RAG” layer preserves long-term knowledge of the repo and avoids re-transmitting unchanged code. SQLite with a vector extension (such as [sqlite-vss](52†L246-L254)) lets us manage embeddings simply.
* **Tool Registry & MCP Integrations:** A plugin registry that exposes all available tools to the agent (via MCP or custom protocol). Each tool is a standalone component implementing a schema: e.g. FileTool (read/write files), GitTool (status/diff/commit), SearchTool (ripgrep), ASTTool (Tree‑sitter queries), TerminalTool (run shell commands), TestTool (run pytest/Jest/RSpec), WebSearch, etc. Tools should register themselves (name, description, parameter schema) so the LLM can call them by name. This mirrors the MCP-based design in [Fowler’s agent](41†L179-L187) and [the MCP spec](70†L129-L138): the agent (MCP host) connects to each tool-server via an MCP client, enabling two-way context exchange. All tools must be sandboxed and allow cancellation/timeouts.
* **Planner / Execution Engine:** The core loop that turns user goals into actions. Instead of a blind LLM prompt→tool scheme, we will use an explicit *planner* that breaks tasks into a directed acyclic graph of subtasks (e.g. “plan -> edit file -> run test -> verify”). The executor then runs each tool call in order, feeds results back to the agent, and optionally triggers reflection (e.g. rerun tests) if the agent asks. This reflects modern “Plan/Act/Verify/Reflect” frameworks.
* **Verifier & CI Pipeline:** After making code changes, the agent should automatically run a verification pipeline: code formatter, linter/type-checker, unit tests, build, and coverage. Only if everything passes should the agent conclude the task. Failures are fed back for “reflection” (e.g. fix issues). This is standard practice for production-grade agents (sanity-check every change).
* **Memory (Conversation/State):** Short-term memory (current chat history, plan state) and long-term memory (previous fixes, style guides, knowledge graph) are maintained. The short-term is just the chat log; long-term could be a knowledge graph or vector DB of past sessions and patterns. This ensures the agent “remembers” previous solutions and repository conventions.
* **Security & Sandbox:** As Fowler notes, running code or tools can be dangerous. We will isolate all execution: e.g. run shell commands in a restricted environment (chroot/virtualenv with limited resources), enforce timeouts, and drop privileges. The CLI will have a `/permissions` system similar to Codex: before executing arbitrary code, the agent must request permission, which a human approves.
* **CLI/TUI Interface:** Finally, the user-facing layer. We will build a CLI with commands like `devagent chat`, `devagent edit`, `devagent review`, etc., and later a Textual-based TUI for rich interaction (file explorer, chat pane, terminal, logs). The interface will feed user prompts into the planner/executor loop and stream progress. It should display model choices and allow switching on the fly.

Together, these components map onto the four architectural layers described by Oski Solutions: an LLM “reasoning” layer (our provider + planner), an orchestration layer (task graph + executor), a memory layer (vector DB + chat log), and a tools layer (filesystem, git, docker, search, etc.). Each subsystem will be designed with clear interfaces (e.g. Python classes, TypeScript types) so they can be developed and tested in isolation.

## Provider APIs & Model Capabilities

Our `LLMProvider` abstraction will allow us to plug in any API that speaks a compatible interface. Ollama Cloud Pro is one target provider. Ollama exposes an OpenAI‐compatible API (e.g. `/v1/chat/completions` and `/v1/embeddings`) with features like streaming, JSON output, function-calling, vision inputs, chain-of-thought settings, and logprobs. It also provides full compatibility with the Anthropic API: e.g. by setting `ANTHROPIC_BASE_URL=http://localhost:11434`, one can point Claude Code or other tools at Ollama’s backend. In practice, we can use the official OpenAI/Anthropic SDKs against Ollama’s endpoint (as shown in their docs).

Ollama offers a **wide model zoo**: GLM 5.2, Qwen 3.5 (various sizes), Moonshot’s Kimi series (K2.6, K2.7-Code, K3), Gemma 4, NVIDIA Nemotron, Gemini 3 Flash, Mistral, and more. Most of these models are labeled “tools thinking” (and many “vision”), indicating built-in support for function calls and multimodal input. We will leverage this by using the most appropriate model for each task (managed by our router). For example, GLM-5.2 excels at multi-step planning, Kimi-Code at real-world coding tasks, Qwen3.5 at general understanding, and so on.

Beyond Ollama, our framework will be provider-agnostic. We should also support (via plugins or wrappers) OpenAI’s GPT API, Anthropic’s Claude API, and possibly self-hosted open models. The `LLMProvider` interface might include methods like `chat(messages)`, `stream(messages)`, `embed(texts)`, `listModels()`, and `callTool()`. (Exact interface design will be fleshed out in the TDD.) All code in the agent uses this interface, so swapping providers is easy.

On the Ollama side, note that **billing is by GPU time, not strict token counts**. The Pro plan (∼$20/mo) gives *“50x more usage than Free”* and allows up to 3 concurrent streams. We must keep prompts efficient (via our indexer and memory) to conserve GPU usage, but we won’t hit unexpected token-rate billing surges like some cloud APIs.

## Technical Architecture & Module Specifications

Below is a high-level module breakdown. Each module will have well-defined inputs/outputs and interfaces. (Technical Design Document (TDD) detail will specify class names, method signatures, JSON schemas, etc.)

* **`provider-ollama` Package:** Implements the `LLMProvider` interface against Ollama’s Cloud (with `ollama.chat()` streaming, `ollama.embed()`, `ollama.listModels()`, etc.). It handles HTTP/1.1(S) requests to Ollama’s API endpoints. For robustness, it will validate API responses and handle retries/timeouts.
* **`provider-xxx` Packages:** Similar adapters for other backends (OpenAI, Anthropic, local Ollama, Bedrock, etc.), all conforming to `LLMProvider`. This ensures pluggability.
* **`model-router` Package:** Contains the routing logic. Probably a simple function or class that takes a `taskType` or prompt metadata and returns a model name (and possibly provider). It will include configurable weights or rules. (E.g. `router.selectModel(task)`.)
* **`memory` Package:** Manages conversation and semantic memory. It will have: (a) a chat history store (simple array or ring buffer), (b) a vector store interface (e.g. SQLite-VSS or LanceDB). Key functions: `storeConversation(context)`, `retrieveMemory(query)` (returns relevant chat snippets or docs), `persistVector(chunk, embedding)`, `searchVectors(queryEmbedding, topK)`. We will write wrappers around an embedded database (possibly using an existing library) to index embeddings in real-time.
* **`indexer` Package:** Uses Tree-Sitter and other parsers to analyze the codebase. Key functions: `buildIndex(rootDir)`, `updateIndex(changedFiles)`, `getSymbolGraph()`. Internally it will parse each source file to an AST, extract definitions/imports/calls, and build directed graphs (file-import graph, function call graph). It will compute PageRank or other metrics to rank file importance. This package will output a compact repository blueprint (e.g. top N file summaries) to include in prompts, per the token budget. (This follows [our earlier blueprint](https://llms-search-result) of PageRank context compression.)
* **`embeddings` Module:** Or part of memory or indexer. Takes code/doc chunks and generates embeddings (using an LLM or local model). Exposes `embedText(text)` and batching. Might use OpenAI-style Embedding API via Ollama’s `/v1/embeddings`.
* **`tool-registry` Package:** A registry mapping tool names to implementations. At startup, each tool class (FileTool, GitTool, SearchTool, ASTTool, TestTool, DockerTool, WebTool, etc.) registers its name, JSON schema, and a handler function. The agent’s planner can then call tools by name with arguments, and `tool-registry` will dispatch to the correct function. The registry also enforces permissions. For example, `read_file(path)`, `write_file(path, content)`, `run_command(cmd)`, `search_code(pattern)`, etc. Each tool will be implemented using safe OS APIs (e.g., Python’s `subprocess` with timeouts, `node` CPython for Python code execution).
* **`planner` Module:** Responsible for interpreting the user’s request into a plan. It might simply prepend instructions (like agent persona and plan prefixes) and let the LLM generate next actions, or it could have more structured planning logic (breaking tasks into steps). Initially, this can be a function that takes a user prompt and outputs an initial plan (maybe a numbered list of steps) by calling `LLMProvider.chat()`.
* **`executor` Module:** The loop engine. It takes the current plan and history, calls the LLM (with appropriate instructions and context), parses any tool calls returned (from function-calling output), executes them via `tool-registry`, appends results to history, and repeats until no tools are requested or max turns reached. This is essentially the state machine in the provided Python blueprint. It will handle streaming output to the UI.
* **`verifier` Module:** After all LLM tool-calls are done, this module automatically runs a verification pipeline. For example, it can run a code formatter (Black, Prettier), linters (Ruff, ESLint), type-checkers, and then the test suite. It returns a report of any failures. The executor will feed this back into the agent as a final “all done” or “please fix errors” step.
* **`reflector` / **ToolConflict Resolver**:** A small component that, if verification fails or the agent’s solution is unsatisfactory, prompts the LLM to self-critique and repair. This loop is optional but improves robustness.
* **`cli` Package:** Implements the command-line interface (using e.g. Python’s `argparse` or `click`). Commands like `devagent chat “Describe repo”`, `devagent edit “Fix bug in foo”`, etc. Internally it instantiates the agent and runs `planner`/`executor`. It also provides model-switch and tool invocation commands (`--model`, `--dry-run`, etc.).
* **`tui` Package:** Builds on [Textual](https://github.com/Textualize/textual) to create a multi-pane interface (file explorer, chat log, integrated shell). It uses the above modules as a backend and streams updates into the UI. The TUI is mostly a consumer of the core engine and should remain “thin” (just display and user I/O).
* **`config` Module:** Holds configuration (API keys, model preferences, project-specific guidelines). Reads from config files or environment variables.

Each package will include unit tests mocking dependencies (e.g. a dummy LLM for `provider`, in-memory file structures for `tool-registry`, etc.). Interfaces (e.g. JSON schemas for tools) will be clearly documented. This modular breakdown makes the system extensible: to add a new tool, just drop in a new plugin; to support another model, add a provider module.

## Implementation Roadmap & Test Plan

**Phase 1 (Weeks 1–2): Foundation & Provider Integration**

1. **Provider Abstraction:** Define the `LLMProvider` interface in code (methods: `chat`, `stream`, `embed`, `list_models`). Implement `provider-ollama` using Ollama’s API (citation: [Ollama docs](24†L53-L61)). Implement a dummy local provider for testing. *Test:* Unit-tests for chat/stream with mock responses.
2. **Model Router:** Build a simple rule-based router (e.g. YAML mapping from task keywords to model names). Write unit tests for correct model selection.
3. **Basic Agent Loop:** Glue together: CLI reads a prompt, calls LLMProvider.chat, prints response. Verify basic chat. *Test:* End-to-end integration test with a mock provider.
4. **Memory/History:** Add conversation memory logging. *Test:* Verify history persists across multi-turn chat.

**Phase 2 (Weeks 2–4): Repository Intelligence & Context**
5. **Indexer Prototype:** Use Tree-Sitter to parse a sample repo. Build a dependency graph (import relationships). Compute PageRank and generate a “blueprint” summary (top-N files). *Test:* On a sample codebase, assert that the summary includes expected key modules.
6. **Embedding Store:** Integrate an embedding model (via Ollama’s `/v1/embeddings`) and a SQLite-VSS store. Test inserting embeddings and retrieving nearest neighbors.
7. **Context Builder:** Implement prompt construction that combines user query with retrieved repo context (from index + memory). *Test:* Given a query, confirm the prompt includes relevant code chunks from vector store.

**Phase 3 (Weeks 4–6): Tooling and MCP Integration**
8. **Tool Registry:** Scaffold core tools: `read_file`, `write_file`, `search_code`, `run_tests`, `run_cmd`. Define their JSON schemas. *Test:* Unit-tests calling each tool against a fake repo or subprocess.
9. **MCP-like Tool Calls:** Implement the JSON/function-calling interface: the LLM will output JSON with `name:tool`, `arguments`. Write code to parse this output and dispatch to tools. *Test:* Simulate LLM output JSON and verify correct tool invocation.
10. **Git and Shell Tools:** Add Git (status/diff/commit) and terminal shell tools. Ensure they handle errors and timeouts. *Test:* E.g. after editing, ensure we can commit changes and rollback.
11. **Sandboxing:** Harden tools by restricting file paths and adding timeouts. *Test:* Attempt to run a dangerous command and verify it is blocked or killed.

**Phase 4 (Weeks 6–8): Planning & Execution Pipeline**
12. **Planner Module:** Implement a simple planner that wraps the user prompt with instructions (e.g. “You are a coding assistant…” and a structure like `Step 1: ...`). *Test:* Ensure that for a given query the plan outlines steps (unit test by feeding a known prompt and checking output format).
13. **Executor Loop:** Combine all: on each turn, send the assembled prompt to the model (via the provider), read response for tool calls and text, execute tools, append results, loop. *Test:* End-to-end with a dummy repo: “Fix bug X” → agent runs tests and outputs fixed code. Use deterministic smaller models in tests for reproducibility.
14. **Verifier Integration:** After tools finish, automatically run `verifier` (format, lint, tests). If failures occur, feed results back into the agent for a follow-up turn. *Test:* Introduce a failing test intentionally and check that agent retries.
15. **Error Handling:** Implement timeouts, retries, and clear error messages. *Test:* Force a tool to hang or fail; ensure the system recovers gracefully (reports error to user, not crash).

**Phase 5 (Weeks 8–10): CLI Features and Polishing**
16. **Command Palette:** Add CLI commands (e.g. `devagent list-models`, `devagent doctor` to check environment). *Test:* CLI unit tests for each command.
17. **Configuration & Auth:** Read Ollama API key from environment or config. Handle missing keys (fallback to local). *Test:* Ensure the app starts on missing key with a warning.
18. **Concurrency Limits:** Enforce Ollama’s limit of 3 concurrent streams: queue extra tasks or notify user. *Test:* Simulate >3 parallel requests and ensure queuing.
19. **Logging & Monitoring:** Integrate a logging framework (info/warning/error). *Test:* Log output appears correctly. Possibly add metrics (API call count, time).

**Phase 6 (Weeks 10–12): Textual UI & Finalization**
20. **Textual TUI:** Build the multi-pane UI (file tree, agent console, input box, terminal). Tie it to the agent backend. *Test:* Manual testing of UI usability, keybindings.
21. **Agent Context Refresh:** Add a `/refresh` command to re-run indexing if files changed. *Test:* Modify a file, call `/refresh`, verify index updates.
22. **Memory Persistence:** (Stretch) Save agent history & memory across sessions (e.g. to a local database). *Test:* Restart the app and see if previous conversation context is preserved.

**Testing Strategy:**
* **Unit Tests:** Each module (indexer, provider, tools, etc.) will have unit tests covering normal and edge cases. Use mocks for file I/O and network. For example, test the Tree-Sitter parser on toy code; test the vector store with synthetic data.
* **Integration Tests:** Create end-to-end scenarios in a disposable repo (in a temp directory). Write scripted user prompts (e.g. “Add logging to function X”). The test checks that the correct file was edited and that all new tests pass.
* **Behavioral Tests:** Use a determinism mode (inject a fixed seed or use a mock LLM) to ensure that a given prompt leads to expected actions. This is hard for LLMs, but sanity-check key flows.
* **Regression Tests:** After each feature addition, run a suite of prompts against a representative codebase. Compare outputs (or at least check no errors).
* **CI Integration:** Set up automated pipelines to run all tests on push. Include linting and type-checking of our own code.

**Risks & Critical Points:**
* **Context Drift:** Ensuring the agent has the right context (file summaries, embeddings) is critical. Poor retrieval will break the chain of reasoning. We mitigate by rigorous testing of the indexer/embeddings and falling back to smaller text if needed.
* **Model Compliance:** We rely on the LLM to follow instructions (fix code, not tests, minimal changes, etc.). This is managed via prompt engineering and reinforcement (the “instructions” phase in development). Frequent verification/testing catches misbehavior.
* **Resource Limits:** Ollama Pro’s concurrency (3 streams) and usage caps mean we must avoid accidental loops or redundant calls. The sequential, single-agent design avoids hitting concurrency limits.
* **Security:** Executing arbitrary code is dangerous. All shell commands go through a controlled layer; sensitive operations (like deleting files) should require explicit permission.
* **Extensibility:** We must not lock into one tool or framework. As [Fowler](41†L179-L187) suggests, everything from model to tools should be swappable. Rigorous interface design and dependency injection will ensure new components (e.g. a different AST parser or a new model provider) can plug in easily.

By following this plan and continuously testing each module, we will build a robust “devagent” framework that matches and surpasses Claude Code, Cursor, Aider, etc. Over time, this will serve as a general agent platform supporting coding, trading algorithms, research, and more – all sharing the same core architecture.

**Sources:** We based this design on existing references, including official docs and analyses of Claude Code, Cursor, Aider, and Codex CLI, Ollama’s API documentation, and recent literature on agentic coding architectures. Each module and interface will be validated against these guidelines.

I would **not** copy Cursor, Claude Code, or Aider.

Instead, I would combine the **best ideas from each** into something that is optimized for autonomous agents rather than just a chat interface.

## My recommendation

### Hybrid UI

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ DevAgent-TS  v0.1.0     🟢 Ready      Model: Auto(Qwen3.5)     Workspace: devagent-ts       │
├───────────────┬───────────────────────────────────────────────┬──────────────────────────────┤
│ Explorer      │ Agent Workspace                               │ Runtime                      │
│               │                                               │                              │
│ 📁 packages   │ User: Build MCP GitHub tool                   │ Current Model                │
│   📁 agent    │                                               │ Qwen3.5-122B                │
│   📁 tools    │ Thinking...                                   │                              │
│   📁 router   │                                               │ Active Tools                │
│   📁 memory   │ ✓ Planning                                    │ ✓ ReadFile                  │
│               │ ✓ Retrieved 12 symbols                        │ ✓ Ripgrep                   │
│ Repository    │ ✓ Loaded repository graph                     │ ✓ Tree-sitter               │
│               │ → Editing packages/mcp/...                    │                              │
│ 2,145 Files   │                                               │ Running Tasks               │
│ 15k Symbols   │ Diff Preview                                  │                              │
│ 32 Graphs     │ -------------------------------------------   │ ▶ Tests                     │
│               │ + new MCPToolRegistry                         │ ▶ ESLint                    │
│               │ - old registry                                │ ▶ TypeScript                │
│               │                                               │                              │
├───────────────┴───────────────────────────────────────────────┴──────────────────────────────┤
│ devagent >                                                                  Ctrl+K Commands │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

This combines:

* Cursor's file explorer
* Claude Code's conversational workflow
* Aider's diff visibility
* Codex's runtime feedback
* OpenHands' execution state

---

# Why I don't recommend a dashboard

Your first mockup looked like an IDE.

That works for:

* Grafana
* Trading
* Monitoring

It is **not** ideal for coding.

Reasons:

* Agent output needs most of the screen.
* Diff previews need width.
* Tool calls need visibility.
* Repository context should stay available.
* Terminal output is continuous.

Coding is fundamentally text-heavy.

---

# Use an adaptive layout

## Default (80% of the time)

```text
┌─────────────┬───────────────────────────────────────────┐
│ Repository  │ Chat / Planning / Diffs                  │
│             │                                           │
│             │                                           │
│             │                                           │
├─────────────┴───────────────────────────────────────────┤
│ Prompt                                           Enter │
└─────────────────────────────────────────────────────────┘
```

---

## During execution

The right pane becomes runtime information.

```text
┌─────────────┬───────────────────────────────┬───────────┐
│ Repository  │ Agent                         │ Runtime   │
│             │                               │           │
│             │                               │ Tool Call │
│             │                               │ Logs      │
│             │                               │ Tests     │
│             │                               │ Docker    │
└─────────────┴───────────────────────────────┴───────────┘
```

---

## During review

```text
┌─────────────┬───────────────────────────────┐
│ Repository  │ Diff Viewer                   │
│             │                               │
│             │ + Added                       │
│             │ - Removed                     │
│             │                               │
└─────────────┴───────────────────────────────┘
```

---

# I'd make the entire UI event-driven

Every action becomes an event.

```text
Planning

↓

Searching

↓

Embedding

↓

Reading Files

↓

Tool Calls

↓

Editing

↓

Testing

↓

Verifying

↓

Review

↓

Done
```

Instead of printing text, the UI updates components.

---

# Bottom panel

Like Claude Code:

```text
devagent >
```

But richer.

```text
devagent >

Auto Context ✓

MCP 24

Memory 8

Model Auto

Workspace devagent-ts

Cost $0.04

Latency 2.4s
```

---

# Right sidebar

This is where DevAgent can surpass Claude Code.

```text
Runtime

──────────────

Planner

Executor

Reflection

Verifier

Memory

Active Tools

Current Token Usage

Current Context Size

Embedding Cache

Repository Index

Vector Search

Model

Latency

Cost
```

Claude Code hides much of this.

---

# Command palette

Exactly like VS Code.

```
Ctrl + K
```

```
Search Symbols

Switch Model

Run Tests

Create Branch

Review PR

Reindex Workspace

Manage Plugins

Memory

Configure Agent

Install MCP

Settings
```

---

# Bottom tabs

```text
Chat

Diffs

Terminal

Memory

Planner

Logs

Metrics
```

Switching tabs changes only the center pane.

---

# Repository panel

Instead of only a file tree.

```
Workspace

Files

Symbols

Functions

Classes

Tests

Documentation

Git

Todos

Architecture

Dependencies
```

All backed by Tree-sitter and your repository index.

---

# Agent timeline

One feature I haven't seen done well.

```text
09:41 Planning

09:41 Repository Search

09:42 Read File

09:42 Tool Call

09:42 Edit

09:43 Tests

09:43 Retry

09:44 Success
```

Like GitHub Actions, but for the agent.

---

# Live model routing

```text
Planning

↓

GLM 5.2

Code

↓

Kimi K3 Code

Review

↓

GPT-OSS

Verification

↓

Gemma 4
```

Show which model handled each stage.

---

# Multi-agent view (future)

```text
Main Agent

├── Reviewer

├── Architect

├── Tester

└── Researcher
```

Watch each agent working simultaneously.

---

# Theme

Dark.

Cursor-like.

Minimal.

Accent colors only for status.

```
Blue

Agent

Green

Success

Orange

Thinking

Red

Failure

Purple

MCP

Cyan

Repository
```

Avoid excessive borders or decorative elements.

## What I'd build with Ink

Ink (React for Terminal) is the right choice because it lets you build reusable components instead of manually positioning terminal text.

```
<App>

  <Header/>

  <WorkspacePanel/>

  <AgentPanel/>

  <RuntimePanel/>

  <StatusBar/>

  <CommandInput/>

</App>
```

Each panel subscribes to events from the agent runtime (planner, executor, verifier, tool registry) and updates independently. This separation aligns well with the modular architecture you're designing.

## Final recommendation

I would **not** build a Cursor clone or a Claude Code clone.

I'd build a **GitHub Copilot Workspace for the terminal**:

* **Claude Code's** conversational simplicity.
* **Cursor's** repository awareness.
* **Aider's** diff-first editing.
* **OpenHands'** autonomous execution.
* **GitHub Actions'** execution timeline.
* **Raycast's** command palette.
* **VS Code's** explorer and symbol navigation.

The result is a terminal-native workspace rather than a terminal chat application. That design is distinctive and scales naturally as you add planner, verifier, MCP tools, multi-agent orchestration, and specialized agents to `devagent-ts`.

This is exactly where I think **DevAgent can surpass every current coding agent**.

Current agents mostly show a **chat transcript**. The actual reasoning, planning, scheduling, context building, retrieval, tool selection, verification, retries, and orchestration are mostly hidden.

I would make DevAgent's execution **completely observable**.

---

# Example

User:

```text
Refactor my entire repository to support MCP plugins, migrate to the new
Provider API, update tests, benchmark performance, and open a PR.
```

The user types:

```bash
devagent
```

---

# Session

```text
─────────────────────────────────────────────────────────────

DevAgent v1.0

Workspace

devagent-ts

Model

AUTO

Repository

Indexed

MCP

8 Servers

Memory

Loaded

─────────────────────────────────────────────────────────────

>

Refactor the project to support MCP plugins,
update all tests,
benchmark performance,
and create a pull request.

```

---

Immediately

```text
──────────────────────────────────────────────

SYSTEM

Initializing session...

✓ Loading configuration

✓ Loading workspace

✓ Restoring memory

✓ Loading embeddings

✓ Loading repository graph

✓ Loading previous session

✓ Checking git status

✓ Loading MCP servers

✓ Loading plugins

Done.

```

---

# Context Builder

```text
──────────────────────────────────────────────

Context Builder

Workspace Size

2,146 files

Languages

TypeScript
Ruby
Markdown

Tree-sitter

Loading...

✓ Parsed

143,281 nodes

Repository Graph

Loading...

✓ Complete

Import Graph

✓

Call Graph

✓

Git Graph

✓

Recent Files

✓

Embedding Search

Searching...

Top Context

packages/provider

packages/tools

packages/router

packages/mcp

packages/core

Prompt Budget

87%

Done.

```

---

# Planner

```text
──────────────────────────────────────────────

Planner

Breaking task into subtasks...

```

```text
Task 1

Understand current architecture

Priority

Critical

```

```text
Task 2

Design MCP plugin abstraction

```

```text
Task 3

Refactor provider interface

```

```text
Task 4

Update registry

```

```text
Task 5

Update tests

```

```text
Task 6

Benchmark

```

```text
Task 7

Commit

```

```text
Task 8

Open Pull Request

```

---

# Background agents

Instead of one LLM

```text
──────────────────────────────────────────────

Spawning background agents...

```

```text
Agent 1

Repository Architect

GLM-5.2

Running...

```

```text
Agent 2

Code Refactor

Kimi K3 Code

Running...

```

```text
Agent 3

Test Engineer

Gemma4

Running...

```

```text
Agent 4

Reviewer

GPT-OSS

Running...

```

```text
Agent 5

Documentation

Qwen3.5

Running...

```

---

# Repository Search

```text
Searching repository...

```

```text
Tree-sitter

Searching symbols...

✓

```

```text
Finding Provider interface

✓

```

```text
Finding ToolRegistry

✓

```

```text
Finding MCP

✓

```

```text
Finding dependency graph

✓

```

---

# Memory

```text
Conversation Memory

Searching...

```

```text
Found

Previous Provider API discussion

```

```text
Found

Previous MCP design

```

```text
Found

Router Architecture

```

---

# Web Search

```text
Need latest MCP specification.

```

```text
Opening Browser...

```

```text
Searching...

```

```text
GitHub MCP

Anthropic MCP

Ollama MCP

```

```text
Context Updated

```

---

# MCP

```text
Connecting MCP Servers

```

```text
GitHub

✓

```

```text
Filesystem

✓

```

```text
SQLite

✓

```

```text
Docker

✓

```

```text
Browser

✓

```

```text
Slack

Skipped

```

---

# Tool Calls

Instead of

```
Calling read_file
```

I'd show

```text
Tool

ReadFile

Arguments

packages/provider/src/provider.ts

Duration

18ms

Result

742 lines

```

---

```text
Tool

TreeSitter

Query

find interface Provider

Duration

32ms

```

---

```text
Tool

Ripgrep

Pattern

Provider

Matches

184

```

---

```text
Tool

Git

Status

Modified

18 files

```

---

# Editing

```text
Editing...

```

```diff
Provider.ts

+ interface MCPProvider

+ execute()

+ register()

- legacy interface

```

---

# Verification

```text
Verification

────────────────────

Prettier

✓

```

```text
ESLint

Running...

✓

```

```text
TypeScript

Running...

✓

```

```text
Vitest

Running...

```

```text
314 Passed

```

```text
Coverage

93%

```

---

# Reflection

```text
Reflection

```

```text
Reviewer Agent

Found duplicated code.

```

```text
Suggested refactor.

```

```text
Applying...

```

---

# Runtime Metrics

```text
────────────────────────────────────

Models Used

GLM-5.2

Kimi K3

Gemma4

GPT-OSS

Qwen3.5

```

```text
Tool Calls

132

```

```text
Files Read

84

```

```text
Files Modified

21

```

```text
Embeddings

642

```

```text
Context Retrieval

31

```

```text
Git Operations

8

```

```text
Duration

4m12s

```

```text
Estimated Cost

$0.19

```

---

# Git

```text
Creating Commit

```

```text
git commit

```

```text
feat(provider): introduce MCP provider abstraction

```

---

# GitHub MCP

```text
Creating Pull Request

```

```text
Repository

devagent-ts

```

```text
Branch

feature/mcp-provider

```

```text
PR

Created

```

---

# Timeline

```text
09:14 Planning

09:15 Repository Analysis

09:15 Context Retrieval

09:16 Spawned Agents

09:17 Tool Calls

09:18 Editing

09:19 Verification

09:20 Reflection

09:21 Benchmarks

09:22 Commit

09:22 Pull Request

Done

```

---

# Replay

This is the feature I want most.

```bash
devagent replay 482
```

Shows

```text
Planning

↓

Repository Search

↓

Context Builder

↓

Memory

↓

Tools

↓

Edits

↓

Verification

↓

Reflection

↓

Git

↓

PR

```

You can replay **every single decision**.

---

# Inspector Mode

```bash
devagent inspect
```

Shows

```text
LLM Calls

17

Planner Calls

2

Retriever Calls

11

Embedding Queries

21

Tool Invocations

132

MCP Requests

43

Background Agents

5

Verification Steps

7

Retries

1

```

---

## The capability that no current coding agent fully exposes

The key differentiator I'd build into DevAgent is **an execution graph rather than a chat transcript**.

```text
User Request
     │
     ▼
Intent Analysis
     │
     ▼
Planner
     ├──────────────┬──────────────┬──────────────┐
     ▼              ▼              ▼              ▼
Repository     Memory        Web Search      Background Agents
Indexer        Retrieval     / MCP           (Architect, Tester,
     │              │              │           Reviewer, Docs)
     └───────┬──────┴───────┬──────┘
             ▼              ▼
         Context Builder  Tool Registry
                │
                ▼
          Model Router
                │
                ▼
            Executor
                │
                ▼
          Verification Pipeline
                │
                ▼
        Reflection & Self-Repair
                │
                ▼
         Git / Benchmarks / PR
                │
                ▼
          Replayable Execution Log
```

Instead of seeing only the assistant's messages, the user can inspect every planner decision, retrieval step, MCP request, model selection, tool invocation, edit, verification result, retry, and timing. That level of observability makes debugging the agent itself much easier and is an area where DevAgent can meaningfully differentiate from today's CLI coding assistants.

Yes. Below is what I envision as a **true next-generation agent transcript**.

Not just a chat log.

Think of it as **GitHub Actions + Claude Code + Cursor + LangSmith + VSCode + Kubernetes Events** combined.

Everything is observable, replayable and debuggable.

---

# DevAgent v1.0

```text
═══════════════════════════════════════════════════════════════════════════════

DEVAGENT v1.0

Workspace      devagent-ts
Branch         feature/devagent
Model Router   AUTO
Provider       Ollama Cloud
Memory         Loaded
MCP            Connected
Repository     Indexed

═══════════════════════════════════════════════════════════════════════════════

> Add a GitHub MCP provider, migrate the provider architecture,
> update all tests,
> benchmark performance,
> create a pull request.

```

---

# 1 Session Bootstrap

```text
[09:41:02.114]

SESSION

──────────────────────────────────────────────

Loading configuration...

✓ ~/.devagent/config.yaml

Loading plugins...

✓ 14 plugins

Loading providers...

✓ Ollama

✓ OpenAI

✓ Anthropic

✓ Gemini

Loading model router...

✓ Loaded

Loading memory...

✓ Conversation

✓ Repository

✓ Knowledge Graph

✓ Vector Store

Loading workspace...

✓ /home/shubham/devagent-ts

Loading repository index...

✓ 2,483 files

Ready.
```

---

# 2 Git

```text
──────────────────────────────────────────────

GIT

Current Branch

feature/devagent

Status

Clean

Remote

origin

Repository

devagent-ts

Last Commit

c8ab132

```

---

# 3 Workspace Indexing

```text
──────────────────────────────────────────────

INDEXER

Starting incremental indexing...

Changed Files

14

Tree-sitter

Parsing...

```

```text
Ruby

✓

TypeScript

✓

Markdown

✓

YAML

✓

JSON

✓

```

---

```text
AST

Nodes

413,882

Symbols

82,113

Functions

18,812

Classes

4,226

Interfaces

1,742

Imports

48,292

```

---

# 4 Repository Graph

```text
Repository Graph

Building...

```

```text
Import Graph

✓

Call Graph

✓

Reference Graph

✓

Inheritance Graph

✓

Dependency Graph

✓

PageRank

✓

```

---

# 5 Embeddings

```text
Embedding Engine

Checking cache...

```

```text
Existing

18,433

```

```text
Changed

18

```

```text
Embedding

18 files...

```

```text
Done.

```

---

# 6 Context Builder

```text
──────────────────────────────────────────────

CONTEXT BUILDER

User Intent

Repository Refactor

Budget

96k tokens

Context Sources

Repository Graph

Conversation

Memory

Git History

Embedding Search

Documentation

Recent Files

Architecture Notes

```

---

# 7 Retrieval

```text
Embedding Search

Searching...

```

```text
Top Results

packages/provider

packages/router

packages/mcp

packages/core

packages/tools

packages/cli

```

---

```text
Conversation Memory

Found

Provider abstraction discussion

```

```text
Architecture Memory

Found

Plugin architecture

```

---

# 8 Planner

```text
═══════════════════════════════════════

PLANNER

Goal

Migrate Provider Layer

```

---

```text
Task Graph

```

```text
[1]

Repository Analysis

READY
```

```text
[2]

Design Provider API

WAITING
```

```text
[3]

Implement MCP

WAITING
```

```text
[4]

Update Registry

WAITING
```

```text
[5]

Run Tests

WAITING
```

```text
[6]

Review

WAITING
```

```text
[7]

Benchmark

WAITING
```

```text
[8]

Commit

WAITING
```

```text
[9]

Open Pull Request

WAITING
```

---

# 9 Background Agents

```text
═══════════════════════════════════════

SPAWNING AGENTS

```

```text
Agent

Architect

Model

GLM-5.2

Status

Running
```

---

```text
Agent

Coder

Model

Kimi K3 Code

Status

Running
```

---

```text
Agent

Reviewer

Model

GPT-OSS

Status

Running
```

---

```text
Agent

Tester

Model

Gemma4

Status

Running
```

---

```text
Agent

Docs

Model

Qwen3.5

Status

Running
```

---

# 10 MCP

```text
═══════════════════════════════════════

MCP

Connecting...

```

```text
Filesystem

✓

GitHub

✓

Docker

✓

SQLite

✓

Browser

✓

Slack

✓

Kubernetes

✓

```

---

# 11 Tool Calls

Instead of

```
read_file()
```

Show

```text
═══════════════════════════════════════

TOOL CALL

ReadFile

```

```yaml
Arguments

path:

packages/provider/src/provider.ts

encoding:

utf8
```

---

```text
Execution

18ms

```

```text
Output

742 lines

```

---

Next

```text
═══════════════════════════════════════

TOOL CALL

TreeSitter

```

```yaml
Query

find interface Provider

```

---

```text
Matches

12

```

---

```text
Duration

9ms

```

---

```text
═══════════════════════════════════════

TOOL CALL

Ripgrep

```

```yaml
Pattern

Provider

```

---

```text
Matches

184

```

---

```text
Duration

22ms

```

---

# 12 Thinking

Not hidden.

```text
═══════════════════════════════════════

THINKING

Current Provider interface tightly couples

transport and model logic.

Recommendation

Introduce

Transport

Provider

Capability

Authentication

Streaming

Tool Calling

as independent interfaces.

Estimated impact

42 files

Confidence

94%

```

---

# 13 Model Router

```text
═══════════════════════════════════════

MODEL ROUTER

Planning

↓

GLM-5.2

```

```text
Repository Search

↓

Qwen3.5

```

```text
Code Generation

↓

Kimi K3 Code

```

```text
Review

↓

GPT-OSS

```

```text
Verification

↓

Gemma4

```

---

# 14 Editing

```diff
packages/provider/provider.ts

+ interface Provider

+ interface Transport

+ interface ToolCapability

+ interface StreamCapability

- class LegacyProvider

```

---

Another

```diff
packages/router/router.ts

+ registerProvider()

+ selectProvider()

+ scoreModel()

```

---

# 15 Runtime

```text
═══════════════════════════════════════

EXECUTOR

Running Tasks

█████████████████████░░░░░░░

72%

```

---

```text
Completed

Repository Analysis

Provider Refactor

MCP

Registry

```

---

```text
Running

Tests

```

---

# 16 Terminal

```bash
pnpm lint
```

```
✓ Passed
```

---

```bash
pnpm test
```

```
483 Passed

2 Failed

```

---

# 17 Reflection

```text
═══════════════════════════════════════

REFLECTION

Reviewer

Found

Duplicate provider implementation

```

---

```text
Suggested Fix

Reuse TransportFactory

```

---

```text
Applying...

```

---

# 18 Retry

```bash
pnpm test
```

```
485 Passed

```

---

# 19 Benchmarks

```text
═══════════════════════════════════════

BENCHMARK

Startup

1.82s

```

---

```text
Index

2.31s

```

---

```text
Prompt

3.42s

```

---

```text
Memory

112ms

```

---

```text
Embedding

291ms

```

---

# 20 Git

```bash
git add .
```

---

```bash
git commit
```

```
feat(provider): introduce modular provider architecture

```

---

# 21 GitHub MCP

```text
═══════════════════════════════════════

GITHUB MCP

Creating PR

```

```text
Repository

devagent-ts

```

---

```text
Branch

feature/provider

```

---

```text
PR

Created

#482

```

---

# 22 Final Summary

```text
═══════════════════════════════════════

SUMMARY

Duration

4m 42s

Models Used

GLM-5.2

Qwen3.5

Kimi K3

GPT-OSS

Gemma4

Background Agents

5

Tool Calls

184

MCP Calls

31

Files Read

84

Files Modified

21

Tests

485 Passed

Benchmarks

Completed

Git

Committed

GitHub

PR Created

Estimated Cost

$0.17

═══════════════════════════════════════
```

# 23 Replay

Days later:

```bash
devagent replay 482
```

Shows:

```text
Timeline

09:41 Session

09:42 Index

09:42 Planning

09:43 Retrieval

09:43 MCP

09:44 Tool Calls

09:45 Editing

09:46 Tests

09:47 Reflection

09:47 Retry

09:48 Benchmark

09:48 Commit

09:49 Pull Request
```

## The feature I would add that no current CLI exposes

I would add an **Execution DAG (Directed Acyclic Graph)** alongside the transcript.

```text
User Request
      │
      ▼
Intent Analysis
      │
      ▼
Planner
 ┌────┼────┬──────────┬─────────┐
 ▼    ▼    ▼          ▼         ▼
Repo Memory Web      MCP    Background
Index Search         Tools    Agents
 └────┬────┴────┬─────┴────────┘
      ▼         ▼
 Context Builder
      │
      ▼
 Model Router
      │
      ▼
 Executor
      │
      ▼
 Verification
      │
      ▼
 Reflection
      │
      ▼
 Git / PR / Deploy
```

Each node would be clickable in the TUI to inspect:

* Prompt sent to the model.
* Context retrieved.
* Selected model and routing reason.
* Tool inputs and outputs.
* Token usage, latency, and cost.
* Retries and errors.
* Produced diffs.
* Verification results.

That turns the transcript from a chat log into a fully inspectable execution trace, making DevAgent both a powerful coding assistant and a debuggable autonomous agent platform.

This is exactly where I think **DevAgent should differentiate itself**.

Every existing agent (Claude Code, Codex CLI, Cursor, Aider, Gemini CLI, Cline, Roo, OpenHands) is fundamentally a **conversation**.

I think **DevAgent should be an Operating System for AI Agents.**

The chat is merely one interface.

---

# DevAgent OS

```text
                   User
                     │
     ┌───────────────┼────────────────┐
     │               │                │
 CLI Input      TUI Input       API/Webhook
     │               │                │
     └───────────────┼────────────────┘
                     ▼
            Intent Classifier
                     ▼
             Session Manager
                     ▼
            Execution Planner
                     ▼
         Agent Orchestrator (DAG)
                     ▼
      ┌──────────────┼───────────────┐
      ▼              ▼               ▼
 Main Agent    Background      Event Bus
                Agents
      ▼              ▼               ▼
 Context      Tool Registry     Memory
 Builder           │
                   ▼
          MCP / Native Tools
                   ▼
          Model Router
                   ▼
          Ollama/OpenAI/etc
```

Notice there is **no "chat loop"** in the architecture.

The architecture is **event-driven**.

---

# Session Types

The UI should start with a session type.

```bash
devagent
```

```
What would you like to do?

❯ Code
  Architecture
  Research
  Documentation
  Trading
  DevOps
  Database
  Security
  General Chat
```

The selected mode loads:

* prompts
* tools
* MCPs
* memory
* agent graph

---

# User Input

Instead of only

```
>
```

Support multiple input modes.

```
──────────────────────────────

Input

──────────────────────────────

✓ Chat

✓ Slash Commands

✓ Voice

✓ Image

✓ File

✓ Drag Folder

✓ GitHub URL

✓ Jira Ticket

✓ Linear Issue

✓ Markdown

✓ Diff

✓ Terminal Output

✓ Stacktrace

✓ SQL

✓ HTTP Request

✓ JSON

✓ OpenAPI

✓ UML

✓ Figma

✓ MCP Resource

✓ Clipboard

```

---

# Intent Detection

User writes

```
Fix this bug
```

DevAgent should infer

```
Intent

Bug Fix

Confidence

97%

Suggested Workflow

Repository Search

↓

Stack Trace Analysis

↓

Related Files

↓

Fix

↓

Tests

↓

Review

```

User can override.

---

# Suggestions

Before execution

```
Suggested Plan

────────────────────────

✓ Spawn Reviewer

✓ Spawn Tester

✓ Enable GitHub MCP

✓ Run Tests After Edit

✓ Benchmark

✓ Auto Commit

✓ Create PR

```

The user can toggle.

---

# Agent Selection

Instead of

```
Agent
```

Show

```
Main Agent

────────────

Architect

Coder

Tester

Reviewer

Security

Docs

Performance

Database

DevOps

```

User can enable/disable.

---

# Agent Conversation

Unlike Claude Code

```
Architect

I recommend splitting Provider into

Transport

Provider

Capability

```

```
Coder

Implemented.

```

```
Reviewer

Found duplicated logic.

```

```
Tester

2 tests failing.

```

```
Security

Unsafe shell execution.

```

The user sees **agent-to-agent discussions**.

---

# Agent Skills

Every agent loads skills.

Architect

```
Skills

✓ System Design

✓ Refactoring

✓ Patterns

✓ DDD

✓ Event Sourcing

✓ Microservices
```

Tester

```
Skills

✓ Jest

✓ Vitest

✓ Playwright

✓ Cypress

✓ Coverage

✓ Benchmark
```

Security

```
Skills

✓ OWASP

✓ Secrets

✓ SQL Injection

✓ Dependency Scan

```

---

# MCP Usage

Instead of hidden

Show

```
MCP

──────────────────────

Filesystem

Connected

GitHub

Connected

Docker

Connected

Browser

Connected

SQLite

Connected

Slack

Disconnected

```

---

During execution

```
MCP

Filesystem

read_file()

21ms

```

```
GitHub

create_pr()

412ms

```

```
Browser

web_search()

1.2s

```

---

# Inference

One feature nobody shows.

```
Inference

────────────────────────

Intent

Repository Refactor

Confidence

94%

Reason

Provider interface appears in

182 files.

User requested migration.

```

---

```
Model Selection

Planning

GLM-5.2

Reason

Highest planning score.

```

---

```
Editing

Kimi K3

Reason

Highest SWE benchmark.

```

---

```
Review

GPT-OSS

Reason

Lowest hallucination score.

```

---

# Context

Live.

```
Prompt

────────────────────────

Conversation

18%

Repository

42%

Memory

11%

Embeddings

14%

Git

7%

Documentation

8%

```

---

# Retrieval

```
Retrieved

────────────────────────

packages/provider

97%

packages/router

91%

packages/core

88%

README

84%

Previous Discussion

79%

```

---

# Runtime

```
Runtime

────────────────────

Planner

Running

Executor

Running

Reflection

Waiting

Verifier

Waiting

```

---

# User Options

During execution

```
Ctrl+P

Pause

```

```
Ctrl+R

Retry

```

```
Ctrl+S

Skip

```

```
Ctrl+M

Switch Model

```

```
Ctrl+A

Spawn Agent

```

```
Ctrl+T

Disable Tool

```

```
Ctrl+L

Limit Context

```

---

# Recommendations

After understanding repo

```
Recommendations

────────────────────

Repository contains

Duplicate Tool Registry

Confidence

98%

Recommended

Merge Registry

Estimated Savings

420 LOC

```

---

```
Detected

Provider tightly coupled.

Recommend

Transport Layer

```

---

```
Detected

Unused package

```

---

```
Detected

Missing tests

```

---

# Auto Mode

```
Execution

────────────────────

Interactive

❯

Semi Automatic

Automatic

Fully Autonomous

```

---

# Background Tasks

While coding

```
Background

────────────────────

Reviewer

Running

Security Scan

Running

Dependency Update

Waiting

Documentation

Generating

Benchmark

Running

```

---

# Notifications

```
Notification

────────────────────

Reviewer found issue.

Open?

[y]

```

---

# Event Timeline

```
09:12

User Input

```

```
09:12

Planner

```

```
09:12

Repository Search

```

```
09:13

Memory

```

```
09:13

Agent Spawn

```

```
09:13

Tool

```

```
09:14

Reflection

```

```
09:15

Tests

```

```
09:16

PR

```

---

# Explainability

Every decision

```
Why did you choose

GLM?

```

```
Reason

Highest planning score

Estimated

17% faster

```

---

```
Why this file?

```

```
Referenced by

142 imports

Highest PageRank

Recent Edit

```

---

# Replay

```
Replay

────────────────────

View Prompt

View Context

View Model

View Tool Calls

View Diff

View Tests

View Reflection

View Cost

View Tokens

View Latency

```

---

## The feature I believe would make **DevAgent** fundamentally different

I would not make the transcript the primary artifact.

The primary artifact would be an **Execution Graph**.

```text
                    User Goal
                         │
                Intent Classification
                         │
                Session Configuration
                         │
               Planner / Task Decomposition
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   Architect        Researcher      Security
          │              │              │
          └──────┬───────┴───────┬──────┘
                 ▼               ▼
          Context Builder   Tool Registry
                 │               │
                 └──────┬────────┘
                        ▼
                 Model Router
                        ▼
              Executor / Verifier
                        ▼
             Reflection / Self-Repair
                        ▼
               Git / PR / Deployment
```

Every node is **clickable** in the TUI.

Clicking a node opens:

* Prompt sent to the model.
* Retrieved context and embeddings.
* Selected model and routing rationale.
* MCP and native tool invocations.
* Agent-to-agent messages.
* Generated diffs.
* Verification outputs.
* Performance metrics (latency, tokens, cost).
* Retry history.
* Confidence score and reasoning.

That transforms DevAgent from a coding assistant into an **AI Operating System** where users can observe, audit, debug, and extend every aspect of autonomous execution rather than interacting with a single opaque chat transcript.

Yes. Good catch.

**That image is still essentially a dashboard.** It's a **three-pane IDE/dashboard hybrid**, similar to Cursor or VS Code, not the UI I'd actually recommend after thinking through DevAgent's architecture.

I think we should separate two concepts:

1. **Dashboard** (what I generated)
2. **Agent Workspace** (what I think DevAgent should be)

They're not the same.

---

# Option 1 — Dashboard (❌ I would NOT choose this)

Like the image.

```text
┌──────┬────────────────────────────┬─────────────┐
│ Tree │ Chat                       │ Runtime     │
│      │                            │             │
│      │                            │             │
└──────┴────────────────────────────┴─────────────┘
```

Pros

* Easy to build
* Familiar
* VSCode-like

Cons

* Static
* Wastes space
* Doesn't adapt
* Doesn't scale for autonomous agents

This is basically Cursor.

---

# Option 2 — Chat-first (Claude Code)

```text
> build MCP server

Thinking...

Tool...

Edit...

Done
```

Pros

Simple.

Cons

Hidden execution.

Can't see planner.

Can't inspect context.

No replay.

---

# Option 3 — Event Console (🔥 My favorite)

Think:

* Kubernetes
* GitHub Actions
* LangSmith
* Raycast
* Claude Code

Combined.

Instead of

```text
Chat

Chat

Chat

Chat
```

Everything becomes events.

```text
09:41 User Request

09:41 Intent

09:41 Planner

09:41 Context

09:41 Retrieval

09:42 Tool

09:42 Edit

09:42 Verification

09:43 Reflection

09:43 Retry

09:44 Commit

09:44 PR
```

The screen changes dynamically.

---

# Imagine this

Instead of fixed panels

The terminal is alive.

```text
═══════════════════════════════════════

Planner

██████████████░░░░░░

```

disappears

↓

Then

```text
Repository Search

██████████████████████

```

disappears

↓

Then

```text
Tool Calls

ReadFile

TreeSitter

Ripgrep

```

↓

Then

```text
Diff

```

↓

Then

```text
Tests

```

↓

Then

```text
Reflection

```

↓

Then

```text
Summary

```

Everything expands and collapses.

No wasted space.

---

# Think "htop"

Not VSCode.

The UI is always changing.

---

# Another inspiration

Imagine if GitHub Actions ran locally.

```
Session

↓

Planner

↓

Repository

↓

Agent

↓

Tests

↓

Deploy
```

Each stage expands.

---

# Dynamic Cards

Instead of

```
Sidebar

Chat

Terminal
```

Cards appear only when needed.

```
Planning
```

↓

Planning card disappears.

```
Repository Analysis
```

↓

Disappears.

```
Editing
```

↓

Disappears.

```
Verification
```

↓

Disappears.

Only active tasks are visible.

---

# Timeline

The left side becomes

```
09:41 Planning

✓

09:41 Retrieval

✓

09:42 Edit

Running

09:43 Tests

Waiting
```

Like GitHub Actions.

---

# Active Agents

Instead of permanent boxes

```
Architect

Running

```

↓

finished

↓

collapses

```
Reviewer

Running

```

↓

finished

↓

collapses

---

# Tool Calls

Every tool appears only while active.

```
TreeSitter

Running...

```

↓

Done

↓

Hidden

---

# Bottom Prompt

Always stays

```
devagent >
```

Everything else changes.

---

# This becomes more like

```
kubectl

+

htop

+

GitHub Actions

+

Claude Code

+

Raycast
```

instead of

```
VSCode
```

---

# The layout I'd actually build

```
┌──────────────────────────────────────────────┐
│ Session Header                               │
├──────────────────────────────────────────────┤
│                                              │
│ Dynamic Execution Workspace                  │
│                                              │
│ (Planning)                                   │
│ (Tools)                                      │
│ (Diffs)                                      │
│ (Tests)                                      │
│ (Reflection)                                 │
│                                              │
├──────────────────────────────────────────────┤
│ Timeline                                     │
├──────────────────────────────────────────────┤
│ devagent >                                   │
└──────────────────────────────────────────────┘
```

Notice:

* **No sidebar**
* **No fixed dashboard**
* **No permanent tree**
* **No wasted panes**

The workspace morphs depending on what the agent is doing.

## What I would build for DevAgent

I'd actually build **three interchangeable layouts**, because different workflows need different views:

1. **Focus Mode (default, ~80% of usage)** – a dynamic execution console like described above.
2. **Inspect Mode** – adds collapsible panels for repository explorer, execution graph, context, tool calls, and MCP state when you need to debug or understand the agent.
3. **Mission Control** – a wide-screen orchestration view showing multiple agents, queues, timelines, and metrics for long-running or multi-agent tasks.

The user could switch instantly with something like `F1`, `F2`, and `F3`.

I think **Focus Mode** should be the default because it maximizes screen space for the current task, while **Inspect Mode** and **Mission Control** provide the richer dashboard-style views only when they're actually useful. That gives you the strengths of Claude Code, Cursor, and GitHub Actions without inheriting the limitations of any one of them.

Yes. That is exactly how I would design it.

In fact, I would go one step further:

> **The TUI should not display components. It should display the live execution of the agent.**

Think of the TUI as a **window into the current execution session**, not as a static application.

---

# Session Lifecycle

Every session starts empty.

```text
devagent
```

```
───────────────────────────────

New Session

Workspace

devagent-ts

Waiting for input...

>

```

Nothing else is visible.

---

User types

```
Refactor provider architecture
```

Immediately the TUI changes.

```
───────────────────────────────

Intent

Repository Refactor

Confidence 97%

[Accept]

[Edit]

[Cancel]

```

Once accepted

That panel disappears forever.

---

Planner appears.

```
Planning...

█████████████████

Breaking into tasks...

```

Planner finishes.

Planner collapses.

---

Repository indexing appears.

```
Repository Search

Searching...

█████████████

```

Finished.

Disappears.

---

Memory retrieval appears.

```
Conversation Memory

Searching...

Found 3 discussions

```

Finished.

Collapses.

---

Background agents appear.

```
Architect

Running...

```

↓

Done

↓

Hidden.

---

Tool calls appear.

```
ReadFile

packages/provider.ts

```

↓

Finished

↓

Removed.

---

Tree-sitter appears.

```
Finding references...

```

↓

Done

↓

Removed.

---

Ripgrep appears.

```
Searching...

```

↓

Done.

↓

Removed.

---

Diff appears.

```
Modified

provider.ts

```

↓

User approves.

↓

Disappears.

---

Tests appear.

```
Running

pnpm test

```

↓

Passed

↓

Removed.

---

Reflection appears.

```
Reviewer

Found duplicated code.

```

↓

Fixed.

↓

Removed.

---

Summary appears.

```
Done.

Files

12

Tests

183

Commit

Created

PR

Ready

```

---

# Nothing stays permanently

Unlike Cursor

```
Explorer

Chat

Runtime

```

Those shouldn't always exist.

Instead

```
Session

↓

Execution

↓

Completed

↓

Archive
```

---

# Think of it like this

Imagine Kubernetes.

When you run

```
kubectl get pods
```

You only see **running** pods.

Completed pods disappear.

Same philosophy.

---

# Same for DevAgent

Only active things exist.

```
Planning

ACTIVE
```

↓

Finished

↓

Hidden.

---

```
GitHub MCP

ACTIVE
```

↓

Done

↓

Hidden.

---

```
Architect Agent

ACTIVE
```

↓

Finished

↓

Hidden.

---

```
Embedding Search

ACTIVE
```

↓

Finished

↓

Hidden.

---

# User can expand history

Press

```
Ctrl+H
```

```
Session History

✓ Planner

✓ Context

✓ Retrieval

✓ Tool Calls

✓ Tests

✓ Reflection

```

Expanding one shows all details.

---

# Agent conversations

Normally hidden.

If enabled

```
Architect

↓

Coder

↓

Reviewer

↓

Tester
```

Otherwise

Only

```
✓ Architect completed

```

---

# MCP

Normally

Nothing.

When invoked

```
Filesystem MCP

read_file()

```

↓

Done.

↓

Removed.

---

# Model Router

Normally hidden.

When routing

```
Routing

↓

Planning

↓

GLM-5.2

Reason

Planning

```

↓

Done.

↓

Hidden.

---

# Memory

Appears only when retrieving.

```
Searching Repository Memory...

```

↓

Done.

↓

Hidden.

---

# Context

Appears only while building.

```
Building Context

```

↓

Done.

↓

Hidden.

---

# Thinking

Appears while thinking.

```
Thinking...

```

↓

Finished.

↓

Collapses automatically.

---

# At the end

Only this remains.

```
✓ Completed

Duration

2m14s

Models

3

Tools

48

Files

18

Tests

485

Cost

$0.12

Replay

Available
```

---

# Replay

Later

```
devagent replay
```

Now the session unfolds exactly as it happened.

```
Planning

↓

Context

↓

Retrieval

↓

Tool Calls

↓

Agents

↓

Reflection

↓

Tests

↓

Commit
```

---

## My one addition

I would make **everything event-driven**.

Instead of writing directly to the screen:

```ts
console.log("Running tests...");
```

Every subsystem emits structured events, for example:

```ts
emit("planner.started");
emit("retrieval.completed");
emit("tool.started", { tool: "ReadFile" });
emit("tool.completed", { tool: "ReadFile", duration: 18 });
emit("agent.spawned", { name: "Architect" });
emit("verification.failed", { stage: "Vitest", failures: 2 });
```

The TUI subscribes to these events and decides how to render them. The CLI logger, replay system, metrics collector, web UI, and telemetry can subscribe to the same event stream.

That architecture gives you:

* **Live session UI** with only active operations visible.
* **Replay** of any session from recorded events.
* **Headless execution** (CI/CD) using the same runtime.
* **Future web dashboard** without changing the agent core.
* **Extensible plugins** that can emit their own events without modifying the TUI.

So yes—the TUI should reflect **only what is happening in the current session**, with completed work collapsing into history. The underlying event log remains complete and replayable even though the live interface stays focused and uncluttered.

I would **not** completely hide them.

I think collapsing is the better UX because:

* It preserves the execution history.
* Users can quickly see what has happened.
* Users can expand any step for debugging.
* It avoids overwhelming the screen.

Think of **GitHub Actions**, **Raycast AI**, or **VS Code Test Explorer** rather than a disappearing log.

## I would use three states

### 1. Active (Expanded)

Currently executing.

```text
▼ Planning
──────────────────────────────
Analyzing repository...

██████████░░░░░░ 61%

Current task:
Finding provider interfaces...

ETA: 3s
```

---

### 2. Completed (Collapsed)

Automatically collapses.

```text
▶ ✓ Planning (2.4s)

▶ ✓ Context Builder (1.8s)

▶ ✓ Repository Search (4.1s)

▶ ✓ Memory Retrieval (380ms)
```

One line only.

---

### 3. Expanded on demand

User presses Enter or →.

```text
▼ ✓ Repository Search (4.1s)

Model
Qwen3.5

Embedding Queries
18

Files Searched
42

Retrieved

packages/provider

packages/router

packages/tools

Confidence

96%

Context Added

8,214 tokens
```

Collapse again with ←.

---

# Same applies to everything

### Planner

Collapsed

```text
▶ ✓ Planner
```

Expanded

```text
▼ ✓ Planner

Tasks

✓ Analyze repo

✓ Design

✓ Refactor

✓ Tests

✓ Review

✓ Commit
```

---

### MCP

Collapsed

```text
▶ ✓ GitHub MCP
```

Expanded

```text
▼ ✓ GitHub MCP

create_branch()

create_pr()

comment_issue()

Duration

421ms
```

---

### Tool Calls

Collapsed

```text
▶ ✓ ReadFile (18ms)
```

Expanded

```text
▼ ✓ ReadFile

Arguments

packages/provider.ts

Size

742 lines

Duration

18ms
```

---

### Background Agent

Collapsed

```text
▶ ✓ Architect Agent
```

Expanded

```text
▼ ✓ Architect Agent

Model

GLM-5.2

Reasoning Time

12s

Suggestions

Split Provider

Introduce Transport

Create Capability Layer
```

---

### Reflection

Collapsed

```text
▶ ✓ Reflection
```

Expanded

```text
▼ ✓ Reflection

Issue

Duplicate transport logic

Suggested Fix

TransportFactory

Applied

Yes
```

---

### Tests

Collapsed

```text
▶ ✓ Tests
```

Expanded

```text
▼ ✓ Tests

Vitest

485 Passed

Coverage

94%

Duration

12s
```

---

# The screen would evolve like this

### Initially

```text
▼ Planning
```

↓

Planning finishes

```text
▶ ✓ Planning
```

↓

Next starts

```text
▶ ✓ Planning

▼ Repository Search
```

↓

Search finishes

```text
▶ ✓ Planning

▶ ✓ Repository Search

▼ Context Builder
```

↓

Eventually

```text
▶ ✓ Planning

▶ ✓ Repository Search

▶ ✓ Context Builder

▶ ✓ Memory

▶ ✓ Architect

▶ ✓ Tool Calls

▼ Tests
```

You always know **where you are**.

---

# At the end

Everything is collapsed.

```text
▶ ✓ Planning

▶ ✓ Repository Search

▶ ✓ Context Builder

▶ ✓ Memory

▶ ✓ Architect

▶ ✓ Coder

▶ ✓ Reviewer

▶ ✓ MCP

▶ ✓ Tool Calls

▶ ✓ Editing

▶ ✓ Tests

▶ ✓ Reflection

▶ ✓ Commit

▶ ✓ Pull Request

──────────────────────────

✓ Session Completed

Duration

3m 42s

Press Enter on any step to inspect.
```

---

# Why I prefer this

Completely hiding finished steps creates problems:

* You lose the mental model of what has happened.
* It's harder to debug failures.
* Users can't inspect intermediate decisions.
* It feels "magical" instead of transparent.

A collapsed history gives you:

* **Minimal clutter** (one line per completed stage).
* **Full transparency** (expand any stage).
* **Replayability** (the same data powers `devagent replay`).
* **A clear progress indicator** without dedicating permanent screen space.

I think this strikes the right balance between Claude Code's simplicity and the observability needed for a sophisticated agent framework like `devagent-ts`.

Absolutely. In fact, **I think this should be one of DevAgent's killer features.**

Most CLI agents are **output-only**. I think DevAgent should be **interactive**.

Since you're using **Ink (React for Terminal)**, you can support keyboard navigation today, and if the terminal supports it (Kitty, WezTerm, iTerm2, Windows Terminal, etc.), you can progressively enhance with mouse support.

## Think of it like an IDE, but in a terminal

Instead of:

```text
✓ Planning
✓ Context
✓ Tests
```

You can navigate it.

```text
▶ ✓ Planning

▶ ✓ Context Builder

▼ ✓ Tests

▶ ✓ Reflection

▶ ✓ GitHub MCP
```

The highlighted item is selected.

---

# Keyboard

| Key       | Action                 |
| --------- | ---------------------- |
| ↑ ↓       | Navigate events        |
| ←         | Collapse selected node |
| → / Enter | Expand selected node   |
| Tab       | Next active section    |
| Shift+Tab | Previous section       |
| Space     | Pin/unpin section      |
| Ctrl+F    | Search transcript      |
| Ctrl+R    | Replay current node    |
| Ctrl+P    | Command palette        |
| Ctrl+T    | Tool inspector         |
| Ctrl+A    | Agent inspector        |
| Ctrl+M    | MCP inspector          |
| Ctrl+G    | Execution graph        |
| Ctrl+L    | Live logs              |
| Esc       | Collapse all           |
| Home/End  | First/last event       |

---

# Mouse (when supported)

Hover:

```text
▶ ✓ Planner
```

Tooltip:

```text
Completed in 2.3s

Press Enter to inspect
```

Click:

Expands.

Double-click:

Pins it.

Right-click (if terminal supports):

```text
Copy Prompt

Replay Node

Export JSON

Show Metrics

View Tool Calls

Compare Replay
```

---

# Expand Example

Collapsed:

```text
▶ ✓ Planner
```

Expanded:

```text
▼ ✓ Planner

Goal

Refactor Provider

Duration

2.4s

Tasks

✓ Analyze

✓ Design

✓ Edit

✓ Verify

Model

GLM-5.2

Confidence

98%

Prompt

[...]

Output

[...]

```

---

# Nested expansion

Planner contains Tasks.

Tasks contain Tool Calls.

Tool Calls contain Prompts.

```text
▼ Planner

    ▶ Repository Analysis

    ▶ Provider Design

    ▼ Refactor

         ▶ ReadFile

         ▶ Tree-sitter

         ▶ Ripgrep

         ▶ Edit

```

Like a file explorer.

---

# Agent Inspector

```text
▶ Architect Agent
```

Expand:

```text
▼ Architect Agent

Model

GLM-5.2

State

Completed

Duration

11s

Reasoning

12 steps

Recommendations

Transport Layer

Capability Layer

Provider Factory

```

Expand further:

```text
▼ Reasoning

Thought 1

...

Thought 2

...

```

(Or, if you don't want to expose raw reasoning, show a summarized decision log instead.)

---

# Tool Inspector

```text
▶ Ripgrep
```

Expand

```text
▼ Ripgrep

Pattern

Provider

Files

18

Matches

82

Duration

32ms

Output

packages/provider

packages/router

...
```

---

# MCP Inspector

```text
▶ GitHub MCP
```

Expand

```text
▼ GitHub MCP

create_branch()

✓

create_commit()

✓

create_pr()

✓

Duration

420ms
```

---

# Context Inspector

```text
▶ Context Builder
```

Expand

```text
▼ Context Builder

Conversation

18%

Repository

44%

Embeddings

14%

Memory

12%

Git

8%

Documentation

4%

```

---

# Prompt Inspector

Every LLM call.

```text
▶ LLM Call #14
```

Expand

```text
▼ LLM Call #14

Model

Kimi K3

Temperature

0.2

Input Tokens

10,214

Output Tokens

1,742

Latency

3.1s

Prompt

...

Response

...

```

---

# Execution Graph

Press

```text
Ctrl+G
```

Shows

```text
Intent
  │
Planner
  │
Repository
  │
Context
  │
Router
  │
Executor
  │
Verifier
  │
Reflection
```

Navigate using arrows.

Expand any node.

---

# Timeline

Press

```text
Ctrl+Y
```

```text
09:41 Planner

09:42 Context

09:42 Tools

09:43 Edit

09:44 Tests

09:45 Reflection
```

Jump anywhere.

---

# Search

```text
Ctrl+F

Search

Provider
```

Shows

```text
Planner

✓

ReadFile

✓

Tool Call

✓

Reflection

✓

```

Jump directly.

---

# Diff Mode

```text
Ctrl+D
```

Shows only

```text
Changed Files

provider.ts

router.ts

registry.ts

...
```

---

# Metrics

```text
Ctrl+I
```

```text
Latency

3.2s

Tokens

18k

Cost

$0.14

Models

5

Tools

84

MCP

21

```

---

# Replay

Every event has

```text
Replay

Export

Copy

Inspect

```

---

## One capability I'd add that I haven't seen in other CLI agents

A **Time Machine**.

Imagine pressing `Ctrl+Shift+R` on any completed node.

```text
▶ Planner
```

becomes

```text
Replay Planner

Speed

1x

2x

5x

Frame

132 / 412

```

You can literally watch:

* Planner making decisions.
* Context builder adding repository chunks.
* Model router choosing a model.
* Tool calls being executed.
* Diffs appearing incrementally.
* Tests running.
* Reflection deciding to retry.

This isn't just useful for users—it's incredibly valuable for debugging and developing the agent itself.

### Guiding principle

The interaction model should resemble **a terminal-native tree explorer** (like `lazygit`, `k9s`, or `btop`) rather than a text log. Those applications demonstrate that rich, keyboard-driven TUIs can remain fast and intuitive while exposing deep levels of detail only when the user asks for them. I think DevAgent should follow that philosophy: compact by default, deeply inspectable on demand.

I think the TUI should be modeled as an **event tree**, not a log. Every item has a lifecycle and changes its rendering based on state.

```text
Pending → Running → Waiting → Completed → Archived
          │
          ├── Paused
          ├── Cancelled
          ├── Retrying
          └── Failed
```

---

# Session Start

Nothing is shown except the prompt.

```text
╭────────────────────────────────────────────────────────────╮
│ DevAgent • devagent-ts • AUTO • Ollama Cloud              │
╰────────────────────────────────────────────────────────────╯

>
```

---

User enters

```text
> Build GitHub MCP support and migrate Provider API
```

---

# Stage 1 — Intent (ACTIVE)

When active, it expands automatically.

```text
▼ Intent Detection                          RUNNING

Goal
  Build GitHub MCP support

Analysing request...

Detected intents

  ✓ Repository Refactor
  ✓ MCP Integration
  ✓ Test Updates
  ✓ Documentation

Confidence

  98%

Estimated complexity

  Large

Suggested workflow

  Multi-Agent

██████████████░░░░░ 72%
```

As soon as it completes:

```text
▶ ✓ Intent Detection (421ms)
```

One line.

---

# Planner (ACTIVE)

Planner becomes active.

```text
▼ Planner                                 RUNNING

Building execution graph...

Tasks

[1/8] Analyse Repository

[ ] Design Provider API

[ ] Build MCP Adapter

[ ] Update Tests

[ ] Benchmark

[ ] Documentation

[ ] Commit

[ ] Pull Request

Model

GLM-5.2

████████░░░░░░░
```

Finished

↓

```text
▶ ✓ Planner (2.3s)
```

---

# Context Builder (ACTIVE)

```text
▼ Context Builder                         RUNNING

Loading

✓ Repository

✓ Memory

✓ Git History

✓ Recent Files

Searching Embeddings...

Found

packages/provider

packages/router

packages/mcp

Prompt Budget

61%

██████████████░░░░
```

↓

```text
▶ ✓ Context Builder (1.4s)
```

---

# Background Agents

They appear only while alive.

```text
▼ Background Agents (3 Active)

Architect

RUNNING

Model

GLM-5.2

Current

Designing Provider abstraction

────────────────────

Reviewer

WAITING

────────────────────

Tester

WAITING
```

Architect finishes

↓

```text
▼ Background Agents (2 Active)

▶ ✓ Architect

Reviewer

RUNNING

Tester

WAITING
```

Reviewer finishes

↓

```text
▼ Background Agents (1 Active)

▶ ✓ Architect

▶ ✓ Reviewer

Tester

RUNNING
```

Everything done

↓

```text
▶ ✓ Background Agents
```

---

# MCP

Nothing until used.

When invoked

```text
▼ GitHub MCP

Connecting...

State

Connected

Tool

create_branch()

Arguments

feature/provider

Latency

182ms

Response

Success
```

↓

```text
▶ ✓ GitHub MCP
```

---

# Tool Calls

Instead of dumping logs

Current active tool

```text
▼ ReadFile

packages/provider/provider.ts

742 lines

18ms

██████████████████
```

When finished

```text
▶ ✓ ReadFile
```

Immediately next tool expands.

```text
▼ Tree-sitter

Finding references...

```

↓

```text
▶ ✓ Tree-sitter

▼ Ripgrep

Searching "Provider"

```

↓

```text
▶ ✓ Ripgrep

▼ EditFile

Applying patch...
```

Only one tool expanded unless multiple run concurrently.

---

# Model Router

When routing

```text
▼ Model Router

Planning

↓

GLM-5.2

Repository Search

↓

Qwen3.5

Editing

↓

Kimi-K3-Code

Review

↓

GPT-OSS

Reason

Best latency/cost ratio
```

↓

```text
▶ ✓ Model Router
```

---

# Editing

```text
▼ File Editor

Current File

packages/provider/provider.ts

Patch

+ interface Provider

+ interface Capability

- LegacyProvider

Validation

Syntax

✓

Formatting

Running...

██████████░░░░░
```

↓

```text
▶ ✓ File Editor
```

---

# Verification

This one is special because it streams.

```text
▼ Verification

Running

pnpm lint

✓ Passed

────────────────────

Running

pnpm test

421 / 485

█████████████░░░░

Current

provider.test.ts
```

If tests fail

```text
▼ Verification

Tests

483 Passed

2 Failed

Failure

provider.test.ts

Suggestion

Spawn Fix Agent?

[Y]

[N]
```

If user chooses Y

Verification collapses to

```text
▶ ⚠ Verification
```

Reflection expands automatically.

---

# Reflection

```text
▼ Reflection

Reviewer

Found duplicated logic

Confidence

95%

Recommendation

Reuse TransportFactory

Apply?

[Y]

[N]
```

User presses Y

↓

Reflection performs fix.

↓

Reflection collapses.

---

# Retry

Only appears if needed.

```text
▼ Retry

Reason

2 tests failed

Attempt

1/3

Strategy

Minimal patch
```

↓

Done

↓

```text
▶ ✓ Retry
```

---

# Git

```text
▼ Git

git add

✓

git commit

Running...

Message

feat(provider): modular provider architecture
```

↓

```text
▶ ✓ Git
```

---

# GitHub

```text
▼ GitHub

Branch

feature/provider

Creating PR...

Reviewer

@team

Labels

enhancement

automation

```

↓

```text
▶ ✓ GitHub
```

---

# Session End

Everything is collapsed.

```text
▶ ✓ Intent Detection

▶ ✓ Planner

▶ ✓ Context Builder

▶ ✓ Repository Search

▶ ✓ Model Router

▶ ✓ Background Agents

▶ ✓ MCP

▶ ✓ Tool Calls

▶ ✓ File Editor

▶ ✓ Verification

▶ ✓ Reflection

▶ ✓ Retry

▶ ✓ Git

▶ ✓ GitHub

────────────────────────────────────────────

✓ Session Complete

Duration

4m12s

Files Changed

18

Models

5

Agents

4

Tool Calls

183

Replay Available
```

---

# User Expands Verification

```text
▼ ✓ Verification

Lint

✓

TypeScript

✓

Tests

485 Passed

Coverage

94%

Duration

18s

Expand Logs >

Expand Failures >

Expand Timing >

Expand Tool Calls >
```

---

# User Expands Background Agents

```text
▼ ✓ Background Agents

▶ Architect

▶ Reviewer

▶ Tester

▶ Documentation

```

Expand Architect

```text
▼ Architect

Model

GLM-5.2

Duration

11s

Tasks

✓ Designed Provider API

✓ Identified Coupling

✓ Suggested Transport Layer

Artifacts

provider-design.md

Confidence

96%
```

---

# Idle State

Once the session is complete, the UI returns to a compact view:

```text
╭────────────────────────────────────────────────────────────╮
│ ✓ Session #248 Complete • Replay • Export • Resume         │
╰────────────────────────────────────────────────────────────╯

▶ ✓ Intent Detection
▶ ✓ Planner
▶ ✓ Context Builder
▶ ✓ Background Agents
▶ ✓ Verification

>

```

## Design principles

* **Active work is always expanded** and streams live updates.
* **Completed work automatically collapses** to a single summary line.
* **Failed work remains expanded** until the user resolves or dismisses it.
* **Waiting tasks** are shown inside their parent stage but collapsed by default.
* **Any completed node** can be expanded later with the keyboard or mouse (where supported).
* The TUI is **state-driven** rather than log-driven: users always see what is happening now, while retaining full access to prior execution details through expandable history.
