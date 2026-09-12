/**
 * Domains plane (review item 22) — product-scoped functionality the
 * runtime stays neutral about: trading (Binance/paper/backtest/execution),
 * Rails/Ruby intelligence. Each domain mounts through a tool pack.
 */
export * from "./trading/index.js";
export { SemanticIndex, createRailsTools } from "./rails/index.js";
export { RunRubocopTool } from "./ruby/rubocop-tool.js";
export { RunRSpecTool } from "./ruby/rspec-tool.js";
