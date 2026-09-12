/**
 * Executors + the mode-aware execution policy (review items 30 stage 4/5
 * + item 31).
 *
 * Execution modes with progressively stricter permissions:
 *
 *   research → NO order routing at all (market reads only)
 *   backtest → historical simulation only
 *   paper    → PaperTradingManager simulator (never a real venue)
 *   shadow   → records the decision against live prices but routes nothing
 *   live     → real venue adapter, human confirmation REQUIRED, strictest
 *              risk limits
 *
 * The LiveExecutor deliberately ships as a guarded venue-adapter CONTRACT:
 * constructing it without a configured, explicitly-enabled venue adapter
 * throws — live trading must be wired by the product, never by the agent.
 */

import type {
  ExecutionRecord,
  PortfolioSnapshot,
  TradingDecision,
  TradingExecutionMode,
  TradingProposal,
} from "./types.js";
import type { PaperTradingManager } from "../paper-trading.js";

export interface TradingExecutor {
  readonly id: string;
  /** Route (or simulate/record) one approved proposal. */
  execute(proposal: TradingProposal, decision: TradingDecision): Promise<ExecutionRecord>;
}

/** Mode-aware permission decision (review item 31). */
export function executionPolicyFor(mode: TradingExecutionMode): TradingDecision["approved"] extends never
  ? never
  : {
      mode: TradingExecutionMode;
      /** Can orders route at all in this mode? */
      routingAllowed: boolean;
      /** Which executors may run. */
      allowedExecutors: Array<"none" | "simulator" | "recorder" | "venue">;
      /** Human confirmation required before execution. */
      requiresHumanConfirmation: boolean;
      description: string;
    } {
  switch (mode) {
    case "research":
      return {
        mode,
        routingAllowed: false,
        allowedExecutors: ["none"],
        requiresHumanConfirmation: false,
        description: "research: market data reads only; no order routing of any kind",
      };
    case "backtest":
      return {
        mode,
        routingAllowed: false,
        allowedExecutors: ["none"],
        requiresHumanConfirmation: false,
        description: "backtest: historical simulation outside the execution pipeline",
      };
    case "paper":
      return {
        mode,
        routingAllowed: true,
        allowedExecutors: ["simulator"],
        requiresHumanConfirmation: false,
        description: "paper: simulated fills via the paper ledger; never a real venue",
      };
    case "shadow":
      return {
        mode,
        routingAllowed: false,
        allowedExecutors: ["recorder"],
        requiresHumanConfirmation: false,
        description: "shadow: decisions recorded against live prices; nothing routed",
      };
    case "live":
      return {
        mode,
        routingAllowed: true,
        allowedExecutors: ["venue"],
        requiresHumanConfirmation: true,
        description: "live: real venue routing; human confirmation required; strictest limits",
      };
  }
}

/** research/backtest modes: refuse everything with a clear reason. */
export class NoRoutingExecutor implements TradingExecutor {
  readonly id = "no-routing";
  constructor(private readonly mode: TradingExecutionMode = "research") {}

  async execute(proposal: TradingProposal, decision: TradingDecision): Promise<ExecutionRecord> {
    return {
      proposal,
      decision,
      risk: { approved: false, reasons: [], checks: [] },
      status: "rejected",
      executedAt: Date.now(),
      executorId: this.id,
      error: `mode "${this.mode}" does not route orders (research/backtest are read-only)`,
    };
  }
}

/** Paper executor: fills against the in-memory paper ledger. */
export class PaperOrderExecutor implements TradingExecutor {
  readonly id = "paper-simulator";

  constructor(private readonly paper: PaperTradingManager) {}

  async execute(proposal: TradingProposal, decision: TradingDecision): Promise<ExecutionRecord> {
    const result = await this.paper.open(
      proposal.symbol,
      proposal.side === "buy" ? "long" : "short",
      proposal.quantity,
      proposal.stopPrice,
      proposal.takeProfitPrice,
      proposal.market,
    );
    if ("error" in result && result.error) {
      return {
        proposal,
        decision,
        risk: { approved: true, reasons: [], checks: [] },
        status: "failed",
        executedAt: Date.now(),
        executorId: this.id,
        error: `${result.error}: ${result.message ?? ""}`,
      };
    }
    const position = result as { id: number; entryPrice: number };
    return {
      proposal,
      decision,
      risk: { approved: true, reasons: [], checks: [] },
      status: "simulated",
      fillPrice: position.entryPrice,
      executedAt: Date.now(),
      executorId: this.id,
    };
  }
}

/** Shadow executor: records the would-be fill, routes nothing. */
export class ShadowOrderExecutor implements TradingExecutor {
  readonly id = "shadow-recorder";

  constructor(private readonly priceOf: (symbol: string) => number | undefined) {}

  async execute(proposal: TradingProposal, decision: TradingDecision): Promise<ExecutionRecord> {
    const price = this.priceOf(proposal.symbol);
    return {
      proposal,
      decision,
      risk: { approved: true, reasons: [], checks: [] },
      status: "recorded",
      fillPrice: price,
      executedAt: Date.now(),
      executorId: this.id,
      error: price === undefined ? "no live price for shadow fill" : undefined,
    };
  }
}

/** The venue adapter a product must implement for live routing. */
export interface LiveVenueAdapter {
  readonly venueId: string;
  submitOrder(proposal: TradingProposal): Promise<{ fillPrice: number; orderId: string }>;
}

export class LiveOrderExecutor implements TradingExecutor {
  readonly id = "live-venue";

  constructor(
    private readonly venue: LiveVenueAdapter,
    private readonly opts: { requiresConfirmation: boolean; confirmed?: boolean },
  ) {
    if (!venue || !venue.venueId) {
      throw new Error(
        "LiveOrderExecutor requires a configured LiveVenueAdapter — the agent must never construct live trading by itself",
      );
    }
  }

  async execute(proposal: TradingProposal, decision: TradingDecision): Promise<ExecutionRecord> {
    if (this.opts.requiresConfirmation && !this.opts.confirmed) {
      return {
        proposal,
        decision,
        risk: { approved: true, reasons: [], checks: [] },
        status: "rejected",
        executedAt: Date.now(),
        executorId: this.id,
        error: "live execution requires explicit human confirmation before routing",
      };
    }
    try {
      const fill = await this.venue.submitOrder(proposal);
      return {
        proposal,
        decision,
        risk: { approved: true, reasons: [], checks: [] },
        status: "filled",
        fillPrice: fill.fillPrice,
        executedAt: Date.now(),
        executorId: this.id,
      };
    } catch (e) {
      return {
        proposal,
        decision,
        risk: { approved: true, reasons: [], checks: [] },
        status: "failed",
        executedAt: Date.now(),
        executorId: this.id,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

/** Portfolio pricing helper over a reference-price map. */
export function portfolioFromPrices(
  referencePrices: Record<string, number>,
  positions: PortfolioSnapshot["positions"] = [],
  dayPnlUsd = 0,
  equityUsd = 0,
): PortfolioSnapshot {
  return { positions, dayPnlUsd, equityUsd, referencePrices };
}
