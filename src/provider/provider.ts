import {
  OllamaClient,
  OllamaAbortError,
  OllamaRateLimitError,
  OllamaTimeoutError,
  OllamaClientError as OllamaSdkError,
  type ChatRequestInput,
  type Message as OllamaMessage,
  type Tool as OllamaTool,
} from "ollama-client-js";

export class RateLimitError extends Error {}
export class ProviderError extends Error {}
export class TimeoutError extends Error {}

const MAX_ERROR_BODY_CHARS = 500;

function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9]{6,}/g, "[REDACTED]")
    .slice(0, MAX_ERROR_BODY_CHARS);
}

export type Tier = "local" | "cloud";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
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

/**
 * Thin adapter over `ollama-client-js`, preserving the exact public contract
 * this class had when it hand-rolled `fetch` calls directly: same methods,
 * same error classes, same secret redaction, same per-tier timeout
 * semantics. Retries are intentionally left at 0 here - `Router` (see
 * router.ts) owns cross-tier fallback policy; retrying within a single tier
 * before Router ever sees the failure would just slow that fallback down.
 */
export class Provider {
  private tier: Tier;
  private model: string;
  private host: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private client: OllamaClient;

  constructor(opts: ProviderOptions) {
    this.tier = opts.tier;
    this.model = opts.model;
    this.host =
      opts.host ??
      (opts.tier === "cloud" ? "https://ollama.com" : process.env.OLLAMA_HOST ?? "http://localhost:11434");
    this.apiKey = opts.apiKey;
    // Cloud has a 60s connect timeout; local has no timeout — never kill a running generation.
    // (ollama-client-js's timeoutMs only bounds time-to-first-byte: the enhanced fetch clears
    // its timer as soon as the response headers arrive, before any streaming body is read.)
    this.timeoutMs = opts.timeoutMs ?? (opts.tier === "cloud" ? 60_000 : 0);
    this.client = this.buildClient();
  }

  private buildClient(): OllamaClient {
    return new OllamaClient({
      baseUrl: this.host,
      apiKey: this.tier === "cloud" ? this.apiKey : undefined,
      timeoutMs: this.timeoutMs > 0 ? this.timeoutMs : undefined,
      retries: 0,
    });
  }

  get currentModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setTier(tier: Tier): void {
    this.tier = tier;
    this.client = this.buildClient();
  }

  setRuntimeHost(host: string): void {
    this.host = host;
    this.client = this.buildClient();
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    if (this.tier === "cloud" && !this.apiKey) {
      throw new ProviderError("missing apiKey for cloud chat");
    }

    const request: ChatRequestInput = {
      model: this.model,
      messages: messages as unknown as OllamaMessage[],
      ...(opts.tools ? { tools: opts.tools as unknown as OllamaTool[] } : {}),
      // For local models: use the model's full native context window and never silently truncate.
      ...(this.tier === "local" ? { options: { num_ctx: 0 } } : {}),
    };

    try {
      if (opts.stream) {
        const stream = await this.client.chatStream(request);
        for await (const event of stream) {
          if (event.type === "message") {
            opts.onChunk?.(event.data.chunk as unknown as ChatResponse);
          }
        }
        const result = await stream.finalResult;
        const message: ChatResponse["message"] & { thinking?: string } = {
          role: result.message.role,
          content: result.message.content,
        };
        if (result.message.tool_calls?.length) message.tool_calls = result.message.tool_calls;
        if (result.message.thinking) message.thinking = result.message.thinking;
        return { message, done: result.done, done_reason: result.raw?.done_reason };
      }

      const response = await this.client.chat({ ...request, stream: false });
      return response as unknown as ChatResponse;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async availableModels(): Promise<unknown> {
    try {
      if (this.tier === "cloud") {
        if (!this.apiKey) throw new ProviderError("missing apiKey for cloud availableModels");
        return await this.client.raw.requestJson({ method: "GET", path: "/v1/models" });
      }
      return await this.client.listModels();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): Error {
    if (error instanceof OllamaRateLimitError) {
      return new RateLimitError(`${this.model} (${this.tier}) rate limited`);
    }
    if (error instanceof OllamaTimeoutError) {
      return new TimeoutError(`connect timeout after ${error.timeoutMs ?? this.timeoutMs}ms`);
    }
    if (error instanceof OllamaAbortError) {
      return new ProviderError(redactSecrets(error.message));
    }
    if (error instanceof OllamaSdkError) {
      const prefix = error.status ? `Ollama ${this.tier} ${error.status}: ` : `Ollama ${this.tier}: `;
      return new ProviderError(redactSecrets(`${prefix}${error.message}`));
    }
    const message = error instanceof Error ? error.message : String(error);
    return new ProviderError(redactSecrets(message));
  }
}
