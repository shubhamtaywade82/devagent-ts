/**
 * Model-plane type vocabulary owned by the kernel plane.
 *
 * These declarations moved here from provider/provider.ts and
 * provider/catalog.ts during the package split so the kernel's ports
 * (ModelGateway, ExecutionRequest, tool schemas) never depend on the
 * model implementations. provider/ re-exports every name, so existing
 * import sites keep working unchanged.
 */

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
  /** Model for this request only, leaving the provider's configured model
   * untouched. Router uses this to try candidates: it previously called
   * setModel() before awaiting chat(), so two concurrent routes through the
   * same Provider instance raced — the second overwrote the first's model
   * mid-flight, and both requests went to whichever model was set last while
   * `routedModel` reported the wrong one. */
  model?: string;
}

export type Capability = "coding" | "vision" | "reasoning" | "quick" | "tools" | "agentic";

export interface ModelInfo {
  name: string;
  tier: Tier;
  capabilities: Capability[];
}
