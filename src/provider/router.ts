import { Provider, ChatMessage, ChatResponse, ChatOptions, RateLimitError, TimeoutError } from "./provider";

export interface RouterOptions {
  fastLocal: Provider;
  deepCloud: Provider;
  fallback?: Provider;
  logger?: Pick<Console, "warn">;
}

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
    if (e instanceof TimeoutError) return true;
    if (e instanceof TypeError) return true;
    return false;
  }
}
