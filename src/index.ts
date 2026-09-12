/**
 * @nemesis-oss/nexum — the intentional public API (review item 38).
 *
 * Stable primitives only:
 *   AgentRuntime · Agent · Task · Tool · ToolGateway · ModelGateway ·
 *   PolicyEngine · ExecutionContext · ExecutionStrategy
 * plus the tool packs products mount and the product agents.
 *
 * Implementation modules stay private: the deep surface (providers,
 * strategies, stores, scheduler internals, domain tools) is reachable
 * through the plane subpath exports (./core ./runtime ./models ./tools
 * ./mcp ./orchestration ./evolution) for advanced embedding, but the
 * package root is the supported, semver-stable surface.
 *
 * Dependency direction (review item 40):
 *   ollama-sdk → Nexum Core (this package's planes) → DevAgent / CryptoAgent
 */

// ── Stable runtime primitives ───────────────────────────────────────────────
export type {
  AgentRuntime,
  TaskSpec as Task,
  ExecutionRequest,
  ExecutionResult,
  ExecutionStatus,
  ExecutionBudget,
  ExecutionContext,
  StrategyName,
  StrategyExecuteOptions,
  EventSink,
  ContextManager,
} from "./core/types.js";

export {
  // runtime facade
  DefaultAgentRuntime,
  AgentRegistry,
  StrategyRegistry,
  defaultStrategyRegistry,
  devAgentDescriptor,
  type AgentDescriptor,
  // strategies (review item 3)
  ReActStrategy,
  PlanExecuteStrategy,
  GraphStrategy,
  type ExecutionStrategy,
  // execution contexts (review item 15)
  createExecutionContext,
  createManagedExecutionContext,
  childExecutionContext,
  // budgets (review item 14)
  BudgetManager,
  BudgetTracker,
  // durable execution history (review item 13)
  ExecutionEventStore,
  ExecutionRecorder,
} from "./runtime/index.js";

// ── Tool plane primitives ───────────────────────────────────────────────────
export { DefaultToolGateway, type ToolGateway } from "./tools/gateway/tool-gateway.js";
export { ToolCatalog } from "./tools/gateway/tool-catalog.js";
export type {
  ToolDefinition as Tool,
  ToolResult,
  ToolInvocation,
  ToolRisk,
  ToolCallContext,
  ToolSideEffects,
  ToolExecutionSpec,
  ToolPolicySpec,
  ToolNetworkRequirements,
} from "./core/tools/tool-contract.js";
export { mountToolPack, defineToolPack, packOf, type ToolPack, type ToolPackEntry } from "./tools/gateway/tool-pack.js";

// ── Policy plane (review items 7, 8) ────────────────────────────────────────
export {
  RulePolicyEngine,
  AllowAllPolicyEngine,
  type PolicyEngine,
  type PolicyRequest,
  type PolicyDecision,
} from "./core/policy/policy-engine.js";
export {
  executionProfile,
  executionProfileByName,
  tradingProfile,
  EXECUTION_PROFILES,
  type ExecutionProfile,
  type ExecutionProfileName,
  type TradingExecutionMode,
} from "./core/policy/execution-profiles.js";
export { profilePosture } from "./core/policy/postures.js";

// ── Model plane primitives (review item 18) ─────────────────────────────────
export { DefaultModelGateway, type ModelGateway } from "./models/gateway/model-gateway.js";
export type {
  ModelRouter,
  ModelSelection,
  RouteRequest,
  RouteConstraints,
  RoutePreferences,
  RoutingDimension,
  SelectionReason,
} from "./models/router/model-selection.js";
export { ScoredModelRouter, estimateCost } from "./models/router/scored-router.js";
export type { ProviderAdapter } from "./models/router/model-selection.js";
export { CAPABILITY_WEIGHTS } from "./models/router/model-selection.js";

// ── The application-level Agent (CLI/TUI composition root) ──────────────────
export { Agent, type AgentEvents, type AgentOptions } from "./cli/agent.js";

// ── Tool packs (products mount these) ───────────────────────────────────────
export {
  filesystemPack,
  processPack,
  gitPack,
  githubPack,
  lspPack,
  browserPack,
  docsPack,
  tradingPack,
  rubyPack,
  railsPack,
  databasePack,
  agentCorePack,
} from "./tools/packs/index.js";

// ── Product agents (review item 40) ─────────────────────────────────────────
export { DevAgent, DEVAGENT_DESCRIPTOR, CryptoAgent, cryptoAgentDescriptor } from "./agents/index.js";
