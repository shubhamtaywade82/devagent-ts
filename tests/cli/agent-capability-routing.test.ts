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

function toolCallResponse(name: string, args: Record<string, unknown>) {
  const encoder = new TextEncoder();
  const message = { role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] };
  const line = JSON.stringify({ message, done: true }) + "\n";
  let delivered = false;
  const reader = {
    read: async () => {
      if (delivered) return { done: true, value: undefined };
      delivered = true;
      return { done: false, value: encoder.encode(line) };
    },
  };
  return { ok: true, status: 200, json: async () => ({ message, done: true }), body: { getReader: () => reader } };
}

function modelsListResponse(models: Array<Record<string, unknown>>) {
  return { ok: true, status: 200, json: async () => ({ models }) };
}

// All fetch calls whose body is a chat request (catalog-refresh calls have no body).
function chatBodies(): Array<{ model: string; messages: Array<Record<string, unknown>>; tools?: unknown[] }> {
  const calls = (globalThis.fetch as jest.Mock).mock.calls;
  return calls.filter((c) => c[1] && c[1].body).map((c) => JSON.parse(c[1].body));
}

describe("Agent capability routing — quick-first with self-escalation", () => {
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

    const reply = await agent.runUserMessage("please cleanup this file");

    expect(reply).toBe("done via fallback");
  });

  it("delegates a plain lookup question to the local quick model", async () => {
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

  it("attempts the local quick model first even for a code-writing request (no pre-filter gate anymore)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      return chatResponse("implemented");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model" },
      events: { onStatus },
    });

    await agent.runUserMessage("implement JWT authentication in AuthController");

    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("delegating task to local/minicpm5-1b"));
    expect(chatBodies()[0].model).toBe("minicpm5-1b");
  });

  it("attempts the local quick model first even at 'high' priority (priority no longer gates routing)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      return chatResponse("done");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model" },
      events: { onStatus },
    });

    await agent.runUserMessage("summarize the current state of the release", "high");

    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("delegating task to local/minicpm5-1b"));
  });

  it("keeps routing plain conversational turns to quick by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      return chatResponse("dependency injection is...");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model" },
      events: { onStatus },
    });

    await agent.runUserMessage("what is dependency injection?");

    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("delegating task to local/minicpm5-1b"));
  });

  it("escalates to the primary model when the quick model calls escalate_task, preserving full conversation history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      if (call === 2) return toolCallResponse("escalate_task", { reason: "needs a real multi-file refactor" });
      return chatResponse("done by primary");
    });

    const onStatus = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "primary-model" },
      events: { onStatus },
    });

    const reply = await agent.runUserMessage("implement a complex multi-file refactor");

    expect(reply).toBe("done by primary");
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("escalating to the primary model"));

    const bodies = chatBodies();
    expect(bodies[0].model).toBe("minicpm5-1b");
    expect(bodies[1].model).toBe("primary-model");

    // Context preservation: the escalated call sees the original ask, plus
    // minicpm5's escalate_task call and its result — same shared history, nothing reset.
    const turn1Messages = bodies[1].messages;
    expect(turn1Messages.some((m) => m.role === "user" && String(m.content).includes("complex multi-file refactor"))).toBe(true);
    expect(
      turn1Messages.some(
        (m) => m.role === "assistant" && JSON.stringify((m as any).tool_calls ?? "").includes("escalate_task"),
      ),
    ).toBe(true);
    expect(turn1Messages.some((m) => m.role === "tool" && String(m.content).includes("needs a real multi-file refactor"))).toBe(true);
  });

  it("auto-escalates when a tool call errors and the quick model answers instead of retrying or calling escalate_task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      // Turn 0: calls read_file on a path that doesn't exist — a real tool error.
      if (call === 2) return toolCallResponse("read_file", { path: "does/not/exist.txt" });
      // Turn 1: instead of retrying or calling escalate_task, invents an unrelated
      // "fix" as plain content — the exact failure mode observed in practice.
      if (call === 3) return chatResponse("touch /todo_comments");
      return chatResponse("a real answer from the primary model");
    });

    const onStatus = jest.fn();
    const onAssistantText = jest.fn();
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "primary-model" },
      events: { onStatus, onAssistantText },
    });

    const reply = await agent.runUserMessage("do something that will fail");

    expect(reply).toBe("a real answer from the primary model");
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("previous tool call failed"));
    // The discarded "touch /todo_comments" guess must never reach the UI.
    expect(onAssistantText).not.toHaveBeenCalledWith(expect.stringContaining("touch"));

    const bodies = chatBodies();
    expect(bodies[0].model).toBe("minicpm5-1b"); // turn 0: quick, tool errors
    expect(bodies[1].model).toBe("minicpm5-1b"); // turn 1: still quick, buffered/discarded
    expect(bodies[2].model).toBe("primary-model"); // immediate re-run on primary
  });

  it("stays escalated for the rest of the call, but resets to quick on the next runUserMessage call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      if (call === 2) return toolCallResponse("escalate_task", { reason: "too complex" });
      if (call === 3) return toolCallResponse("escalate_task", { reason: "still going" }); // still on primary, not quick
      // Every other call — including the task-completion turn and the
      // post-completion summarization call every "answered" turn triggers —
      // returns plain content.
      return chatResponse("done");
    });

    const agent = new Agent({ config: { workspaceRoot: dir, tier: "local", model: "primary-model" } });

    await agent.runUserMessage("a hard task");
    const bodiesAfterFirst = chatBodies();
    expect(bodiesAfterFirst[0].model).toBe("minicpm5-1b"); // turn 0: quick
    expect(bodiesAfterFirst[1].model).toBe("primary-model"); // turn 1: escalated, stays there
    expect(bodiesAfterFirst[2].model).toBe("primary-model"); // turn 2: still escalated, task completes
    // Index 3 is the post-completion summarization call (always primary) —
    // the next real task turn lands at index 4.
    expect(bodiesAfterFirst).toHaveLength(4);

    await agent.runUserMessage("a fresh, unrelated task");
    const bodiesAfterSecond = chatBodies();
    expect(bodiesAfterSecond[4].model).toBe("minicpm5-1b"); // new call starts back on quick
  });

  it("routes escalation to the installed vision model when the original message hinted at vision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
          { name: "qwen-vl:8b", capabilities: ["vision", "completion", "tools"], details: { parameter_size: "8B" } },
        ]);
      }
      if (call === 2) return toolCallResponse("escalate_task", { reason: "need to actually see the image" });
      return chatResponse("described the screenshot");
    });

    const agent = new Agent({ config: { workspaceRoot: dir, tier: "local", model: "primary-model" } });

    await agent.runUserMessage("Look at this screenshot and tell me what's wrong with the layout");

    const bodies = chatBodies();
    expect(bodies[0].model).toBe("minicpm5-1b");
    expect(bodies[1].model).toBe("qwen-vl:8b");
  });

  it("routes escalation to the installed reasoning model when the original message hinted at reasoning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
          { name: "deepseek-r1:8b", capabilities: ["thinking", "completion", "tools"], details: { parameter_size: "8B" } },
        ]);
      }
      if (call === 2) return toolCallResponse("escalate_task", { reason: "needs deep architectural reasoning" });
      return chatResponse("here are the trade-offs");
    });

    const agent = new Agent({ config: { workspaceRoot: dir, tier: "local", model: "primary-model" } });

    await agent.runUserMessage("What are the trade-offs of this architecture before we commit to it?");

    const bodies = chatBodies();
    expect(bodies[0].model).toBe("minicpm5-1b");
    expect(bodies[1].model).toBe("deepseek-r1:8b");
  });

  it("force-includes escalate_task in the tool schemas sent to the quick model even under a tight maxActiveTools cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    let call = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return modelsListResponse([
          { name: "minicpm5-1b", capabilities: ["completion", "tools"], details: { parameter_size: "1B" } },
        ]);
      }
      return chatResponse("ok");
    });

    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model", maxActiveTools: 1 },
    });

    await agent.runUserMessage("read the config file");

    const tools = (chatBodies()[0].tools ?? []) as Array<{ function: { name: string } }>;
    expect(tools.some((t) => t.function.name === "escalate_task")).toBe(true);
  });
});
