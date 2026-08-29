import {
  OllamaClient,
  OllamaRateLimitError,
  OllamaTimeoutError,
  OllamaAbortError,
  OllamaClientError,
  type ChatResponse as SdkChatResponse,
  type ChatRequestOptions,
  type Message as OllamaMessage,
  type ToolDefinition as OllamaToolDef,
} from "@nemesis-oss/ollama-sdk";

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
  message: { role: string; content: string; tool_calls?: unknown[]; thinking?: string };
  done: boolean;
  /** Which tier/model actually served this response — stamped by Router.route,
   * since its candidate list can silently widen past whatever capability was
   * requested (e.g. "quick" resolving to a cloud model when no local model
   * reports tool support). Absent for calls made directly via Provider.chat
   * with no Router involved. */
  routedTier?: Tier;
  routedModel?: string;
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
  /** Pool of Ollama Cloud API keys (e.g. separate accounts). On a 429 the
   * provider rotates to the next key and retries before giving up — this is
   * for availability across your own accounts, not multi-vendor routing. */
  apiKeys?: string[];
  timeoutMs?: number;
}

/**
 * Thin adapter over `@nemesis-oss/ollama-sdk`, preserving the exact public contract
 * this class had when it hand-rolled `fetch` calls directly: same methods,
 * same error classes, same secret redaction, same per-tier timeout
 * semantics. Retries are intentionally left at 0 here — `Router` (see
 * router.ts) owns cross-tier fallback policy; retrying within a single tier
 * before Router ever sees the failure would just slow that fallback down.
 */
export class Provider {
  private tier: Tier;
  private model: string;
  private host: string;
  private readonly apiKeys: string[];
  private apiKeyIndex = 0;
  private readonly timeoutMs: number;
  private client: OllamaClient;

  constructor(opts: ProviderOptions) {
    this.tier = opts.tier;
    this.model = opts.model;
    this.host =
      opts.host ??
      (opts.tier === "cloud" ? "https://ollama.com" : process.env.OLLAMA_HOST ?? "http://localhost:11434");
    this.apiKeys = opts.apiKeys && opts.apiKeys.length > 0 ? opts.apiKeys : opts.apiKey ? [opts.apiKey] : [];
    // Cloud has a 60s connect timeout; local has no timeout — never kill a running generation.
    // (@nemesis-oss/ollama-sdk's timeoutMs bounds time-to-first-byte: the internal
    // HttpClient clears its timer once the response headers arrive, before any
    // streaming body is read — matching our prior connect-only timeout behavior.)
    this.timeoutMs = opts.timeoutMs ?? (opts.tier === "cloud" ? 60_000 : 0);
    this.client = this.buildClient();
  }

  private buildClient(): OllamaClient {
    return new OllamaClient({
      baseUrl: this.host,
      apiKey: this.tier === "cloud" ? this.currentApiKey : undefined,
      timeoutMs: this.timeoutMs > 0 ? this.timeoutMs : undefined,
      retries: 0,
    });
  }

  /** Returns the current API key from the pool (for cloud tier). */
  private get currentApiKey(): string | undefined {
    return this.apiKeys.length > 0 ? this.apiKeys[this.apiKeyIndex] : undefined;
  }

  get currentModel(): string {
    return this.model;
  }

  get currentTier(): Tier {
    return this.tier;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setTier(tier: Tier): void {
    this.tier = tier;
    // Host may need to change (e.g. cloud ↔ local). Rebuild if the host is default-derived.
    this.host =
      tier === "cloud"
        ? this.host.replace(/^https?:\/\/localhost:\d+/, "https://ollama.com") || "https://ollama.com"
        : this.host === "https://ollama.com"
          ? process.env.OLLAMA_HOST ?? "http://localhost:11434"
          : this.host;
    this.client = this.buildClient();
  }

  setRuntimeHost(host: string): void {
    this.host = host;
    this.client = this.buildClient();
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    if (this.tier === "cloud" && this.apiKeys.length === 0) {
      throw new ProviderError("missing apiKey for cloud chat");
    }

    const wantStream = opts.stream ?? false;

    // Convert our ChatMessage[] → SDK Message[] (shape-compatible, just need readonly cast)
    const sdkMessages = messages as readonly OllamaMessage[];

    // Convert OllamaToolSchema[] → SDK ToolDefinition[] (structurally identical)
    const sdkTools = opts.tools as readonly OllamaToolDef[] | undefined;

    const req: ChatRequestOptions = {
      model: this.model,
      messages: sdkMessages,
      stream: wantStream,
      tools: sdkTools,
    };

    // Cloud with multiple keys: rotate to the next key on a 429 and retry
    // before giving up — resilience across your own accounts, not a router.
    const maxAttempts = this.tier === "cloud" ? this.apiKeys.length : 1;

    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (wantStream) {
          return await this.handleStream(req, opts.onChunk);
        } else {
          return this.toProviderResponse(await this.client.chat({ ...req, stream: false } as ChatRequestOptions & { stream?: false }) );
        }
      } catch (error) {
        lastError = error;
        if (error instanceof OllamaRateLimitError && this.tier === "cloud") {
          if (attempt < maxAttempts - 1) {
            this.apiKeyIndex = (this.apiKeyIndex + 1) % this.apiKeys.length;
            this.client = this.buildClient();
            continue;
          }
          throw new RateLimitError(
            `${this.model} (${this.tier}) rate limited on all ${this.apiKeys.length} key(s)`,
          );
        }
        throw this.mapError(error);
      }
    }

    // Unreachable: maxAttempts >= 1 and the loop body always returns or throws.
    throw lastError instanceof Error ? lastError : new ProviderError(String(lastError));
  }

  async availableModels(): Promise<unknown> {
    if (this.tier === "cloud") {
      if (this.apiKeys.length === 0) throw new ProviderError("missing apiKey for cloud availableModels");
      // Cloud model listing uses OpenAI-compat /v1/models, not /api/tags.
      try {
        const resp = await this.client.openai.listModels();
        return resp;
      } catch (error) {
        throw this.mapError(error);
      }
    }
    try {
      return await this.client.models.list();
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Streams via the SDK's OllamaStream, accumulating content/thinking/tool_calls
   * and forwarding individual NDJSON chunks to onChunk.
   */
  private async handleStream(
    req: ChatRequestOptions,
    onChunk?: (chunk: ChatResponse) => void,
  ): Promise<ChatResponse> {
    const stream = await this.client.chatStream(req);

    let accumulatedContent = "";
    let accumulatedThinking = "";
    const accumulatedToolCalls: unknown[] = [];
    for await (const event of stream) {
      if (event.type === "message") {
        // Forward raw Ollama chunk to caller
        const chunk = event.data.chunk as unknown as ChatResponse;
        onChunk?.(chunk);

        // Accumulate
        if (chunk.message) {
          if (chunk.message.content) accumulatedContent += chunk.message.content;
          if (chunk.message.thinking) accumulatedThinking += chunk.message.thinking;
          if (Array.isArray(chunk.message.tool_calls)) {
            accumulatedToolCalls.push(...chunk.message.tool_calls);
          }
        }
      }
    }

    // Wait for the stream's aggregated final result
    const result = await stream.finalResult;

    // Build the accumulated response in the same shape our old hand-rolled stream produced
    const response: ChatResponse = {
      message: {
        role: result.message.role,
        content: accumulatedContent || result.message.content,
      },
      done: true,
      done_reason: result.doneReason ?? "stop",
    };

    if (accumulatedThinking) {
      response.message.thinking = accumulatedThinking;
    }
    if (accumulatedToolCalls.length > 0) {
      response.message.tool_calls = accumulatedToolCalls;
    }

    return response;
  }

  /** Maps a non-streaming SDK ChatResponse into our local ChatResponse shape. */
  private toProviderResponse(sdkResp: SdkChatResponse): ChatResponse {
    const response: ChatResponse = {
      message: {
        role: sdkResp.message.role,
        content: sdkResp.message.content,
      },
      done: sdkResp.done,
      done_reason: sdkResp.done_reason,
      model: sdkResp.model,
    };

    // Propagate thinking if present
    if (sdkResp.message.thinking) {
      response.message.thinking = sdkResp.message.thinking;
    }
    // Propagate tool_calls if present
    if (sdkResp.message.tool_calls && sdkResp.message.tool_calls.length > 0) {
      response.message.tool_calls = sdkResp.message.tool_calls as unknown[];
    }

    return response;
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
    if (error instanceof OllamaClientError) {
      const prefix = error.status ? `Ollama ${this.tier} ${error.status}: ` : `Ollama ${this.tier}: `;
      return new ProviderError(redactSecrets(`${prefix}${error.message}`));
    }
    const message = error instanceof Error ? error.message : String(error);
    return new ProviderError(redactSecrets(message));
  }
}
