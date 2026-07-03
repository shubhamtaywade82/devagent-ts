export class RateLimitError extends Error {}
export class ProviderError extends Error {}

export type Tier = "local" | "cloud";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface OllamaToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResponse {
  message: { role: string; content: string; tool_calls?: unknown[] };
  done: boolean;
  [key: string]: unknown;
}

export interface ChatOptions {
  tools?: OllamaToolSchema[];
  stream?: boolean;
  onChunk?: (chunk: ChatResponse) => void;
}

export interface ProviderOptions {
  tier: Tier;
  model: string;
  host?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class Provider {
  private readonly tier: Tier;
  private model: string;
  private readonly host: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(opts: ProviderOptions) {
    this.tier = opts.tier;
    this.model = opts.model;
    this.host =
      opts.host ??
      (opts.tier === "cloud" ? "https://ollama.com" : process.env.OLLAMA_HOST ?? "http://localhost:11434");
    this.apiKey = opts.apiKey ?? process.env.OLLAMA_API_KEY;
    this.timeoutMs = opts.timeoutMs ?? (opts.tier === "cloud" ? 60_000 : 30_000);
  }

  get currentModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const body: Record<string, unknown> = { model: this.model, messages, stream: opts.stream ?? false };
    if (opts.tools) body.tools = opts.tools;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.tier === "cloud") headers.Authorization = `Bearer ${this.apiKey}`;

    const resp = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (resp.status === 429) {
      throw new RateLimitError(`${this.model} (${this.tier}) rate limited`);
    }
    if (!resp.ok) {
      throw new ProviderError(`Ollama ${this.tier} ${resp.status}: ${await resp.text()}`);
    }

    return opts.stream ? this.streamChunks(resp, opts.onChunk) : ((await resp.json()) as ChatResponse);
  }

  async availableModels(): Promise<unknown> {
    const path = this.tier === "cloud" ? "/v1/models" : "/api/tags";
    const headers: Record<string, string> = {};
    if (this.tier === "cloud") headers.Authorization = `Bearer ${this.apiKey}`;

    const resp = await fetch(`${this.host}${path}`, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!resp.ok) throw new ProviderError(`Ollama ${this.tier} ${resp.status}: ${await resp.text()}`);
    return resp.json();
  }

  private async streamChunks(resp: Response, onChunk?: (chunk: ChatResponse) => void): Promise<ChatResponse> {
    if (!resp.body) throw new ProviderError("empty stream body");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final: ChatResponse | null = null;
    let accumulatedContent = "";
    let accumulatedThinking = "";
    const accumulatedToolCalls: any[] = [];

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;

        const chunk = JSON.parse(line) as ChatResponse;
        onChunk?.(chunk);

        if (chunk.message) {
          if (chunk.message.content) {
            accumulatedContent += chunk.message.content;
          }
          if ((chunk.message as any).thinking) {
            accumulatedThinking += (chunk.message as any).thinking;
          }
          if (chunk.message.tool_calls && Array.isArray(chunk.message.tool_calls)) {
            accumulatedToolCalls.push(...chunk.message.tool_calls);
          }
        }

        if (chunk.done) {
          final = chunk;
        }
      }
    }

    if (!final) throw new ProviderError("stream ended without a done:true chunk");

    // Overwrite the final message with the fully accumulated values
    final.message = {
      role: final.message?.role || "assistant",
      content: accumulatedContent,
    };
    if (accumulatedThinking) {
      (final.message as any).thinking = accumulatedThinking;
    }
    if (accumulatedToolCalls.length > 0) {
      final.message.tool_calls = accumulatedToolCalls;
    }

    return final;
  }
}
