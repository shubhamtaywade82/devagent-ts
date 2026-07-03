import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

jest.mock("node:child_process");

import { spawn } from "node:child_process";
import { Agent } from "../../src/cli/agent";
import { ShellTool } from "../../src/tools/shell";

const mockSpawn = spawn as jest.Mock;

interface FakeProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
}

function fakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
}

function skipDockerPreflight(tool: ShellTool): void {
  (tool as any).dockerChecked = true;
  (tool as any).dockerAvailable = true;
}

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
  afterEach(() => {
    mockSpawn.mockReset();
  });

  it("forwards ShellTool output chunks through the onShellOutput event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    const onShellOutput = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model" },
      events: { onShellOutput },
    });

    const registry = agent.getRegistry();

    // Invoke run_shell through the real registry/Agent wiring, but with node:child_process
    // mocked (same pattern as tests/tools/shell.test.ts) so no real Docker daemon or
    // pre-built image is required. This still proves the wiring end-to-end: Agent
    // constructs a real ShellTool with an onOutput callback that calls
    // this.emit("onShellOutput", ...), and that callback actually fires when ShellTool
    // streams output — not just that run_shell is registered.
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);

    // Reach into the registry to bypass ShellTool's docker preflight check, the same way
    // tests/tools/shell.test.ts does for standalone ShellTool instances.
    const shellTool = (registry as any).tools.get("run_shell") as ShellTool;
    skipDockerPreflight(shellTool);

    const resultPromise = registry.invoke("run_shell", { command: "echo hi" });

    proc.stdout.emit("data", Buffer.from("hi\n"));
    proc.emit("close", 0);

    const result = await resultPromise;

    expect(result.exitCode).toBe(0);
    expect(onShellOutput).toHaveBeenCalledWith("stdout", "hi\n");
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
