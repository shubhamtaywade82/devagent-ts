# Nexum: Feature Verification & Testing Guide

This guide provides step-by-step instructions to test and verify every core subsystem, interactive TUI feature, model routing strategy, safety guardrail, and session replay mechanism in **Nexum**.

---

## Prerequisite Setup

### 1. Build TypeScript Source

```bash
npm run build
```

### 2. Build Docker Execution Sandbox Image

```bash
docker build -t nexum-sandbox:latest docker/nexum-sandbox/
```

### 3. Run Environment Doctor Diagnostic

```bash
npm run doctor
```

_Verifies active LSP servers (across 14 languages), Docker sandbox availability, Ollama model connections, and workspace configuration._

### 4. Run Full Unit & Integration Test Suite

```bash
npm test
```

_Runs all 900+ unit tests across 122+ test suites._

---

## 1. Verifying Layout Presets & View Switching

Launch the development TUI:

```bash
npm run dev
```

### Layout Presets (`F1`, `F2`, `F3` or Slash Commands)

- **`F1` or `/focus` (Focus Mode)**: Minimal, dynamic execution console maximizing screen space for active tasks.
- **`F2` or `/inspect` (Inspect Mode)**: Collapsible debugger showing Execution DAG, context breakdown, and MCP server statuses.
- **`F3` or `/mission` (Mission Control Mode)**: Wide-screen orchestration grid for multi-agent workers and metrics.

### Tab Navigation (Digit Keys `1–5`)

- **`1`**: `[Chat]` View — Conversational prompt interface and live event stream.
- **`2`**: `[Plan]` View — Execution DAG step planner and topological dependencies.
- **`3`**: `[Tasks]` View — Worker sub-agent statuses (`Architect`, `Coder`, `Tester`, `Reviewer`).
- **`4`**: `[Changes]` View — Validated patch diff previews (`+` additions, `-` deletions).
- **`5`**: `[Logs]` View — Sandboxed terminal logs, LSP diagnostics, and background events.

---

## 2. Verifying Interactive Execution DAG (`Ctrl+G` / `/dag`)

1. Inside Nexum TUI, press **`Ctrl+G`** or type **`/dag`**.
2. **Observe the 3-State Node Lifecycle**:
   - **Active (Expanded)**: Currently executing node showing live progress indicator (`████████░░ 72%`).
   - **Completed (Collapsed)**: Finished steps automatically collapse into a single-line summary (`▶ ✓ [ROUTER] Model Router Selection (80ms)`).
   - **Expanded on Demand**: Navigate with **`↑` / `↓`** arrow keys and press **`Enter`** or **`→`** to expand structured details (Model name, Tool arguments, Rationale, Diagnostics, Coverage). Press **`←`** to collapse.
3. Press **`Esc`** to close the overlay.

---

## 3. Verifying Session Trajectory Recording & Time Machine Replay

1. Execute any multi-step coding task in Nexum:

   ```bash
   nexum "Refactor provider architecture and run tests"
   ```

2. Note the generated **Session ID** printed in the summary banner (e.g. `sess-172`).
3. **Replay the Session Trajectory**:
   - Via TUI slash command: `/replay sess-172`
   - Via CLI: `node bin/cli.js replay sess-172`
4. **Playback Speed Control**: Watch the session unfold step-by-step across all 23 lifecycle stages at `1x`, `2x`, or `5x` speed multipliers.

---

## 4. Verifying Model Router & Capability Tags (`Ctrl+M` / `/model`)

1. Press **`Ctrl+M`** or type **`/model`** to open the Model Switcher overlay.
2. Observe model capability tagging (`coding`, `vision`, `reasoning`, `quick`, `tools`).
3. Test automatic routing:
   - **Architecture Prompt**: _"How should we design a decoupled transport layer?"_ $\rightarrow$ Routes to `reasoning` / `GLM-5.2`.
   - **Code Editing Prompt**: _"Fix syntax error in provider.ts"_ $\rightarrow$ Routes to `coding` / `Kimi-K3`.
   - **Quick Lookup**: _"Where is the entry point?"_ $\rightarrow$ Routes to `quick` / `Qwen3.5`.

---

## 5. Verifying Secret & Path Redaction Safety

1. Submit a prompt or file containing sensitive test tokens:

   ```text
   > Test API key: AKIAIOSFODNN7EXAMPLE and Bearer secret_token_12345
   ```

2. **Verify Redaction**: Confirm that `src/safety/redact.ts` masks the key to `AKIA[REDACTED_AWS_KEY]` before logging or sending context to LLMs.
3. **Verify Sensitive Path Policy**: Attempt to write or read `.env` or `id_rsa`. `src/safety/path-policy.ts` blocks unauthorized access.

---

## 6. Verifying Sandboxed Tool Execution & Hunk Validation

1. Run shell commands through Nexum:
   - Command is executed inside the isolated `nexum-sandbox:latest` Docker container with no network access and bounded memory/CPU limits.
2. Edit code files using search/replace patches:
   - `src/validation/apply-hunks.ts` verifies that `old_str` is unique in the target file and syntax is valid (JS/TS, Python, Ruby, JSON) before applying edits.

---

## 7. Command Palette & Hotkey Reference Summary

| Shortcut                | Function / Overlay Target               |
| :---------------------- | :-------------------------------------- |
| **`Ctrl+P`**            | Universal Command Palette               |
| **`Ctrl+G` / `Ctrl+Y`** | Execution DAG Graph & Timeline          |
| **`Ctrl+M`**            | Model Switcher & MCP Inspector          |
| **`Ctrl+O` / `Ctrl+T`** | Sandboxed Tools Inspector               |
| **`Ctrl+B` / `Ctrl+A`** | Worker Sub-Agents Inspector             |
| **`Ctrl+H`**            | Session History Inspector               |
| **`Ctrl+D`**            | Patch Diff Preview                      |
| **`Ctrl+F` / `Ctrl+K`** | Semantic Search Everywhere              |
| **`Ctrl+I`**            | Dashboard & Token Cost Metrics          |
| **`F1` / `/focus`**     | Focus Mode (Dynamic Execution Console)  |
| **`F2` / `/inspect`**   | Inspect Mode (Collapsible Debugger)     |
| **`F3` / `/mission`**   | Mission Control Mode (Multi-Agent Grid) |
| **`Esc`**               | Close Overlay / Collapse All            |
