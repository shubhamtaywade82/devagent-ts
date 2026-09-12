// @nemesis-oss/nexum — public API surface
// Re-exports the core classes for programmatic use.

export { Agent, type AgentEvents, type AgentOptions } from "./cli/agent.js";
export {
  Provider,
  RateLimitError,
  ProviderError,
  TimeoutError,
  type Tier,
  type ChatMessage,
  type ChatResponse,
  type ChatOptions,
  type ProviderOptions,
} from "./models/adapters/provider.js";
export { ModelCatalog, inferCapabilities, type Capability, type ModelInfo } from "./models/catalog.js";
export { Router, type RouterOptions } from "./models/router/router.js";

// ── Agent execution kernel ──────────────────────────────────────────────────
export * from "./core/index.js";

// Domain packs (tool packs products mount into the kernel)
export {
  filesystemPack,
  shellPack,
  searchPack,
  gitPack,
  projectPack,
  rubyPack,
  dockerPack,
  databasePack,
  lspPack,
  browserPack,
  docsPack,
  railsPack,
  agentCorePack,
  cryptoPack,
} from "./tools/packs/index.js";
