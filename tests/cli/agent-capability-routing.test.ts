import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../../src/cli/agent.js";

// Same NDJSON-streaming-reader shape Agent.runUserMessage's `{ stream: true }`
// chat calls need (see tests/cli/agent-events.test.ts for the original pattern) —
// duplicated here rather than shared, matching this test suite's existing convention
// of each file owning its own minimal fetch mock.
function chatResponse(content: string) {
  const encoder = new TextEncoder();
  const line = JSON.stringify({ message: { role: "assistant", content }, done: true }) + "\n";
  let delivered = false;
  const reader = {
    read: async () => {
      if (delivered) return { done: true, value: undefined };
      delivered = true;
      return { done: false, value: encoder.encode(line) };
    },
  };
  return {
    ok: true,
    status: 200,
    json: async () => ({ message: { role: "assistant", content }, done: true }),
    body: { getReader: () => reader },
  };
}

function modelsListResponse(models: Array<Record<string, unknown>>) {
  return { ok: true, status: 200, json: async () => ({ models }) };
}

describe("Agent capability routing — 'quick' delegation and fallback", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("falls back to the primary provider without breaking the turn when 'quick' has no candidate anywhere (local unreachable, no cloud key)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));

    // Every fetch (catalog refresh's availableModels call, and the turn's chat
    // call) resolves with a chat-shaped response — availableModels' parser reads
    // a `.models` array that isn't there, so the catalog legitimately ends up with
    // zero local candidates, exactly as if a local "quick" model weren't installed.
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => chatResponse("done via fallback"));

    const agent = new Agent({ config: { workspaceRoot: dir, tier: "local", model: "test-model" } });

    // priority "low" is one of classifyCapability's existing non-critical triggers.
    const reply = await agent.runUserMessage("please cleanup this file", "low");

    expect(reply).toBe("done via fallback");
  });

  it("classifies a plain lookup question as 'quick' and delegates to a matching local candidate when one exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      // First fetch is the catalog refresh's availableModels(); everything after
      // is the turn's actual chat call(s).
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      return chatResponse("found it");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model" },
      events: { onStatus },
    });

    const reply = await agent.runUserMessage("where is the User model defined?");

    expect(reply).toBe("found it");
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("delegating task to local/minicpm5-1b"));
  });

  it("does not classify a code-writing request as 'quick' even though it mentions a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => chatResponse("implemented"));

    const onStatus = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model" },
      events: { onStatus },
    });

    await agent.runUserMessage("implement JWT authentication in AuthController");

    expect(onStatus).not.toHaveBeenCalledWith(expect.stringContaining("delegating task to"));
  });
});
