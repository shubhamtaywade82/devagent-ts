# Configuration & Diagnostics

DevAgent-TS supports hierarchical configuration through environment variables, workspace `.devagent/config.json`, and global `~/.devagent/config.json`.

---

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DEVAGENT_MODEL` | Default Ollama model | `qwen2.5-coder:14b` |
| `DEVAGENT_HOST` | Ollama host endpoint | `http://localhost:11434` |
| `DEVAGENT_TIER` | Execution tier (`local` or `cloud`) | `local` |
| `OLLAMA_API_KEY` | Ollama Cloud API Key | `undefined` |
| `OLLAMA_API_KEYS` | Comma-separated API Key rotation pool | `undefined` |
| `DEVAGENT_SHELL_IMAGE` | Sandbox Docker image | `devagent-sandbox:latest` |
| `DEVAGENT_TIMEOUT_MS` | LLM turn timeout in milliseconds | `120000` |
| `DEVAGENT_TOOL_SELECTION_MODE` | Dynamic tool pruning mode (`heuristic`, `hybrid`, `all`) | `hybrid` |

---

## Workspace Configuration (`.devagent/config.json`)

Created automatically in your project root via `/init`:

```json
{
  "model": "qwen2.5-coder:32b",
  "tier": "local",
  "host": "http://localhost:11434",
  "skills": ["refactoring", "clean-code"],
  "mcpServers": [
    {
      "name": "sqlite",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "app.db"]
    }
  ]
}
```

---

## System Health Diagnostics (`/doctor`)

Run `/doctor` in the TUI or `npm run doctor` from the terminal to verify:

1. Local Ollama host connectivity and installed models.
2. Ollama Cloud API key pool availability.
3. Docker daemon connectivity and sandbox image status.
4. Installed Language Servers for your workspace languages.
5. Workspace root resolution and `.git` boundaries.
