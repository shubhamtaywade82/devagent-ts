/**
 * AgentConversationContext — bridges the CLI's AgentConversation transcript
 * onto the kernel's ContextManager port, so kernel strategies can read and
 * append messages without knowing the concrete store.
 *
 * Deliberately thin: every mutation routes through the conversation's own
 * methods so pruning, pinned skill messages, and the current-turn user
 * message bookkeeping keep their exact legacy semantics. pushSystem maps to
 * pushSystemMessage (which appends role:"user" — the long-standing legacy
 * quirk synthetic nudges rely on).
 */

import type { ChatMessage } from "../models/adapters/provider.js";
import type { ContextManager } from "../core/types.js";
import type { AgentConversation } from "./agent-conversation.js";

export class AgentConversationContext implements ContextManager {
  constructor(private readonly conversation: AgentConversation) {}

  messages(): readonly ChatMessage[] {
    return this.conversation.getMessages();
  }

  push(message: ChatMessage): void {
    if (message.role === "assistant") {
      this.conversation.pushAssistantMessage(message.content ?? "", message.tool_calls);
      return;
    }
    if (message.role === "tool") {
      this.conversation.pushToolResult(typeof message.content === "string" ? message.content : "");
      return;
    }
    this.conversation.getMessages().push(message);
  }

  pushSystem(text: string): void {
    this.conversation.pushSystemMessage(text);
  }

  pushToolResult(content: string): void {
    this.conversation.pushToolResult(content);
  }

  lastAssistantText(): string | undefined {
    const messages = this.conversation.getMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === "assistant" && message.content) return message.content;
    }
    return undefined;
  }
}
