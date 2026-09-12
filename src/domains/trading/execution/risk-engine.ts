/**
 * RiskEngine (review item 30, stage 3) — deterministic, operator-configured.
 *
 * The LLM is never the authoritative risk layer: this engine prices the
 * order, checks it against the configured limits, and answers with an
 * auditable pass/fail per check. Limits come from configuration; the
 * proposal's own claims about risk are advisory input only.
 */

import type { PortfolioSnapshot, RiskAssessment, RiskLimits, TradingProposal } from "./types.js";

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxOrderNotionalUsd: 100,
  maxTotalExposureUsd: 1_000,
  maxDailyLossUsd: 50,
  requireStopLoss: true,
  minStopDistancePct: 0.005,
  maxLeverage: 2,
  maxPositionsPerSymbol: 1,
};

export class TradingRiskEngine {
  constructor(private readonly limits: RiskLimits = DEFAULT_RISK_LIMITS) {}

  get configuredLimits(): RiskLimits {
    return { ...this.limits };
  }

  assess(proposal: TradingProposal, portfolio: PortfolioSnapshot): RiskAssessment {
    const checks: Array<{ id: string; passed: boolean; detail: string }> = [];
    const reference = portfolio.referencePrices[proposal.symbol] ?? proposal.limitPrice ?? 0;
    const notionalUsd = reference > 0 ? reference * proposal.quantity : undefined;

    // 1. symbol allowlist
    if (this.limits.allowedSymbols && this.limits.allowedSymbols.length > 0) {
      const allowed = this.limits.allowedSymbols.includes(proposal.symbol);
      checks.push({
        id: "symbol-allowlist",
        passed: allowed,
        detail: allowed ? `${proposal.symbol} is allowlisted` : `${proposal.symbol} is NOT in the configured allowlist`,
      });
    }

    // 2. per-order notional cap
    if (notionalUsd !== undefined) {
      const passed = notionalUsd <= this.limits.maxOrderNotionalUsd;
      checks.push({
        id: "order-notional",
        passed,
        detail: `order notional $${notionalUsd.toFixed(2)} vs cap $${this.limits.maxOrderNotionalUsd}`,
      });
    } else {
      checks.push({
        id: "reference-price",
        passed: false,
        detail: `no reference price for ${proposal.symbol} and no limit price — cannot size the order`,
      });
    }

    // 3. total exposure cap (existing exposure + this order)
    const existingExposure = portfolio.positions.reduce(
      (sum, p) => sum + Math.abs(p.netQuantity) * (portfolio.referencePrices[p.symbol] ?? p.entryPrice),
      0,
    );
    if (notionalUsd !== undefined) {
      const total = existingExposure + notionalUsd;
      const passed = total <= this.limits.maxTotalExposureUsd;
      checks.push({
        id: "total-exposure",
        passed,
        detail: `total exposure $${total.toFixed(2)} vs cap $${this.limits.maxTotalExposureUsd}`,
      });
    }

    // 4. daily loss circuit breaker
    const lossPassed = portfolio.dayPnlUsd > -this.limits.maxDailyLossUsd;
    checks.push({
      id: "daily-loss",
      passed: lossPassed,
      detail: `day PnL $${portfolio.dayPnlUsd.toFixed(2)} vs loss floor -$${this.limits.maxDailyLossUsd}`,
    });

    // 5. stop-loss requirement + minimum distance
    if (this.limits.requireStopLoss) {
      const hasStop = proposal.stopPrice !== undefined && Number.isFinite(proposal.stopPrice);
      checks.push({
        id: "stop-required",
        passed: hasStop,
        detail: hasStop ? "stop-loss present" : "stop-loss is required by configuration",
      });
      if (hasStop && reference > 0) {
        const distance = Math.abs(reference - proposal.stopPrice!) / reference;
        const passed = distance >= this.limits.minStopDistancePct;
        checks.push({
          id: "stop-distance",
          passed,
          detail: `stop distance ${(distance * 100).toFixed(3)}% vs min ${(this.limits.minStopDistancePct * 100).toFixed(3)}%`,
        });
      }
    }

    // 6. leverage cap
    if (portfolio.equityUsd > 0 && notionalUsd !== undefined) {
      const impliedLeverage = (existingExposure + notionalUsd) / portfolio.equityUsd;
      const passed = impliedLeverage <= this.limits.maxLeverage;
      checks.push({
        id: "leverage",
        passed,
        detail: `implied leverage ${impliedLeverage.toFixed(2)}x vs cap ${this.limits.maxLeverage}x`,
      });
    }

    // 7. per-symbol position cap
    const symbolPositions = portfolio.positions.filter((p) => p.symbol === proposal.symbol).length;
    const netQty = portfolio.positions
      .filter((p) => p.symbol === proposal.symbol)
      .reduce((sum, p) => sum + p.netQuantity, 0);
    const sameDirection = (proposal.side === "buy" && netQty >= 0) || (proposal.side === "sell" && netQty <= 0);
    const capPassed = !sameDirection || symbolPositions < this.limits.maxPositionsPerSymbol;
    checks.push({
      id: "position-cap",
      passed: capPassed,
      detail: `${symbolPositions} net ${sameDirection ? "same-direction" : "offsetting"} positions in ${proposal.symbol} vs cap ${this.limits.maxPositionsPerSymbol}`,
    });

    const failed = checks.filter((c) => !c.passed);
    return {
      approved: failed.length === 0,
      reasons: failed.map((c) => `${c.id}: ${c.detail}`),
      notionalUsd,
      checks,
    };
  }
}
