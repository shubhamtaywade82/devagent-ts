/**
 * Trading execution types (review item 30).
 *
 * The LLM proposes; deterministic code validates, prices risk, and
 * decides. The authority chain is fixed:
 *
 *   LLM TradingProposal (advisory ONLY)
 *     → deterministic validation (schema + sanity + allowlist)
 *     → RiskEngine assessment (position/notional/loss limits)
 *     → execution policy (mode: research | backtest | paper | shadow | live)
 *     → executor (paper simulator / shadow recorder / live venue adapter)
 *
 * Nothing downstream of the proposal trusts the LLM: every number is
 * re-checked, every limit enforced by code.
 */

export type TradingSide = "buy" | "sell";
export type TradingMarket = "spot" | "futures";
export type TradingExecutionMode = "research" | "backtest" | "paper" | "shadow" | "live";

/** What the LLM is allowed to produce — a PROPOSAL, never an order. */
export interface TradingProposal {
  /** Correlation (review item 33). */
  runId?: string;
  agentId?: string;
  symbol: string;
  market: TradingMarket;
  side: TradingSide;
  /** Desired position size in base units. */
  quantity: number;
  /** Optional limit price; market orders omit it. */
  limitPrice?: number;
  /** Risk instructions the proposer wants (checked, not trusted). */
  stopPrice?: number;
  takeProfitPrice?: number;
  /** Free-form rationale (audit trail). */
  rationale?: string;
  /** Time the proposal was generated. */
  proposedAt?: number;
}

/** Deterministic validation verdict (stage 2). */
export interface ValidationVerdict {
  valid: boolean;
  errors: string[];
  /** Normalized proposal (symbol upper-cased, numbers checked). */
  normalized?: TradingProposal;
}

/** Deterministic risk assessment (stage 3). */
export interface RiskAssessment {
  approved: boolean;
  reasons: string[];
  /** Notional value of the proposed order at the reference price. */
  notionalUsd?: number;
  /** Checks that ran (audit trail). */
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}

/** The final decision after the mode-aware execution policy (stage 4). */
export interface TradingDecision {
  approved: boolean;
  mode: TradingExecutionMode;
  reason: string;
  requiresHumanConfirmation: boolean;
}

/** An executed (or simulated/recorded) order (stage 5). */
export interface ExecutionRecord {
  proposal: TradingProposal;
  decision: TradingDecision;
  risk: RiskAssessment;
  status: "filled" | "rejected" | "simulated" | "recorded" | "failed";
  fillPrice?: number;
  executedAt?: number;
  executorId?: string;
  error?: string;
}

/** Portfolio snapshot the risk engine evaluates against. */
export interface PortfolioSnapshot {
  /** Open positions (symbol → aggregate signed quantity). */
  positions: Array<{ symbol: string; market: TradingMarket; netQuantity: number; entryPrice: number }>;
  /** Realized + unrealized PnL in USD for the session/day. */
  dayPnlUsd: number;
  /** Total equity for sizing caps. */
  equityUsd: number;
  /** Reference prices the risk engine prices orders at. */
  referencePrices: Record<string, number>;
}

/** Risk limits — configured by the operator, never by the model. */
export interface RiskLimits {
  /** Max notional per order (USD). */
  maxOrderNotionalUsd: number;
  /** Max total open notional (USD). */
  maxTotalExposureUsd: number;
  /** Max absolute daily loss before all trading halts (USD). */
  maxDailyLossUsd: number;
  /** Stop-loss required on every position. */
  requireStopLoss: boolean;
  /** Min stop-loss distance (fraction of entry, e.g. 0.005 = 0.5%). */
  minStopDistancePct: number;
  /** Max leverage implied by notional/equity. */
  maxLeverage: number;
  /** Allowed symbols (empty = allowlist enforced elsewhere). */
  allowedSymbols?: string[];
  /** Max positions per symbol (net). */
  maxPositionsPerSymbol: number;
}
