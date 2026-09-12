/**
 * TradingPack (review item 21) — the entire trading domain as one
 * mountable pack.
 *
 * Market-data tools are read-only; analysis tools (backtesting) are
 * read-only; stream tools are low-risk; the paper-trade tool declares
 * financial side effects so the PolicyEngine demands confirmation
 * (review item 30: execution routes through the TradingExecutionPipeline
 * with deterministic validation + risk, never raw LLM authority).
 */

import { Tool } from "../tool.js";
import {
  BinancePublicApiTool,
  BinanceTechnicalIndicatorsTool,
  BinanceOrderBookTool,
  BinanceFuturesStatsTool,
  BinanceScreenerTool,
  BinanceWatchPriceTool,
  BinanceUnwatchPriceTool,
  BinancePriceAlertTool,
  BinanceLiquidationsTool,
  BinanceOhlcvTool,
  BinanceMultiTimeframeTool,
  BinanceVolumeTool,
  BinanceFundingHistoryTool,
  BinanceOpenInterestHistoryTool,
  BinanceFuturesBasisTool,
} from "../binance-tools.js";
import {
  BinanceBacktestTool,
  BinanceWalkForwardTool,
  BinanceMonteCarloTool,
  BinanceParamSweepTool,
} from "../backtest-tools.js";
import { BinancePaperTradeTool } from "../paper-trading-tools.js";
import { BinanceStreamManager, PaperTradingManager } from "../../domains/trading/index.js";
import { ToolPack, ToolPackEntry } from "../gateway/tool-pack.js";
import type { ToolRisk } from "../../core/tools/tool-contract.js";

type Meta = ToolPackEntry["metadata"];

export interface TradingPackOptions {
  stream: BinanceStreamManager;
  /** Paper ledger override (defaults to a fresh ledger over the stream). */
  paper?: PaperTradingManager;
}

/**
 * TradingPack — market data, technical analysis, backtesting, and paper
 * trading (Binance). Replaces the cryptoPack naming (review item 21);
 * cryptoPack remains as a compat alias.
 */
export function tradingPack(opts: TradingPackOptions): ToolPack {
  const marketTools: Tool[] = [
    new BinancePublicApiTool(),
    new BinanceTechnicalIndicatorsTool(),
    new BinanceOrderBookTool(),
    new BinanceFuturesStatsTool(),
    new BinanceScreenerTool(),
    new BinanceOhlcvTool(),
    new BinanceMultiTimeframeTool(),
    new BinanceVolumeTool(),
    new BinanceFundingHistoryTool(),
    new BinanceOpenInterestHistoryTool(),
    new BinanceFuturesBasisTool(),
  ];
  const analysisTools: Tool[] = [
    new BinanceBacktestTool(),
    new BinanceWalkForwardTool(),
    new BinanceMonteCarloTool(),
    new BinanceParamSweepTool(),
  ];
  const streamTools: Tool[] = [
    new BinanceWatchPriceTool(opts.stream),
    new BinanceUnwatchPriceTool(opts.stream),
    new BinancePriceAlertTool(opts.stream),
    new BinanceLiquidationsTool(opts.stream),
  ];
  const paper = opts.paper ?? new PaperTradingManager(opts.stream);

  const readMeta: Meta = { risk: "read", sideEffects: { network: true } };
  const entries: ToolPackEntry[] = [
    ...marketTools.map((tool) => ({ tool, category: "Market", metadata: readMeta })),
    ...analysisTools.map((tool) => ({ tool, category: "Market", metadata: readMeta })),
    ...streamTools.map((tool) => ({
      tool,
      category: "Market",
      metadata: { risk: "low" as ToolRisk, sideEffects: { network: true } },
    })),
    {
      tool: new BinancePaperTradeTool(paper),
      category: "Market",
      metadata: {
        risk: "critical",
        sideEffects: { network: true, financial: true, externalMutation: true },
        policy: { confirmation: "required" },
        execution: { concurrency: 1, idempotent: false, reversible: false, timeoutMs: 30_000 },
      },
    },
  ];

  return {
    id: "trading",
    description: "Trading domain: market data, technical analysis, backtesting, and paper trading (Binance).",
    capability: "market",
    entries,
  };
}

/** @deprecated mount tradingPack instead (review item 21). */
export const cryptoPack = tradingPack;
