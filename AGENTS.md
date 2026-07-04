# AGENTS.md – Guidance for DevAgent Sessions

## 1. Project Purpose (brief)

**DevAgent TS** is a TypeScript framework that provides a "developer‑agent" runtime.  It orchestrates LLM‑driven planning, tool execution, and UI rendering.  The core idea is to let an LLM act as an autonomous coder: it plans steps, calls tools (filesystem, Docker‑sandboxed shell, etc.), handles failures, and presents a consistent TUI.

---

## 2. Tech Stack

| Layer | Technology / Library |
|-------|----------------------|
| Language | **TypeScript** (target ES2022) |
| Runtime | **Node.js ≥ 20** |
| UI | **Ink** (React‑style terminal UI) + **React 18** |
| LLM Provider | Local Ollama (`http://localhost:11434`) and optional cloud tier (`ollama.com`) via a unified REST client (`src/provider/`) |
| Sandbox Execution | Docker container `devagent-sandbox:latest` – `src/tools/shell.ts` runs commands inside this isolated container |
| State Management | Central Redux‑like store (`src/runtime/store.ts`) driven by an `EventBus` – all UI components are pure renderers of immutable state |
| Build | **TypeScript compiler** (`tsc`) → `dist/` |
| Package Management | **npm** (via `package.json`) |
| Linting | **ESLint** with `@typescript-eslint` plugin (`.eslintrc.cjs`) |
| Formatting | **Prettier** (`.prettierrc.json`) |
| Testing | **Jest** with `ts-jest` preset (`jest.config.js`) |
| Containerisation | Dockerfile in `docker/devagent-sandbox/` builds the sandbox image used by the `run_shell` tool |

---

## 3. Testing Framework & How to Run Tests

- Tests live under the `tests/` directory and are written in **Jest** using TypeScript.
- The repository ships with a ready‑made **jest** config (`jest.config.js`) that sets the test roots to `<rootDir>/tests` and uses `ts-jest` for transformation.

**Run the entire suite**:
```bash
npm test
```

**Run a single test file** (example):
```bash
npx jest tests/tools/shell.test.ts
```

**Watch mode** (re‑run on file changes):
```bash
npm test -- --watch
```

All tests should pass locally – there are currently 25 tests across 5 suites.

---

## 4. Linting / Formatting Conventions

- **Lint**: `npm run lint`
  - ESLint is configured to use the project‑wide TypeScript project (`tsconfig.eslint.json`).
  - Rules of note:
    - `@typescript-eslint/no-explicit-any` is **off** (the agent often needs `any`).
    - Unused variables are an error unless they start with `_` (`argsIgnorePattern: "^_"`).
    - The codebase follows the default `eslint:recommended` and `plugin:@typescript-eslint/recommended` sets.
- **Formatting**: `npm run format:check`
  - Enforces 120‑character line width, trailing commas everywhere, and semicolons.
  - Run `npx prettier --write .` locally if you need to auto‑format (the script is not provided but Prettier is in devDependencies).

---

## 5. Build System & Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compiles TypeScript (`src/`) → JavaScript in `dist/` using `tsc`. |
| `npm start` | Runs the compiled TUI (`dist/tui/index.js`). |
| `npm run dev` | Runs the TypeScript source directly via `tsx` for fast iteration (`src/tui/index.ts`). |
| `npm run dev:legacy` | Runs the older CLI entry point (`src/cli/tui.ts`). |
| `npm run lint` | Executes ESLint over `src` and `tests`. |
| `npm run format:check` | Checks Prettier formatting without modifying files. |

---

## 6. Key Directory Structure

```
.
├─ .agents/                 # (runtime state for DevAgent itself)
├─ .codex/                  # (assistant‑generated artefacts)
├─ .devagent/               # internal DevAgent metadata
├─ bin/                      # CLI entry point (devagent executable)
├─ docker/                  # Dockerfile for the sandbox image
├─ docs/                     # Project documentation
├─ src/                      # Main source tree
│   ├─ cli/                 # CLI utilities & command parsing
│   ├─ interaction/         # Interaction model (messages, tool calls)
│   ├─ layout/              # UI layout components (header, view panes, etc.)
│   ├─ mcp/                 # Multi‑Chat‑Provider server handling
│   ├─ memory/               # Vector‑store abstraction
│   ├─ orchestrator/         # Planner/orchestrator, loop‑detector, step types
│   ├─ provider/            # Ollama provider implementation & router
│   ├─ runtime/              # Store, events, task‑machine, types
│   ├─ skills/               # Built‑in skill implementations (search, git, etc.)
│   ├─ tools/                # Tool abstractions – filesystem, shell, registry
│   └─ tui/                  # Ink‑based terminal UI entry point
├─ tests/                    # Jest test suites mirroring src layout
├─ .eslintrc.cjs             # ESLint configuration
├─ .prettierrc.json          # Prettier configuration
├─ jest.config.js            # Jest configuration
├─ package.json & package-lock.json
└─ tsconfig*.json            # TypeScript compiler config (main & eslint variant)
```

---

## 7. Notable Architecture Decisions & Conventions

1. **Actor‑based Event Model** – Every subsystem publishes `RuntimeEvent`s to an `EventBus`.  The immutable `Store` reduces these events into a single `RuntimeState`.  UI components read the state but never mutate it.
2. **Tool Isolation** – Filesystem tools enforce path containment; the `run_shell` tool executes inside a Docker container with network disabled, memory/CPU limits, and a hard timeout.  This guarantees safe execution of arbitrary LLM‑generated commands.
3. **Planning & Loop Detection** – The orchestrator (`src/orchestrator/`) builds a DAG of `PlanStep`s, tracks retries, and the `LoopDetector` prevents infinite retry/replan cycles.
4. **Dual LLM Provider** – `src/provider/router.ts` prefers the fast local Ollama tier and falls back to a cloud tier on rate‑limit or connectivity errors, transparently to the orchestrator.
5. **Mutable‑Free UI** – The TUI (`src/tui/`) is built with Ink + React; because state is immutable and supplied by the Store, the UI can safely re‑render without side‑effects.
6. **Extensible Tool Registry** – New tools register via `src/tools/registry.ts`; the framework automatically exposes them to the LLM via the `Tool` abstract class.
7. **Approval Flow** – Certain actions (e.g., live order placement in a different repo) require explicit user approval; the state machine moves to `mode: "approval"` and awaits a resolution event.
8. **Bounded Buffers** – Logs, conversation, tool calls, etc., are capped (e.g., 500 entries) to keep memory usage predictable for long sessions.
9. **Runtime Config via Env** – Important runtime knobs (`DEVAGENT_MODEL`, `DEVAGENT_TIMEOUT_MS`, `DEVAGENT_SHELL_IMAGE`, etc.) are read from the environment, making the agent configurable without code changes.

---

## 8. Getting Started Quickly

```bash
# Install deps
npm ci

# Build once (optional for dev mode)
npm run build

# Run the interactive TUI (development mode, hot‑reload via tsx)
npm run dev
```

The TUI will display the header, active view, logs, and a prompt.  As you interact, the LLM will plan, invoke tools, and the state will update accordingly.

---

*This file is intended for future DevAgent sessions to quickly understand the codebase, its conventions, and how to work with it safely.*
