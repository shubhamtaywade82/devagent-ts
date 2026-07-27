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
  /** Model for this request only, leaving the provider's configured model
   * untouched. Router uses this to try candidates: it previously called
   * setModel() before awaiting chat(), so two concurrent routes through the
   * same Provider instance raced — the second overwrote the first's model
   * mid-flight, and both requests went to whichever model was set last while
   * `routedModel` reported the wrong one. */
  model?: string;
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

export const DEFAULT_CLOUD_HOST = "https://ollama.com";
export const DEFAULT_LOCAL_HOST = "http://localhost:11434";

/** The endpoint a tier talks to when nothing is explicitly configured.
 * OLLAMA_HOST is a local-Ollama convention, so it must never be picked up as
 * a cloud host — pointing Cloud traffic (with a Bearer token attached) at
 * someone's localhost is both broken and a credential leak. */
export function defaultHostForTier(tier: Tier): string {
  return tier === "cloud" ? DEFAULT_CLOUD_HOST : process.env.OLLAMA_HOST ?? DEFAULT_LOCAL_HOST;
}

export class Provider {
  private tier: Tier;
  private model: string;
  /** Explicitly configured host, or undefined to track the tier default. */
  private hostOverride: string | undefined;
  private readonly apiKeys: string[];
  private apiKeyIndex = 0;
  private readonly timeoutMs: number;

  constructor(opts: ProviderOptions) {
    this.tier = opts.tier;
    this.model = opts.model;
    this.hostOverride = opts.host;
    this.apiKeys = opts.apiKeys && opts.apiKeys.length > 0 ? opts.apiKeys : opts.apiKey ? [opts.apiKey] : [];
    // Cloud has a 60s connect timeout; local has no timeout — never kill a running generation.
    this.timeoutMs = opts.timeoutMs ?? (opts.tier === "cloud" ? 60_000 : 0);
  }

  private get host(): string {
    return this.hostOverride ?? defaultHostForTier(this.tier);
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

  /** Switching tier re-derives the host unless one was explicitly configured.
   * The host used to be resolved once in the constructor, so setTier("cloud")
   * on a local-built Provider kept talking to localhost:11434 while attaching
   * a cloud Bearer token to every request. */
  setTier(tier: Tier): void {
    this.tier = tier;
  }

  setRuntimeHost(host: string): void {
    this.hostOverride = host;
  }

  get currentHost(): string {
    return this.host;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    if (this.tier === "cloud" && this.apiKeys.length === 0) {
      throw new ProviderError("missing apiKey for cloud chat");
    }

    const model = opts.model ?? this.model;
    const body: Record<string, unknown> = { model, messages, stream: opts.stream ?? false };
    if (opts.tools) body.tools = opts.tools;

    // Cloud with multiple keys: rotate to the next key on a 429 and retry
    // before giving up — resilience across your own accounts, not a router.
    const maxAttempts = this.tier === "cloud" ? this.apiKeys.length : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.tier === "cloud") headers.Authorization = `Bearer ${this.apiKeys[this.apiKeyIndex]}`;

      let resp: Response;
      if (this.tier === "local" || this.timeoutMs === 0) {
        // Local: no timeout at all — let the model take as long as it needs.
        resp = await fetch(`${this.host}/api/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      } else {
        // Cloud: use a connect timeout only for the initial HTTP response headers.
        // Once headers arrive the stream is open; we cancel the abort so the body
        // reads freely without a hard deadline.
        const connectAbort = new AbortController();
        const connectTimer = setTimeout(
          () => connectAbort.abort(new TimeoutError(`connect timeout after ${this.timeoutMs}ms`)),
          this.timeoutMs,
        );
        try {
          resp = await fetch(`${this.host}/api/chat`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: connectAbort.signal,
          });
        } finally {
          clearTimeout(connectTimer);
        }
      }

      if (resp.status === 429) {
        if (attempt < maxAttempts - 1) {
          this.apiKeyIndex = (this.apiKeyIndex + 1) % this.apiKeys.length;
          continue;
        }
        throw new RateLimitError(`${model} (${this.tier}) rate limited on all ${this.apiKeys.length} key(s)`);
      }
      if (!resp.ok) {
        throw new ProviderError(`Ollama ${this.tier} ${resp.status}: ${redactSecrets(await resp.text())}`);
      }

      return opts.stream ? this.streamChunks(resp, opts.onChunk) : ((await resp.json()) as ChatResponse);
    }

    // Unreachable: maxAttempts is always >= 1 and the loop body always returns or throws.
    throw new RateLimitError(`${model} (${this.tier}) rate limited`);
  }

  async availableModels(): Promise<unknown> {
    const path = this.tier === "cloud" ? "/v1/models" : "/api/tags";
    const headers: Record<string, string> = {};
    if (this.tier === "cloud") {
      if (this.apiKeys.length === 0) throw new ProviderError("missing apiKey for cloud availableModels");
      headers.Authorization = `Bearer ${this.apiKeys[this.apiKeyIndex]}`;
    }

    let resp: Response;
    if (this.timeoutMs > 0) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new TimeoutError(`availableModels timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
      try { resp = await fetch(`${this.host}${path}`, { headers, signal: controller.signal }); }
      finally { clearTimeout(timer); }
    } else {
      resp = await fetch(`${this.host}${path}`, { headers });
    }

    if (!resp.ok) throw new ProviderError(`Ollama ${this.tier} ${resp.status}: ${redactSecrets(await resp.text())}`);
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

    const consume = (chunk: ChatResponse): void => {
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
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;

          // A single non-JSON line (a proxy error page, a keep-alive, a
          // truncated response) used to throw straight out of chat(). Skip it
          // and keep reading — the trailing-buffer parse below already did
          // exactly this, so the two paths were inconsistent.
          let chunk: ChatResponse;
          try {
            chunk = JSON.parse(line) as ChatResponse;
          } catch {
            continue;
          }
          consume(chunk);
        }
      }
    } finally {
      // Without this, an error mid-stream leaves the body unread and the
      // underlying socket held open. Guarded because not every ReadableStream
      // implementation we're handed (test doubles, older fetch polyfills)
      // provides the full reader/cancel surface — cleanup must never be the
      // thing that fails the request.
      try {
        reader.releaseLock?.();
        await resp.body.cancel?.();
      } catch {
        // best-effort
      }
    }

    // Parse any remaining content in the buffer (if it didn't end with a newline)
    const remaining = buffer.trim();
    if (remaining) {
      try {
        consume(JSON.parse(remaining) as ChatResponse);
      } catch {
        // Ignore parse error for incomplete trailing chunks
      }
    }

    if (!final) {
      if (accumulatedContent || accumulatedThinking || accumulatedToolCalls.length > 0) {
        final = {
          message: {
            role: "assistant",
            content: accumulatedContent,
          },
          done: true,
          done_reason: "stop",
        };
      } else {
        throw new ProviderError("stream ended without a done:true chunk");
      }
    }

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
