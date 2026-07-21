import { MemoryStore } from "./store.js";
import { ChatMessage, ChatOptions, ChatResponse } from "../provider/provider.js";

const SUMMARY_PROMPT =
  "Summarize the conversation so far in 3-5 short bullet points, focused on what was built or changed. Output only the bullet points, no preamble.";

/** Duck-typed rather than the concrete Provider class: the caller (agent.ts)
 * routes this through the cheap "quick" capability instead of the primary
 * model, so background summarization never contends with the live turn's
 * own request on the same connection/endpoint. A real Provider satisfies
 * this too, for callers that don't need routing. */
export interface Chattable {
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
}

export async function generateSummary(store: MemoryStore, provider: Chattable): Promise<string> {
  const recent = store.recentMessages(20);
  const messages: ChatMessage[] = [
    ...recent.map((m) => ({ role: m.role as ChatMessage["role"], content: m.content })),
    { role: "user", content: SUMMARY_PROMPT },
  ];

  const response = await provider.chat(messages, { stream: false });
  const summary = (response.message?.content ?? "").trim();
  store.setProjectNote("summary", summary);
  return summary;
}
