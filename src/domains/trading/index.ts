/**
 * Trading domain (review items 22, 30, 31) — isolated from the runtime.
 *
 * Market data (Binance streams), paper trading, backtesting, and the
 * execution pipeline (LLM proposal → deterministic validation → risk
 * engine → mode-aware policy → paper/shadow/live executor). The runtime
 * never imports this; it mounts via the TradingPack tool pack.
 */

export { BinanceStreamManager } from "./binance-stream.js";
export { PaperTradingManager, type PaperPosition } from "./paper-trading.js";
export { runBacktest } from "./backtest/engine.js";
export * from "./backtest/types.js";

// execution pipeline (review items 30, 31)
export { TradingExecutionPipeline, type TradingExecutionPipelineOptions } from "./execution/pipeline.js";
export { validateProposal } from "./execution/validation.js";
export { TradingRiskEngine, DEFAULT_RISK_LIMITS } from "./execution/risk-engine.js";
export {
  executionPolicyFor,
  NoRoutingExecutor,
  PaperOrderExecutor,
  ShadowOrderExecutor,
  LiveOrderExecutor,
  portfolioFromPrices,
  type TradingExecutor,
  type LiveVenueAdapter,
} from "./execution/executors.js";
export type {
  TradingProposal,
  TradingDecision,
  TradingExecutionMode,
  TradingSide,
  TradingMarket,
  ValidationVerdict,
  RiskAssessment,
  RiskLimits,
  PortfolioSnapshot,
  ExecutionRecord,
} from "./execution/types.js";
