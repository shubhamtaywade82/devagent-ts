import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest } from "@jest/globals";

jest.unstable_mockModule("node:child_process", () => ({ spawn: jest.fn() }));

const { Agent } = await import("../../src/cli/agent.js");

// Mirrors tests/cli/agent-events.test.ts's mockChatSequence: a fresh reader
// per fetch() call (not a shared one across calls), plus Ollama's
// prompt_eval_count/eval_count usage fields that emitUsage/UsageTracker read.
// Branches on the request shape so ensureCatalog's GET /api/tags (no body)
// gets a real model list — making the catalog "usable" and TTL-cached —
// while POST /api/chat (has a body) gets the chat payload; otherwise every
// runUserMessage call would re-trigger a catalog refresh, muddying call counts.
function mockChatWithUsage(content: string, promptTokens: number, completionTokens: number) {
  const chatPayload = {
    message: { role: "assistant", content },
    done: true,
    prompt_eval_count: promptTokens,
    eval_count: completionTokens,
    eval_duration: 1_000_000_000,
  };
  const tagsPayload = { models: [{ name: "test-model", capabilities: ["tools", "completion"] }] };
  const encoder = new TextEncoder();
  (globalThis as any).fetch = jest.fn().mockImplementation(async (_url: string, init?: { body?: unknown }) => {
    const isChat = !!init?.body;
    const payload = isChat ? chatPayload : tagsPayload;
    let delivered = false;
    const reader = {
      read: async () => {
        if (delivered) return { done: true, value: undefined };
        delivered = true;
        return { done: false, value: encoder.encode(JSON.stringify(payload) + "\n") };
      },
      releaseLock: () => {},
    };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      body: { getReader: () => reader },
    };
  });
}

/** Number of POST /api/chat calls actually issued (has a request body) —
 * excludes ensureCatalog's GET /api/tags refreshes. */
function chatCallCount(): number {
  return (globalThis.fetch as jest.Mock).mock.calls.filter((c: any[]) => c[1]?.body).length;
}

describe("Agent budget enforcement", () => {
  it("stops with cost_budget once maxCalls is reached, without issuing another chat call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    mockChatWithUsage("first answer", 100, 50);
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model", budget: { maxCalls: 1 } },
    });

    const first = await agent.runUserMessage("hi");
    expect(first).toBe("first answer");
    // Let fire-and-forget summarization settle before counting chat calls.
    await new Promise((r) => setTimeout(r, 0));
    const chatCallsAfterFirst = chatCallCount();
    expect(chatCallsAfterFirst).toBeGreaterThan(0);

    const second = await agent.runUserMessage("hi again");

    expect(second).toContain("budget exhausted");
    expect(chatCallCount()).toBe(chatCallsAfterFirst);
  });

  it("stops with cost_budget once maxTokens is reached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    mockChatWithUsage("first answer", 800, 300);
    const agent = new Agent({
      config: { workspaceRoot: dir, tier: "local", model: "test-model", budget: { maxTokens: 1000 } },
    });

    await agent.runUserMessage("hi");
    await new Promise((r) => setTimeout(r, 0));

    const second = await agent.runUserMessage("hi again");
    expect(second).toContain("budget exhausted");
  });

  it("does not enforce a budget when none is configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    mockChatWithUsage("answer", 1_000_000, 1_000_000);
    const agent = new Agent({ config: { workspaceRoot: dir, tier: "local", model: "test-model" } });

    await agent.runUserMessage("hi");
    const second = await agent.runUserMessage("hi again");
    expect(second).toBe("answer");
  });

  it("records per-model usage on the agent's usageTracker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    mockChatWithUsage("answer", 123, 45);
    const agent = new Agent({ config: { workspaceRoot: dir, tier: "local", model: "test-model" } });

    await agent.runUserMessage("hi");

    const record = agent.usageTracker.forModel("local", "test-model");
    expect(record).toMatchObject({ promptTokens: 123, completionTokens: 45, calls: 1 });
  });
});
