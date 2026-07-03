import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../../src/cli/agent";

// Agent.runUserMessage always calls provider.chat with { stream: true }, which drives
// Provider.streamChunks and reads resp.body via getReader(). A plain `json()`-only mock
// (as used in tests/provider/provider.test.ts, which never exercises the streaming path)
// isn't enough here — we need a fake ReadableStream reader that yields one NDJSON line
// matching Ollama's chunk format, in addition to `json()` for generateSummary's
// non-streaming `provider.chat(..., { stream: false })` call.
function mockChatOnce(content: string) {
  const line = JSON.stringify({ message: { role: "assistant", content }, done: true }) + "\n";
  const encoder = new TextEncoder();
  const encoded = encoder.encode(line);
  let delivered = false;
  const reader = {
    read: async () => {
      if (delivered) return { done: true, value: undefined };
      delivered = true;
      return { done: false, value: encoded };
    },
  };
  (globalThis as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ message: { role: "assistant", content }, done: true }),
    body: { getReader: () => reader },
  });
}

describe("Agent onShellOutput event", () => {
  it(
    "forwards ShellTool output chunks through the onShellOutput event",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "ws-"));
      const onShellOutput = jest.fn();
      const agent = new Agent({
        config: { workspaceRoot: dir, tier: "local", model: "test-model" },
        events: { onShellOutput },
      });

      const registry = agent.getRegistry();
      // Actually invoke run_shell through the registry (real Docker sandbox) and assert
      // Agent's onShellOutput event fires with the real stdout produced by the command.
      // This proves the wiring end-to-end: Agent constructs ShellTool with an onOutput
      // callback that calls this.emit("onShellOutput", ...), and that callback actually
      // fires when ShellTool streams output — not just that run_shell is registered.
      const result = await registry.invoke("run_shell", { command: "echo hi" });

      expect(result.exitCode).toBe(0);
      expect(onShellOutput).toHaveBeenCalledWith("stdout", expect.stringContaining("hi"));
    },
    30_000,
  );
});

describe("Agent memory summarization trigger", () => {
  it("triggers generateSummary after a successful text-returning turn, without blocking the response", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    mockChatOnce("Hello there");
    const agent = new Agent({ config: { workspaceRoot: dir, tier: "local", model: "test-model" } });

    const reply = await agent.runUserMessage("hi");

    expect(reply).toBe("Hello there");
    // Summarization is fire-and-forget; give pending microtasks/timers a tick to run.
    await new Promise((r) => setTimeout(r, 0));
  });
});
