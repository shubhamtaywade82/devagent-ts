# Model Context Protocol (MCP)

Nexum supports connecting to external MCP servers to extend its capabilities.

---

## Configuration

Add MCP servers to `.nexum/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "sqlite",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "database.sqlite"]
    },
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  ]
}
```

---

## Tool Dynamic Registration

All MCP tools are dynamically converted to native JSON schemas and registered with the agent's tool registry.
