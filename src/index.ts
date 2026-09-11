// @nemesis-oss/nexum — public API surface
// Re-exports the core classes for programmatic use.

export { Agent, type AgentEvents, type AgentOptions } from "@nemesis-oss/nexum-devagent/cli/agent";
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
} from "@nemesis-oss/nexum-models/provider/provider";
export {
  ModelCatalog,
  inferCapabilities,
  type Capability,
  type ModelInfo,
} from "@nemesis-oss/nexum-models/provider/catalog";
export { Router, type RouterOptions } from "@nemesis-oss/nexum-models/provider/router";

// ── Agent execution kernel ──────────────────────────────────────────────────
export * from "@nemesis-oss/nexum-core/kernel/index";

// DefaultModelGateway moved to the models package in the split; keep it on
// the umbrella surface.
export {
  DefaultModelGateway,
  type DefaultModelGatewayOptions,
} from "@nemesis-oss/nexum-models/provider/default-model-gateway";

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
} from "@nemesis-oss/nexum-tools/packs/index";
