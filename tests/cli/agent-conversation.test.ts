import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentConversation } from "../../src/cli/agent-conversation";
import { Agent } from "../../src/cli/agent";

describe("AgentConversation context pruning", () => {
  it("correctly prunes context once maxMessages limit is exceeded", () => {
    const convo = new AgentConversation();
    convo.init({ model: "test", workspaceRoot: ".", tier: "local" }, [], []);

    // Push 30 messages
    for (let i = 0; i < 30; i++) {
      convo.pushUserMessage(`Message ${i}`);
    }

    expect(convo.getMessages().length).toBe(31); // 1 system prompt + 30 user messages

    convo.pruneContext(25);

    const messages = convo.getMessages();
    expect(messages.length).toBe(12); // 1 system + 1 bypass notice + 10 recent
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("system");
    expect(messages[1].content).toContain("Bypassed 20 intermediate turns");
    expect(messages[2].content).toBe("Message 20");
    expect(messages[11].content).toBe("Message 29");
  });
});

describe("Agent non-critical task model delegation", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-test-"));
    const encoder = new TextEncoder();
    (globalThis as any).fetch = jest.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tags") || urlStr.includes("/v1/models")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [
              { name: "hermes3:latest" },
              { name: "opencode:latest" }
            ]
          })
        };
      }

      const line = JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true }) + "\n";
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
        json: async () => ({ message: { role: "assistant", content: "ok" }, done: true }),
        body: { getReader: () => reader },
      };
    });
  });

  it("delegates low priority text/doc tasks to hermes", async () => {
    const agent = new Agent({
      config: { workspaceRoot: tempDir, tier: "local", model: "original-model" },
    });

    expect(agent.currentModel).toBe("original-model");

    await agent.runUserMessage("Write a README file", "low");

    expect(agent.currentModel).toBe("original-model");
    // Verify it was switched to hermes during execution by checking the mock fetch history
    const calls = (globalThis.fetch as jest.Mock).mock.calls;
    const postCall = calls.find((c) => c[1] && c[1].body);
    expect(postCall).toBeDefined();
    const firstCallBody = JSON.parse(postCall![1].body);
    expect(firstCallBody.model).toBe("hermes3:latest");
  });

  it("delegates low priority code/test tasks to opencode", async () => {
    const encoder = new TextEncoder();
    (globalThis as any).fetch = jest.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tags") || urlStr.includes("/v1/models")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [
              { name: "opencode:latest" },
              { name: "hermes3:latest" }
            ]
          })
        };
      }

      const line = JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true }) + "\n";
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
        json: async () => ({ message: { role: "assistant", content: "ok" }, done: true }),
        body: { getReader: () => reader },
      };
    });

    const agent = new Agent({
      config: { workspaceRoot: tempDir, tier: "local", model: "original-model" },
    });

    expect(agent.currentModel).toBe("original-model");

    await agent.runUserMessage("Run unit tests", "medium");

    expect(agent.currentModel).toBe("original-model");
    const calls = (globalThis.fetch as jest.Mock).mock.calls;
    const postCall = calls.find((c) => c[1] && c[1].body);
    expect(postCall).toBeDefined();
    const firstCallBody = JSON.parse(postCall![1].body);
    expect(firstCallBody.model).toBe("opencode:latest");
  });
});
