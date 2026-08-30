# Nexum

Open-source agent runtime and harness for autonomous software engineering — capability-routed models (local-first), Docker-sandboxed execution, LSP-backed code intelligence, a checkpoint/resume-able orchestrator, and a tool-first architecture (35+ tools) with a terminal UI.

> **Renamed from DevAgent TS.** Nexum 2.0 is the successor to `@nemesis-oss/devagent-ts` 1.x.
> Your `.devagent/` workspace and `DEVAGENT_*` variables keep working — see
> [Migration](#migration-from-devagent-ts) and [docs/REBRANDING.md](docs/REBRANDING.md).

## Architecture

Nexum is the product; the agent runtime is the architecture underneath it:

```text
Nexum
├── Agent Runtime        plan steps, parallel execution, checkpoint/resume
├── Model Gateway        provider client, model catalog, capability router
├── Tool Runtime         35+ tools: filesystem, git, docker, shell, sqlite...
├── Code Intelligence    LSP pool (14 languages) + Rails semantic index
├── Context Engine       memory, summarizer, docs index, tool selection
├── Learning             episodes, grading, reflection, skill synthesis
├── Skills               Markdown skill packages (workspace + global)
├── MCP                  external MCP servers as tools
└── CLI / TUI            Ink terminal UI (see docs/SPEC.md)
```

The model gateway is provider-neutral by design: Ollama (local and cloud) is the
currently shipped provider, not the product's identity.

```text
src/
├── platform/       Brand, environment, paths, workspace — the single source
│                   of truth for product identity (see docs/REBRANDING.md)
├── provider/       Model gateway: provider client (local + cloud), model
│                   catalog, capability router
├── benchmark/      Model scoring harness (JSON validity, tool-calling, latency, tok/s)
├── orchestrator/   Plan steps, parallel dependency-aware execution, checkpoint/resume
├── runtime/        Checkpoint store, config constants, event bus, state store, task machine
├── tools/          35+ tools: filesystem, git, docker, github, sqlite, shell, rspec, rubocop...
├── lsp/            Language server pool/manager — 14 languages configured
├── intelligence/   LSP-backed code intelligence router + Rails semantic index (12 scanners)
├── memory/         SQLite-backed conversation memory + summarizer
├── docs/           DevDocs-backed documentation index (ingest, FTS5 store, workspace detection)
├── learning/       Episode recording, grading, reflection, skill synthesis
├── skills/         Skill loader/registry/resolver (Markdown skill packages)
├── mcp/            MCP client + tool adapter (external MCP servers as tools)
├── cli/            Agent orchestration glue (Agent class, conversation, config)
└── tui/            Ink terminal UI (see docs/SPEC.md — frozen product spec)
```

## Key Features

- **Capability-based model routing, local-first with self-escalation** — `ModelCatalog` discovers installed local + cloud models and tags them (`coding`/`vision`/`reasoning`/`quick`/`tools`) by name heuristic; `Router` picks a local-first candidate per capability and falls back through the rest on rate-limit/timeout/network errors. Every turn attempts the `quick` model (an always-resident small local model, e.g. minicpm5-1b, pinned by name via `quickModel`/`NEXUM_QUICK_MODEL`) first — there is no content-based pre-filter. The model itself decides when it's out of its depth by calling the `escalate_task` tool; once called, the rest of that turn routes to a stronger model (a vision/reasoning-tagged one if the original message hinted at it, otherwise the primary/cloud model), reusing the exact same conversation history so nothing done so far is lost. There's also a heuristic backstop for when a small model doesn't self-escalate: if a tool call errors and the very next turn answers with plain text instead of retrying or calling `escalate_task`, that answer is discarded (never shown) and the turn is silently re-run on the primary model. Escalation is scoped to a single turn — the next user message starts back on the quick model.
- **Checkpoint/resume** — the orchestrator persists plan state (`CheckpointStore`, atomic JSON) after every step transition; `Agent.resumePlannedTask()` picks a crashed run back up, resetting only non-terminal step statuses so completed work is never re-run. Separately, `SessionStore` persists the full LLM conversation transcript after every turn; `Agent.resumeSession()` / the `/resume` slash command restore it in a fresh process, verified to correctly re-send prior context to the model.
- **Browser tool** — `src/browser/manager.ts` wraps a lazily-launched headless Chromium (Playwright) with one reused page; `browser_navigate`/`click`/`fill`/`get_text`/`screenshot`/`evaluate`/`close` tools expose it to the agent.
- **Parallel step execution** — independent plan steps (no dependency between them) run concurrently via `Promise.all` each round; dependents still wait for their dependency's batch to finish.
- **Tool-first architecture** — the LLM never searches files, greps, or runs git/docker/gh by itself; every such action is a deterministic `Tool` with a JSON-schema signature. `DynamicToolSelector` prunes which tool schemas are exposed per turn instead of dumping the full registry.
- **LSP intelligence** — 14 languages configured (TypeScript, Ruby, Python, Go, Rust, Java, C#, C/C++, PHP, Swift, Kotlin, Dart, YAML, Docker), with definition/references/hover/diagnostics/rename/completion/etc. exposed as tools.
- **Rails semantic index** — 12 scanners (controller, model, job, mailer, policy, concern, migration, schema, view, rspec, routes, gem) feeding a graph store and query engine, exposed as `find_model`/`find_route`/`find_controller`/etc. tools.
- **Benchmark harness** — `npm run benchmark` runs built-in cases against every discovered local + cloud model (or one, via `--model <substring>`; a category, via `--category <name>`), reporting pass rate, latency, and tokens/sec per model plus a pass-rate breakdown per category. Prints a running/done progress line per case (`[3/14] local/model — case-id ...`) and enforces a per-case timeout (`--timeout <ms>`, default 2 minutes) so a stalled local server — which has no built-in request timeout — reports as a failed case instead of hanging the whole run forever. Cases span 8 categories: `output-format`/`tool-calling` (JSON validity, correct tool selection among distractors, typed arguments, not over-calling tools), `reasoning`/`thinking` (multi-step word problems, logic deduction, chain-of-thought), `agentic-looping` (multi-turn ReAct-style tool chains), `error-recovery` (retrying after a scripted tool failure instead of giving up), `escalation` (the real `escalate_task` tool: does the model self-escalate on a genuinely hard task, and does it avoid escalating an easy one), and `execution` (real end-to-end tool calls — actual filesystem reads and ripgrep-backed search against a throwaway workspace, not mocked). Single-turn cases (`src/benchmark/cases.ts`) hit the model once; agentic cases (`src/benchmark/cases-agentic.ts`, `cases-execution.ts`) run a standalone bounded ReAct loop (`runner.ts`) mirroring `Agent.runUserMessage`'s tool-turn loop, independent of the real agent/conversation/routing machinery.
- **Learning + memory** — episode recording, grading, reflection, and skill synthesis (`src/learning/`) backed by a SQLite conversation store (`src/memory/`).
- **Offline documentation search** — `npm run docs:ingest -- <id...>` fetches [DevDocs](https://github.com/freeCodeCamp/devdocs)'s pre-built per-library JSON bundles (no scraping at runtime) and indexes them into a local SQLite FTS5 store (`.nexum/docs.db`). `search_docs`/`get_doc`/`list_doc_sources` tools expose it to the agent; `search_docs` auto-scopes to doc sources relevant to the current workspace (detected from `package.json`/`tsconfig.json`/`Gemfile`/`go.mod`/etc. — Rails, React, Node, TypeScript, Python, Go, Rust, ...) unless a `source` is given explicitly.
- **Docker-sandboxed shell** — `--network=none`, `--pids-limit=128`, memory/CPU capped; buffer-overflow SIGKILL, hard timeout with kill escalation.
- **Path-contained filesystem tools** — every path resolved and checked against workspace root before I/O; atomic writes via temp+rename.
- **Loop detection** — flags repeated (tool, args, error) signatures to prevent infinite retry cycles.

## Tools

Filesystem/edit: `read_file`, `write_file`, `patch`, `append`, `list_directory`, `delete_file`, `make_directory`, `copy_file`, `move_file`, `snapshot_backup`, `watch`, `search_code`.
VCS/infra: `git`, `docker` (build/run/stop/logs/exec/compose; `--privileged` blocked), `github` (`gh` pr/issue/release/repo/run/api; merge/delete/close blocked), `sqlite_query` (read-only: SELECT/PRAGMA/EXPLAIN only).
Market data: `binance_public_api` (GET-only, no API key — spot/USD-M/COIN-M public endpoints incl. `/futures/data/*` OI history & long-short ratio), `binance_technical_indicators` (SMA/EMA/RSI/MACD/Bollinger from klines), `binance_order_book` (bid/ask imbalance), `binance_futures_stats` (funding rate + open interest), `binance_screener` (multi-symbol RSI scan), `binance_watch_price`/`binance_unwatch_price` (live WebSocket ticker), `binance_price_alert` (WS-backed price threshold alerts), `binance_liquidations` (live futures liquidation feed).
Quant research: `binance_backtest` (rule-based strategy vs real history — win rate/expectancy/profit factor/drawdown), `binance_walk_forward` (edge stability across time windows), `binance_monte_carlo` (bootstrap resampling of the trade sequence), `binance_param_sweep` (grid search over parameters, ranked by expectancy), `binance_paper_trade` (simulated positions marked-to-market against live prices — no real exchange, no keys).
Project: `run_tests`, `run_lint`, `run_format`, `run_build`, `rubocop`, `rspec`, `shell` (Docker-sandboxed).
Code intelligence (LSP-backed): `get_definition`, `find_references`, `rename_symbol`, `workspace_symbols`, `document_symbols`, `hover`, `diagnostics`, `code_actions`, `format_document`, `signature_help`, `completion`, `semantic_tokens`.
Rails semantic: `find_model`, `find_route`, `find_controller`, `find_service`, `find_spec`, `find_association`, `find_callback`, `rails_context`, and more.
Documentation: `search_docs` (workspace-scoped full-text search over ingested DevDocs sources), `get_doc` (fetch one section by source+path), `list_doc_sources` (ingested sources + workspace defaults).
Plus anything registered via MCP servers (`agent.registerMcpServer(command, args)`).

## Installation & CLI Usage

### Global CLI

Install globally via npm:

```bash
npm install -g @nemesis-oss/nexum

# Launch the terminal UI
nexum

# Explicitly migrate a legacy DevAgent workspace (also happens automatically)
nexum migrate
```

The old command names keep working during the transition:

```bash
devagent       # alias of nexum (deprecated)
devagent-ts    # alias of nexum (deprecated)
```

### Programmatic Usage

```typescript
import { Provider } from "@nemesis-oss/nexum/provider";
import { ModelCatalog } from "@nemesis-oss/nexum/catalog";
import { Router } from "@nemesis-oss/nexum/router";

const local = new Provider({ tier: "local", model: "qwen3.5:4b" });
const cloud = new Provider({ tier: "cloud", model: "qwen3.5:4b", apiKey: process.env.OLLAMA_API_KEY });

const catalog = new ModelCatalog(local, cloud);
await catalog.refresh(); // discovers installed models on both tiers

const router = new Router({ local, cloud, catalog });
const response = await router.route("reasoning", [{ role: "user", content: "..." }]);
```

Or use the `Agent` class directly — it wires provider/catalog/router, tools, LSP, Rails index, memory, learning, and checkpointing together:

```typescript
import { Agent } from "@nemesis-oss/nexum/agent";

const agent = new Agent({ config: { workspaceRoot: "/path/to/project" } });
const reply = await agent.runUserMessage("Add a null check to the parser");
```

## Requirements

- Node.js >= 22
- An Ollama server running locally, or `OLLAMA_API_KEY` set for cloud tier
- Docker (for the sandboxed `shell` tool and the `docker` tool)
- `gh` CLI on PATH (for the `github` tool)
- Language servers on PATH for any LSP-backed tools you want (`typescript-language-server`, `ruby-lsp`, `pyright`, `gopls`, `rust-analyzer`, etc.) — missing servers degrade gracefully to a text fallback, not a crash

## Environment Variables

Canonical product variables are `NEXUM_*`. Legacy `DEVAGENT_*` names still work
(deprecated — they warn on stderr) and lose to the canonical name when both are set.

| Variable | Default | Description |
| ---------- | --------- | ------------- |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL (local tier) — provider-convention variable |
| `OLLAMA_API_KEY` | — | Primary API key for cloud tier — first in the key pool |
| `OLLAMA_API_KEYS` | — | Comma-separated extra cloud keys (e.g. separate accounts). On a 429 `Provider` rotates to the next key and retries before giving up — this is for availability across your own accounts, not multi-vendor routing to other providers |
| `NEXUM_MODEL` | `qwen3.5:4b` | Default model tag |
| `NEXUM_TIER` | `local` | `local` or `cloud` |
| `NEXUM_WORKSPACE` | auto-detected | Workspace root override. Auto-detection walks up from `cwd` to the nearest `.git` (matching how most editor/CLI tooling resolves a project root), then falls back to the nearest existing `.nexum/` (or legacy `.devagent/`), then `cwd` itself. All workspace-scoped state (`.nexum/history.json`, `memory.db`, `checkpoint.json`, workspace `config.json`) lives under whatever this resolves to — set it explicitly if you run nexum from outside the project tree |
| `NEXUM_TIMEOUT_MS` | — | Request timeout in milliseconds (cloud tier only — local never times out mid-generation) |
| `NEXUM_SYSTEM_PROMPT` | *(built-in)* | Custom system prompt |
| `NEXUM_SHELL_IMAGE` | `nexum-sandbox:latest` | Docker image for sandbox |
| `NEXUM_SHELL_TIMEOUT_SEC` | `30` | Shell command timeout in seconds |
| `NEXUM_TOOL_SELECTION_MODE` | `hybrid` | `heuristic` \| `llm` \| `hybrid` — how `DynamicToolSelector` prunes exposed tools |
| `NEXUM_MAX_ACTIVE_TOOLS` | — | Cap on tools exposed per turn |
| `NEXUM_MAX_LOGS` / `NEXUM_MAX_CONVERSATION` / `NEXUM_MAX_TOOL_CALLS` / `NEXUM_MAX_NOTIFICATIONS` | 500/500/200/20 | Bounded buffer sizes (`src/runtime/config.ts`) |
| `NEXUM_AUTO_APPROVE` | `false` | Approve every destructive tool call without prompting — see [Configuration files](#configuration-files) |
| `NEXUM_NO_DEPRECATION_WARNINGS` | — | Set to `1` to silence `DEVAGENT_*` deprecation warnings (CI) |

## Configuration files

Settings resolve in this order, each layer overriding the one before:

1. `~/.nexum/config.json` — global defaults (legacy `~/.devagent/config.json` still read)
2. `<workspace>/.nexum/config.json` — per-project overrides (legacy `.devagent/config.json` still read)
3. environment variables (also read from `~/.nexum/.env`, `./.env`, `<workspace>/.env`)

Every `NEXUM_*` variable above has a config-file equivalent using the camelCase
key name (`NEXUM_MODEL` → `model`, `NEXUM_AUTO_APPROVE` → `autoApprove`, ...).
Boolean env values accept `true`/`1` and `false`/`0`, and win over the file in both
directions.

```jsonc
// ~/.nexum/config.json
{
  "model": "qwen3.5:4b",
  "tier": "local",
  "quickModel": "minicpm5-1b",
  "toolSelectionMode": "hybrid",
  "maxActiveTools": 8,
  "autoApprove": false,
  "mcpServers": [{ "name": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }]
}
```

### Approval gate

Destructive tool calls (`delete_file`, and `run_shell` commands matching `rm -rf`,
`git push --force`, `DROP TABLE`, `mkfs`, fork bombs) pause for a yes/no prompt in
the TUI. Three ways to answer them:

| Mode | How |
| --- | --- |
| Interactive (default) | The TUI's approval overlay. |
| Programmatic | Register a handler: `agent.on("onApprovalRequested", (r) => agent.resolveApproval(r.id, true))` |
| Auto-approve | `"autoApprove": true` in a config file, or `NEXUM_AUTO_APPROVE=true` |

With no handler registered and `autoApprove` off, destructive calls are **denied**
rather than left hanging — relevant when embedding `Agent` as a library.

**Auto-approve removes the only confirmation on irreversible actions.** `run_shell`
still executes inside the Docker sandbox rooted at the workspace, but `delete_file`
does not — it deletes real files with no prompt and no undo. Use it in CI, benchmark
runs, and throwaway containers; prefer the workspace-level `.nexum/config.json`
over `~/.nexum/config.json` so it can't follow you into another project.

## Migration from DevAgent TS

Nexum 2.0 renames the product; nothing of yours is lost:

- **Workspace state** — `.devagent/` (memory, checkpoints, sessions, docs index,
  config, skills) is migrated to `.nexum/` automatically on first run. The copy is
  atomic, idempotent, and never deletes the original. Run `nexum migrate` for an
  explicit report.
- **Environment variables** — `DEVAGENT_*` still works and warns; `NEXUM_*` is
  canonical and wins.
- **CLI** — `devagent` / `devagent-ts` remain as aliases of `nexum` for one major
  version.
- **Package** — `@nemesis-oss/devagent-ts` 1.x is superseded by
  `@nemesis-oss/nexum` 2.0 (the old package gets a final deprecation release).

Full contract: [docs/REBRANDING.md](docs/REBRANDING.md).

## Development

```bash
npm install
npm test          # jest — full suite
npm run build     # TypeScript → dist/
npm run benchmark # score installed models on JSON validity + tool-calling
npm run migrate   # explicit DevAgent → Nexum workspace migration
```

## Documentation Index

Ingest one or more [DevDocs](https://devdocs.io) sources (MPL-2.0 — generated docs retain DevDocs attribution) into the local FTS5 index at `.nexum/docs.db`:

```bash
npm run docs:ingest -- node typescript react rails
```

Re-running for the same id atomically replaces its sections (safe to re-run to pick up upstream updates — DevDocs rebuilds monthly). See `src/docs/catalog.ts` for the full list of supported ids. Ingestion is a one-off/periodic step — the `search_docs`/`get_doc` tools never hit the network at inference time, only the local index.

## Docker Sandbox

```bash
docker build -t nexum-sandbox:latest docker/nexum-sandbox/
```
