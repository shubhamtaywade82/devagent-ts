/**
 * The runtime event bus. Every actor publishes events here; the state
 * store is the primary subscriber. Rendering never subscribes directly —
 * it reads the store.
 */

import {
  ApprovalRequest,
  ChatRole,
  ExecutionStep,
  GitState,
  LogLevel,
  McpServerState,
  MemoryItem,
  RuntimeMode,
  SkillState,
  Task,
} from "./types";

export type RuntimeEvent =
  | { type: "conversation.message"; role: ChatRole; text: string }
  | { type: "conversation.chunk"; role: "assistant" | "thinking"; chunk: string }
  | { type: "conversation.clear" }
  | { type: "task.created"; task: Task }
  | { type: "task.progress"; taskId: string; status: Task["status"]; progress?: number }
  | { type: "tool.started"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool.completed"; id: string; result: Record<string, unknown> }
  | { type: "tool.failed"; id: string; error: string }
  | { type: "model.streaming"; streaming: boolean; tokensPerSecond?: number }
  | { type: "model.changed"; provider?: string; name: string }
  | { type: "context.changed"; used: number; limit: number }
  | { type: "git.changed"; git: GitState }
  | { type: "logs.appended"; level: LogLevel; source: string; message: string }
  | { type: "memory.updated"; items?: MemoryItem[]; summary?: string }
  | { type: "mcp.changed"; servers: McpServerState[] }
  | { type: "skills.changed"; skills: SkillState[] }
  | { type: "approval.requested"; request: ApprovalRequest }
  | { type: "approval.resolved"; id: string; approved: boolean }
  | { type: "execution.goal"; goal: string; steps: ExecutionStep[] }
  | { type: "execution.step"; step: ExecutionStep }
  | { type: "execution.queue"; queue: string[]; etaSeconds?: number }
  | { type: "execution.reasoning"; text: string }
  | { type: "mode.changed"; mode: RuntimeMode }
  | { type: "status.changed"; status: string }
  | { type: "notification"; text: string; kind: "info" | "success" | "warning" | "error" }
  | { type: "error"; message: string };

export type EventListener = (event: RuntimeEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  publish(event: RuntimeEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
