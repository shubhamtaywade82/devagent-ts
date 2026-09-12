/**
 * CLI services (review item 1) — the explicit services the Agent god class
 * was split into. Agent composes these; it no longer owns their internals.
 *
 *   ModelStack        providers, catalog, routing, hybrid components
 *   SessionManager    conversation persistence + summarization
 *   ApprovalManager   human-in-the-loop gates (approvals + clarifications)
 *   ExecutionManager  run scopes, cancellation, planned missions
 *
 * The runtime-side services (AgentRuntime, ModelGateway, ToolGateway,
 * PolicyEngine, ContextManager) live in their planes: runtime/, models/,
 * tools/, core/.
 */

export { ModelStack, type StatusEmitter } from "./model-stack.js";
export { SessionManager, type SessionManagerOptions } from "./session-manager.js";
export { ApprovalManager, type ApprovalManagerOptions } from "./approval-manager.js";
export { ExecutionManager, type ExecutionManagerOptions, type ExecutionRunScope } from "./execution-manager.js";
