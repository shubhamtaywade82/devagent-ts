import { Provider, ChatMessage, ChatResponse, ChatOptions, RateLimitError, TimeoutError } from "./provider";
import { Capability, ModelCatalog } from "./catalog";

export interface RouterOptions {
  local: Provider;
  cloud?: Provider;
  catalog: ModelCatalog;
  logger?: Pick<Console, "warn">;
}

export class Router {
  private readonly local: Provider;
  private readonly cloud?: Provider;
  private readonly catalog: ModelCatalog;
  private readonly logger: Pick<Console, "warn">;

  constructor(opts: RouterOptions) {
    this.local = opts.local;
    this.cloud = opts.cloud;
    this.catalog = opts.catalog;
    this.logger = opts.logger ?? console;
  }

  async route(capability: Capability, messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    const candidates = this.catalog.modelsFor(capability);
    if (candidates.length === 0) {
      throw new Error(`no model available for capability "${capability}"`);
    }

    let lastError: unknown;
    for (const candidate of candidates) {
      const provider = candidate.tier === "local" ? this.local : this.cloud;
      if (!provider) continue;

      provider.setModel(candidate.name);
      try {
        return await provider.chat(messages, opts);
      } catch (e) {
        lastError = e;
        if (!this.isRecoverable(e)) throw e;
        this.logger.warn(
          `[Router] ${(e as Error).constructor.name} on ${candidate.tier}/${candidate.name} — trying next candidate`,
        );
      }
    }

    throw lastError ?? new Error(`no reachable provider for capability "${capability}"`);
  }

  private isRecoverable(e: unknown): boolean {
    if (e instanceof RateLimitError) return true;
    if (e instanceof TimeoutError) return true;
    if (e instanceof TypeError) return true;
    return false;
  }
}
