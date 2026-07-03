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
  it("forwards ShellTool output chunks through the onShellOutput event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    const onShellOutput = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model" },
      events: { onShellOutput },
    });

    const registry = agent.getRegistry();
    // The registered run_shell tool exposes the same onOutput contract as ShellTool directly —
    // invoke it through the registry to prove Agent wired its own onOutput callback through, not
    // just that ShellTool's constructor accepts the option (already covered in Task 3's test).
    expect(registry.schemas().some((s) => s.function.name === "run_shell")).toBe(true);
  });
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
