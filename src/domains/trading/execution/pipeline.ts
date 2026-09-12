/**
 * TradingExecutionPipeline (review item 30) — LLM proposal
 *   → deterministic validation
 *   → risk engine
 *   → execution policy (mode)
 *   → executor (paper / shadow / live)
 *
 * The LLM is NEVER the authoritative risk/execution layer: it produces a
 * TradingProposal (advisory), and this pipeline — deterministic at every
 * stage — decides whether and how it executes. Every stage's verdict is
 * carried on the ExecutionRecord for audit.
 */

import { validateProposal } from "./validation.js";
import { TradingRiskEngine, DEFAULT_RISK_LIMITS } from "./risk-engine.js";
import {
  executionPolicyFor,
  NoRoutingExecutor,
  PaperOrderExecutor,
  ShadowOrderExecutor,
  LiveOrderExecutor,
  type TradingExecutor,
} from "./executors.js";
import type {
  ExecutionRecord,
  PortfolioSnapshot,
  RiskLimits,
  TradingDecision,
  TradingExecutionMode,
  TradingProposal,
} from "./types.js";
import type { PaperTradingManager } from "../paper-trading.js";

export interface TradingExecutionPipelineOptions {
  mode: TradingExecutionMode;
  /** Operator-configured risk limits (defaults are small + safe). */
  limits?: RiskLimits;
  /** Paper ledger (required for paper mode). */
  paper?: PaperTradingManager;
  /** Live price lookup (required for shadow mode pricing). */
  priceOf?: (symbol: string) => number | undefined;
  /** Live venue adapter (required for live mode — products wire this). */
  venue?: { submitOrder(p: TradingProposal): Promise<{ fillPrice: number; orderId: string }>; venueId: string };
  /** Human confirmation already granted for a live order. */
  confirmed?: boolean;
  /** Callback on every decision (audit/telemetry — review item 33). */
  onDecision?: (record: ExecutionRecord) => void;
}

export class TradingExecutionPipeline {
  private readonly riskEngine: TradingRiskEngine;
  private readonly mode: TradingExecutionMode;
  private readonly executor: TradingExecutor;
  private readonly onDecision?: (record: ExecutionRecord) => void;

  constructor(private readonly opts: TradingExecutionPipelineOptions) {
    this.mode = opts.mode;
    this.riskEngine = new TradingRiskEngine(opts.limits ?? DEFAULT_RISK_LIMITS);
    this.onDecision = opts.onDecision;

    const policy = executionPolicyFor(opts.mode);
    switch (opts.mode) {
      case "research":
      case "backtest":
        this.executor = new NoRoutingExecutor(opts.mode);
        break;
      case "paper":
        if (!opts.paper) throw new Error("paper mode requires a PaperTradingManager");
        this.executor = new PaperOrderExecutor(opts.paper);
        break;
      case "shadow":
        this.executor = new ShadowOrderExecutor(opts.priceOf ?? (() => undefined));
        break;
      case "live":
        if (!opts.venue) {
          throw new Error(
            "live mode requires a configured LiveVenueAdapter — live trading is wired by the product, never by the agent",
          );
        }
        this.executor = new LiveOrderExecutor(opts.venue, {
          requiresConfirmation: policy.requiresHumanConfirmation,
          confirmed: opts.confirmed,
        });
        break;
    }
  }

  get executionMode(): TradingExecutionMode {
    return this.mode;
  }

  get riskLimits(): RiskLimits {
    return this.riskEngine.configuredLimits;
  }

  /**
   * Run one proposal through the full pipeline. The result is ALWAYS an
   * ExecutionRecord — rejected proposals included — so the audit trail is
   * complete even when nothing executed.
   */
  async submit(proposal: TradingProposal, portfolio: PortfolioSnapshot): Promise<ExecutionRecord> {
    // stage 2: deterministic validation
    const validation = validateProposal(proposal);
    if (!validation.valid || !validation.normalized) {
      return this.finish({
        proposal,
        decision: {
          approved: false,
          mode: this.mode,
          reason: "validation failed",
          requiresHumanConfirmation: false,
        },
        risk: { approved: false, reasons: validation.errors, checks: [] },
        status: "rejected",
        error: validation.errors.join("; "),
      });
    }
    const normalized = validation.normalized;

    // stage 3: deterministic risk engine
    const risk = this.riskEngine.assess(normalized, portfolio);
    if (!risk.approved) {
      return this.finish({
        proposal: normalized,
        decision: {
          approved: false,
          mode: this.mode,
          reason: "risk limits",
          requiresHumanConfirmation: false,
        },
        risk,
        status: "rejected",
        error: risk.reasons.join("; "),
      });
    }

    // stage 4: mode-aware execution policy
    const policy = executionPolicyFor(this.mode);
    const decision: TradingDecision = {
      approved: policy.routingAllowed,
      mode: this.mode,
      reason: policy.description,
      requiresHumanConfirmation: policy.requiresHumanConfirmation,
    };
    if (!policy.routingAllowed) {
      return this.finish({
        proposal: normalized,
        decision,
        risk,
        status: this.mode === "shadow" ? "recorded" : "rejected",
        error: `mode "${this.mode}" does not route orders`,
      });
    }

    // stage 5: executor
    try {
      const record = await this.executor.execute(normalized, decision);
      return this.finish({ ...record, risk });
    } catch (e) {
      return this.finish({
        proposal: normalized,
        decision,
        risk,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private finish(record: ExecutionRecord): ExecutionRecord {
    this.onDecision?.(record);
    return record;
  }
}
