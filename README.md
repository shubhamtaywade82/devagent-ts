# DevAgent TS

A TypeScript developer agent framework built on Ollama (local + cloud), with Docker-sandboxed tool execution and a plan-retry-replan orchestrator.

## Architecture

```
src/
├── tools/          Tool base class, filesystem (read/write), Docker-sandboxed shell, registry
├── orchestrator/   Plan steps, loop detector, dependency-aware step runner
└── provider/       Ollama REST client (local + cloud), tier router with rate-limit fallback
```

## Key Features

- **Dual provider tier** — local Ollama (`localhost:11434`) and cloud (`ollama.com`) via identical `/api/chat` interface; cloud 429s/network failures fall back to local
- **Docker-sandboxed shell** — `--network=none`, `--pids-limit=128`, memory/CPU capped; buffer-overflow SIGKILL, hard timeout with kill escalation
- **Path-contained filesystem tools** — every path resolved and checked against workspace root before I/O; atomic writes via temp+rename
- **Orchestrator** — topological dependency ordering, retry-vs-replan routing, failure cascade, reverse-chronological rollback
- **Loop detection** — flags repeated (tool, args, error) signatures to prevent infinite retry cycles

## Usage

```typescript
import { Provider } from "./src/provider/provider";
import { Router } from "./src/provider/router";
import { Registry } from "./src/tools/registry";
import { ReadFileTool, WriteFileTool } from "./src/tools/filesystem";
import { ShellTool } from "./src/tools/shell";

const local = new Provider({ tier: "local", model: "qwen3.5" });
const cloud = new Provider({ tier: "cloud", model: "kimi-k2.5:cloud" });
const router = new Router({ fastLocal: local, deepCloud: cloud });

const registry = new Registry()
  .register(new ReadFileTool("/workspace"))
  .register(new WriteFileTool("/workspace"))
  .register(new ShellTool({ workspaceRoot: "/workspace" }));
```

## Requirements

- Node.js >= 20
- Docker (for sandboxed shell execution)
- Ollama running locally, or `OLLAMA_API_KEY` set for cloud tier

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL (local tier) |
| `OLLAMA_API_KEY` | — | API key for cloud tier |
| `DEVAGENT_MODEL` | `qwen3.5:4b` | Default model tag |
| `DEVAGENT_WORKSPACE` | `process.cwd()` | Workspace root directory |
| `DEVAGENT_TIMEOUT_MS` | `60000` | Request timeout in milliseconds |
| `DEVAGENT_SYSTEM_PROMPT` | *(built-in)* | Custom system prompt |
| `DEVAGENT_SHELL_IMAGE` | `devagent-sandbox:latest` | Docker image for sandbox |
| `DEVAGENT_SHELL_TIMEOUT_SEC` | `30` | Shell command timeout in seconds |

## Development

```bash
npm install
npm test          # 25 tests across 5 suites
npm run build     # TypeScript → dist/
```

## Docker Sandbox

```bash
docker build -t devagent-sandbox:latest docker/devagent-sandbox/
```
