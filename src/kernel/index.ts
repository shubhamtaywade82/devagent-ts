/**
 * @nemesis-oss/nexum kernel — the agent execution kernel.
 *
 * Public surface for embedding applications (CLI, TUI, API servers, other
 * agent products). Everything exported here is domain-free: no Git, no
 * Rails, no Binance, no browser — those mount via tool packs.
 */

// Core contracts
export type {
  RunId,
  SessionId,
  AgentId,
  TaskSpec,
  StrategyName,
  ExecutionRequest,
  ExecutionBudget,
  BudgetUsage,
  BudgetDimension,
  ExecutionStatus,
  ExecutionResult,
  EventSink,
  ContextManager,
  StateStore,
  ExecutionContext,
  AgentRuntime,
  StrategyExecuteOptions,
} from "./types.js";

// Budgets
export {
  BudgetTracker,
  WallClockBudgetError,
  ToolCallBudgetError,
  ModelCallBudgetError,
  TokenBudgetError,
  CostBudgetError,
} from "./budget.js";

// Execution context
export { createExecutionContext, TransientContextManager, nullEventSink, taskFrom } from "./execution-context.js";

// Tool layer
export { ToolCatalog, type ToolCatalogEntry, type LegacyToolMetadata } from "./tools/tool-catalog.js";
export {
  type ToolDefinition,
  type ToolResult,
  type ToolHandler,
  type ToolRisk,
  type ToolSideEffects,
  type ToolExecutionSpec,
  type ToolPolicySpec,
  NO_SIDE_EFFECTS,
  defineToolMetadata,
  toolRiskAtLeast,
  TOOL_RISK_ORDER,
} from "./tools/tool-definition.js";
export {
  DefaultToolGateway,
  UnknownToolError,
  ToolDeniedError,
  ToolValidationError,
  ToolTimeoutError,
  canonicalToolName,
  normalizeToolArgs,
  decodeRawArguments,
  validateAgainstSchema,
  makeToolInvocation,
  type InvokeContext,
} from "./tools/tool-gateway.js";
export { defineToolPack, packOf, mountToolPack, type ToolPack, type ToolPackEntry } from "./tools/tool-pack.js";

// Policy
export {
  RulePolicyEngine,
  AllowAllPolicyEngine,
  DenyToolsRule,
  DenyRiskAboveRule,
  ModeRestrictionRule,
  ConfirmationRule,
  type PolicyEngine,
  type PolicyRequest,
  type PolicyDecision,
  type PolicyRule,
  type AgentModePolicy,
  type RulePolicyEngineOptions,
} from "./policy/policy-engine.js";
export {
  DestructiveShellRule,
  GitPublishRule,
  DeleteFileRule,
  DESTRUCTIVE_SHELL_PATTERNS,
} from "./policy/rules.js";
export {
  parityPosture,
  standardPosture,
  restrictedPosture,
  postureByName,
  type PolicyPostureName,
  type RestrictedPostureOptions,
} from "./policy/postures.js";
export {
  ApprovalBroker,
  classifyApprovalNeeded,
  describeConfirmation,
  type ApprovalRequestSpec,
  type ApprovalResponder,
} from "./policy/approval-broker.js";

// Models
export { ModelCapabilityRegistry, type ProfileQuery } from "./models/model-capability-registry.js";
export {
  type ModelProfile,
  type ModelCapabilities,
  type ModelConstraints,
  type ModelCost,
  UNKNOWN_SCORE,
  profileFromLegacy,
  defaultConstraints,
} from "./models/model-profile.js";
export { DefaultModelGateway, type ModelGateway, type DefaultModelGatewayOptions } from "./models/model-gateway.js";

// Concurrency
export {
  GateRegistry,
  GATE_SCOPES,
  type GateScope,
  type GateRegistryDefaults,
  type GateSnapshot,
} from "./concurrency/gate-registry.js";

// Events
export {
  familyOf,
  filteringSink,
  isExecutionEvent,
  isDomainEvent,
  isPresentationEvent,
  type EventFamily,
  type ExecutionEvent,
  type DomainEvent,
  type PresentationEvent,
} from "./events/families.js";

// Strategies + runtime
export type { ExecutionStrategy } from "./strategies/execution-strategy.js";
export {
  type StrategyRunRequest,
  ReActStrategy,
  runGuarded,
  extractToolCalls,
  type LoopOutcome,
} from "./strategies/execution-strategy.js";
export type {
  StrategyHooks,
  StrategyTurnInfo,
  StrategyModelCallOptions,
  PreparedToolCall,
  ToolObservation,
  ToolObservationAction,
  ToolFailureInfo,
  ConfirmationRequest,
} from "./strategies/strategy-hooks.js";
export { PlanExecuteStrategy } from "./strategies/plan-execute-strategy.js";
export {
  AgentRegistry,
  StrategyRegistry,
  DefaultAgentRuntime,
  defaultStrategyRegistry,
  devAgentDescriptor,
  runId,
  type AgentDescriptor,
  type DefaultAgentRuntimeOptions,
} from "./strategies/agent-runtime.js";
