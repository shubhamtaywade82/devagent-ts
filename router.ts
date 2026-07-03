import { Provider, ChatMessage, ChatResponse, ChatOptions, RateLimitError } from "./provider";

export interface RouterOptions {
  fastLocal: Provider;
  deepCloud: Provider;
  fallback?: Provider;
  logger?: Pick<Console, "warn">;
}

// Routes by task complexity, falls back to local on rate-limit or
// timeout/network failure. Cloud usage limits are a normal operating
// condition, not an edge case — treat a 429 like a stale feed: fail
// open, don't block the loop waiting on it.
export class Router {
  private readonly fastLocal: Provider;
  private readonly deepCloud: Provider;
  private readonly fallback: Provider;
  private readonly logger: Pick<Console, "warn">;

  constructor(opts: RouterOptions) {
    this.fastLocal = opts.fastLocal;
    this.deepCloud = opts.deepCloud;
    this.fallback = opts.fallback ?? opts.fastLocal;
    this.logger = opts.logger ?? console;
  }

  async route(complex: boolean, messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    const primary = complex ? this.deepCloud : this.fastLocal;

    try {
      return await primary.chat(messages, opts);
    } catch (e) {
      if (this.isRecoverable(e)) {
        this.logger.warn(`[Router] ${(e as Error).constructor.name} on primary tier — falling back to local`);
        return this.fallback.chat(messages, opts);
      }
      throw e;
    }
  }

  private isRecoverable(e: unknown): boolean {
    if (e instanceof RateLimitError) return true;
    if (e instanceof DOMException && e.name === "TimeoutError") return true; // AbortSignal.timeout
    if (e instanceof TypeError) return true; // native fetch's network-failure error type
    return false;
  }
}
