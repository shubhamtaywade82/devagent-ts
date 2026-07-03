import { wireAgentBridge, BridgeableAgent } from "../../src/tui/agent-bridge";
import { TuiAction } from "../../src/tui/state";

function fakeAgent() {
  const handlers = new Map<string, ((...args: any[]) => void)[]>();
  const agent: BridgeableAgent = {
    on: (event, handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return agent;
    },
  };
  return {
    agent,
    fire: (event: string, ...args: any[]) => {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
  };
}

describe("wireAgentBridge", () => {
  it("dispatches ASSISTANT_TEXT_CHUNK on onAssistantText", () => {
    const { agent, fire } = fakeAgent();
    const dispatched: TuiAction[] = [];
    wireAgentBridge(agent, (a) => dispatched.push(a));

    fire("onAssistantText", "hi");

    expect(dispatched).toEqual([{ type: "ASSISTANT_TEXT_CHUNK", chunk: "hi" }]);
  });

  it("dispatches TOOL_CALLED and TOOL_RESULT", () => {
    const { agent, fire } = fakeAgent();
    const dispatched: TuiAction[] = [];
    wireAgentBridge(agent, (a) => dispatched.push(a));

    fire("onToolCall", "read_file", { path: "a.ts" });
    fire("onToolResult", "read_file", { content: "x" });

    expect(dispatched).toEqual([
      { type: "TOOL_CALLED", name: "read_file", args: { path: "a.ts" } },
      { type: "TOOL_RESULT", name: "read_file", result: { content: "x" } },
    ]);
  });

  it("dispatches SHELL_OUTPUT_CHUNK on onShellOutput", () => {
    const { agent, fire } = fakeAgent();
    const dispatched: TuiAction[] = [];
    wireAgentBridge(agent, (a) => dispatched.push(a));

    fire("onShellOutput", "stdout", "line\n");

    expect(dispatched).toEqual([{ type: "SHELL_OUTPUT_CHUNK", stream: "stdout", chunk: "line\n" }]);
  });

  it("dispatches ERROR with the error's message on onError", () => {
    const { agent, fire } = fakeAgent();
    const dispatched: TuiAction[] = [];
    wireAgentBridge(agent, (a) => dispatched.push(a));

    fire("onError", new Error("boom"));

    expect(dispatched).toEqual([{ type: "ERROR", message: "boom" }]);
  });

  it("dispatches STATUS_CHANGED and THINKING_CHUNK", () => {
    const { agent, fire } = fakeAgent();
    const dispatched: TuiAction[] = [];
    wireAgentBridge(agent, (a) => dispatched.push(a));

    fire("onStatus", "turn 1");
    fire("onThinking", "pondering");

    expect(dispatched).toEqual([
      { type: "STATUS_CHANGED", status: "turn 1" },
      { type: "THINKING_CHUNK", chunk: "pondering" },
    ]);
  });
});
