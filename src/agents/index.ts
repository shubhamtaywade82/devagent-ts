/**
 * Product agents (review item 40) — consume Nexum Core, own product scope.
 *
 * Dependency direction (enforced by layering):
 *   ollama-sdk → Nexum Core → DevAgent / CryptoAgent
 *
 *   DevAgent     software engineering (filesystem/process/git/lsp packs)
 *   CryptoAgent  trading (trading pack + deterministic execution pipeline)
 */

export { DevAgent, DEVAGENT_DESCRIPTOR, type DevAgentOptions } from "./devagent/dev-agent.js";
export { CryptoAgent, cryptoAgentDescriptor, type CryptoAgentOptions } from "./cryptoagent/crypto-agent.js";
