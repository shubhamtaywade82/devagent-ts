/**
 * Bridges the Agent's callback events onto the runtime event bus. This is
 * the only place agent callbacks are translated; everything downstream is
 * bus -> store -> renderer.
 */

import { EventBus } from "../runtime/events";

export interface BridgeableAgent {
  on<E extends string>(event: E, handler: (...args: any[]) => void): unknown;
}

export function wireAgentBridge(agent: BridgeableAgent, bus: EventBus): void {
  let toolSeq = 0;
  const openCalls = new Map<string, string[]>(); // tool name -> stack of open call ids

  agent.on("onAssistantText", (chunk: string) => {
    bus.publish({ type: "conversation.chunk", role: "assistant", chunk });
    bus.publish({ type: "model.streaming", streaming: true });
  });
  agent.on("onThinking", (chunk: string) => {
    bus.publish({ type: "conversation.chunk", role: "thinking", chunk });
  });
  agent.on("onToolCall", (name: string, args: Record<string, unknown>) => {
    const id = `tc${++toolSeq}`;
    const stack = openCalls.get(name) ?? [];
    stack.push(id);
    openCalls.set(name, stack);
    bus.publish({ type: "tool.started", id, name, args });
    bus.publish({ type: "logs.appended", level: "info", source: "tool", message: `${name} started` });
  });
  agent.on("onToolResult", (name: string, result: Record<string, unknown> | string) => {
    const stack = openCalls.get(name) ?? [];
    const id = stack.shift();
    if (!id) return;
    const resultObj = typeof result === "string" ? { output: result } : (result ?? {});
    const error = resultObj && typeof resultObj.error === "string" ? resultObj.error : null;
    if (error) {
      bus.publish({ type: "tool.failed", id, error });
      bus.publish({ type: "logs.appended", level: "error", source: "tool", message: `${name} failed: ${error}` });
    } else {
      bus.publish({ type: "tool.completed", id, result: resultObj });
      bus.publish({ type: "logs.appended", level: "info", source: "tool", message: `${name} completed` });
    }
  });
  agent.on("onStatus", (status: string) => {
    bus.publish({ type: "status.changed", status });
  });
  agent.on("onError", (error: Error) => {
    bus.publish({ type: "error", message: error.message });
    bus.publish({ type: "logs.appended", level: "error", source: "agent", message: error.message });
  });
  agent.on("onShellOutput", (stream: "stdout" | "stderr", chunk: string) => {
    bus.publish({
      type: "logs.appended",
      level: stream === "stderr" ? "warn" : "debug",
      source: "shell",
      message: chunk,
    });
  });
  agent.on("onMemorySummary", (summary: string) => {
    bus.publish({ type: "memory.updated", summary });
  });
}
