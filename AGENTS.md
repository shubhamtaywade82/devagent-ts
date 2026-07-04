# AGENTS.md – DevAgent‑TS Project Overview

## 1. Project Purpose

**DevAgent‑TS** is a TypeScript‑based developer‑agent framework that enables LLM‑driven coding assistants.  It provides:
- A **dual‑provider routing layer** (local Ollama + cloud Ollama) with automatic fallback on rate‑limit or network errors.
- **Docker‑sandboxed shell execution** – every `run_shell` tool runs inside an isolated container with no network, bounded memory/CPU and hard time‑outs.
- A **centralised, immutable state store** (`src/runtime/store.ts`) that receives events from all actors, reduces them, and feeds a TUI renderer.
- An **orchestrator** that models plan steps, detects loops, and performs topological dependency ordering, retries and roll‑backs.
- A **plugin‑style tool registry** for safely exposing filesystem, shell and other utilities to the LLM.

The repository contains the full runtime, CLI, TUI, provider, and a small suite of unit tests that validate the core behaviour.

---

## 2. Tech Stack

| Layer | Technology |
|------|--------------|
| **Language** | TypeScript (target ES2022) |
| **Runtime** | Node.js ≥ 20 |
| **Package manager** | npm (lockfile `package-lock.json`) |
| **Testing** | Jest with `ts-jest` preset |
| **Linting** | ESLint (`.eslintrc.cjs`) with `@typescript-eslint` plugin |
| **Formatting** | Prettier (`.prettierrc.json`) |
| **CLI / UI** | Ink (React‑style terminal UI) |
| **Docker sandbox** | Custom Docker image `devagent-sandbox:latest` used by `ShellTool` |
| **LLM provider** | Ollama REST API – local (`http://localhost:11434`) or cloud (`OLLAMA_API_KEY`) |
| **Build** | TypeScript compiler (`tsc`) producing `dist/` |
| **Version control** | Git (runtime tracks branch, ahead/behind, file list) |

---

## 3. Testing Framework & How to Run Tests

The project uses **Jest** with the `ts-jest` preset.
- Configuration lives in `jest.config.js` (roots: `<rootDir>/tests`).
- Tests are located under the `tests/` directory mirroring the source layout (e.g. `tests/tools`, `tests/orchestrator`).

### Run the test suite

```bash
npm test          # runs jest – 25 tests across 5 suites
```

You can also watch tests during development with the standard Jest `--watch` flag (e.g. `npx jest --watch`).

---

## 4. Linting & Formatting Conventions

- **ESLint** (`npm run lint`) linting covers `src` and `tests` and respects the TypeScript project `tsconfig.eslint.json`.  Notable rule overrides:
  - `@typescript-eslint/no-explicit-any` is turned **off** (allowed).
  - Unused‑variable warnings ignore identifiers starting with `_`.
- **Prettier** (`npm run format:check`) enforces a 120‑character line width, trailing commas, and semicolons.  The formatter runs on the same source files as ESLint.
- CI (if any) should enforce both lint and format checks before merging.

---

## 5. Build System & Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compiles TypeScript (`src/ → dist/`) using `tsc` and the `tsconfig.json` configuration. |
| `npm start` | Starts the production TUI (`node dist/tui/index.js`). |
| `npm run dev` | Runs the TUI directly from source via `tsx` (no build step). |
| `npm run dev:legacy` | Runs the older CLI entry point (`src/cli/tui.ts`). |
| `npm run lint` | Executes ESLint over source and test files. |
| `npm run format:check` | Runs Prettier in check mode. |
| `docker build -t devagent-sandbox:latest docker/devagent-sandbox/` | Builds the sandbox image used by `ShellTool`. |

---

## 6. Key Directory Structure

```
.
├── .agents/                # internal DevAgent metadata (runtime, history)
├── .codex/                 # cache for code‑completion helpers
├── .devagent/              # DevAgent runtime files (state, UI layout)
├── bin/                    # CLI entry point (compiled JavaScript)
├── docker/                 # Dockerfile for sandbox image
├── docs/                   # Project documentation (not exhaustive)
├── src/                    # Core library
│   ├── cli/                # CLI glue code (entry points, argument parsing)
│   ├── interaction/        # Interaction layer – UI components, prompts
│   ├── layout/             # Ink layout components (header, activity strip, etc.)
│   ├── mcp/                # Multi‑container protocol server handling
│   ├── memory/             # Vector‑store abstractions for conversation memory
│   ├── orchestrator/        # Planner/orchestrator, loop detector, step types
│   ├── provider/            # Ollama provider implementations and router
│   ├── runtime/            # EventBus, store, reducers, type definitions
│   ├── skills/             # Built‑in skill implementations (e.g., search, models)
│   ├── tools/              # Tool base class and concrete tools (shell, filesystem)
│   └── tui/                # Ink TUI components (main UI, status bar, etc.)
├── tests/                  # Jest test suite mirroring src layout
├── index.html              # Demo HTML page (used by docs or dev preview)
├── package.json            # npm scripts, dependencies, runtime config
├── tsconfig*.json          # Typescript compiler config (main + eslint)
├── .eslintrc.cjs           # ESLint configuration
├── .prettierrc.json        # Prettier configuration
└── README.md               # High‑level project description (this file is more detailed)
```

---

## 7. Notable Architecture Decisions & Conventions

1. **Single Source of Truth – the Store**
   - All UI components read from `src/runtime/store.ts`.  Events flow from actors → `EventBus` → `reduce` → new immutable state.  This guarantees deterministic rendering and makes time‑travel debugging possible.
2. **Bounded Buffers**
   - Conversation, logs, tool‑calls, and notifications have hard caps (`MAX_CONVERSATION = 500`, etc.) to keep long sessions bounded in memory.
3. **Sanitisation of Text**
   - `sanitizeText` strips ANSI escape sequences and control characters before they enter the store, protecting the TUI from malicious output.
4. **Docker‑Sandboxed Shell Tool**
   - `ShellTool` ensures every command runs with no network, limited resources, and an output ceiling (2 MiB).  It also escalates kills if the container is stubborn.
5. **Loop Detection**
   - `src/orchestrator/loop-detector.ts` tracks repeated tool‑call signatures to avoid infinite retries, a common failure mode for LLM‑driven agents.
6. **Dual Provider Router**
   - `src/provider/router.ts` prefers the fast local Ollama server but seamlessly falls back to the cloud tier on 429/connection errors, keeping the agent responsive.
7. **Planner with Dependency Graph**
   - Steps (`PlanStep`) declare `dependencies` and optional `rollbackCommand`.  The orchestrator resolves a topological order, marks blocked steps, and can re‑plan on failures.
8. **Extensible Tool Registry**
   - `src/tools/registry.ts` (not shown) registers tools with name, description and JSON‑schema parameters, enabling the LLM to discover capabilities programmatically.
9. **Environment‑Driven Configuration**
   - Runtime values such as `DEVAGENT_MODEL`, `DEVAGENT_TIMEOUT_MS`, `DEVAGENT_SHELL_IMAGE` are read from `process.env` (via `dotenv`).  This keeps codebase portable across deployments.
10. **Testing Philosophy**
    - Tests are pure unit tests that mock Docker `/run_shell` calls and provider responses.  They assert state transitions in the store rather than UI output, making them fast and deterministic.

---

## 8. Getting Started (quick checklist)

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Build the sandbox image** (required for any `run_shell` tool usage)
   ```bash
   docker build -t devagent-sandbox:latest docker/devagent-sandbox/
   ```
3. **Run the test suite** to ensure everything works
   ```bash
   npm test
   ```
4. **Start the development UI**
   ```bash
   npm run dev
   ```
5. **Build for production**
   ```bash
   npm run build && npm start
   ```

---

*This file is intended for future DevAgent sessions to quickly understand the repository layout, tooling, and architectural conventions.*
