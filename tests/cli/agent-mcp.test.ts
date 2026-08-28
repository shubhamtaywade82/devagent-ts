import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../../src/cli/agent.js";

describe("Agent.connectConfiguredMcpServers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-mcp-test-"));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ models: [] }) });
  });

  it("returns an empty list when no servers are configured", async () => {
    const agent = new Agent({ config: { workspaceRoot: tempDir, tier: "local", model: "m" } });
    await expect(agent.connectConfiguredMcpServers()).resolves.toEqual([]);
  });

  it("reports a server as disconnected rather than throwing when it fails to start", async () => {
    const agent = new Agent({
      config: {
        workspaceRoot: tempDir,
        tier: "local",
        model: "m",
        mcpServers: [{ name: "bogus", command: "this-command-does-not-exist-xyz" }],
      },
    });
    const servers = await agent.connectConfiguredMcpServers();
    expect(servers).toEqual([
      { name: "bogus", connected: false, latencyMs: expect.any(Number), tools: [], errors: 1 },
    ]);
  });
});
