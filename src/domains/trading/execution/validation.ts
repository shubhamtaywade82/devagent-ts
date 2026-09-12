/**
 * Deterministic validation (review item 30, stage 2).
 *
 * Pure functions: no I/O, no model, no exchange. The proposal's numbers
 * are re-checked from scratch — the LLM's claim that "quantity is valid"
 * is worth nothing here.
 */

import type { TradingProposal, ValidationVerdict } from "./types.js";

const SYMBOL_RE = /^[A-Z0-9]{2,20}([\-/][A-Z0-9]{2,10})?$/;

export function validateProposal(proposal: TradingProposal): ValidationVerdict {
  const errors: string[] = [];

  if (!proposal || typeof proposal !== "object") {
    return { valid: false, errors: ["proposal must be an object"] };
  }

  const symbol = String(proposal.symbol ?? "").trim().toUpperCase();
  if (!symbol) errors.push("symbol is required");
  else if (!SYMBOL_RE.test(symbol)) errors.push(`symbol "${symbol}" is not a valid trading symbol`);

  const market = proposal.market;
  if (market !== "spot" && market !== "futures") {
    errors.push(`market must be "spot" or "futures" (got "${market}")`);
  }

  const side = proposal.side;
  if (side !== "buy" && side !== "sell") {
    errors.push(`side must be "buy" or "sell" (got "${side}")`);
  }

  const quantity = Number(proposal.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    errors.push(`quantity must be a positive finite number (got ${proposal.quantity})`);
  }
  if (Number.isFinite(quantity) && quantity > 1_000_000) {
    errors.push(`quantity ${quantity} exceeds the hard sanity ceiling (1,000,000 units)`);
  }

  const limitPrice = proposal.limitPrice !== undefined ? Number(proposal.limitPrice) : undefined;
  if (limitPrice !== undefined && (!Number.isFinite(limitPrice) || limitPrice <= 0)) {
    errors.push(`limitPrice must be a positive finite number when present (got ${proposal.limitPrice})`);
  }

  const stopPrice = proposal.stopPrice !== undefined ? Number(proposal.stopPrice) : undefined;
  if (stopPrice !== undefined && (!Number.isFinite(stopPrice) || stopPrice <= 0)) {
    errors.push(`stopPrice must be a positive finite number when present (got ${proposal.stopPrice})`);
  }

  const takeProfitPrice =
    proposal.takeProfitPrice !== undefined ? Number(proposal.takeProfitPrice) : undefined;
  if (takeProfitPrice !== undefined && (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0)) {
    errors.push(`takeProfitPrice must be a positive finite number when present (got ${proposal.takeProfitPrice})`);
  }

  // directional sanity: a buy's stop must be below its limit; a sell's above
  if (limitPrice !== undefined && stopPrice !== undefined) {
    if (side === "buy" && stopPrice >= limitPrice) {
      errors.push(`buy stop ${stopPrice} must be BELOW limit/entry ${limitPrice}`);
    }
    if (side === "sell" && stopPrice <= limitPrice) {
      errors.push(`sell stop ${stopPrice} must be ABOVE limit/entry ${limitPrice}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    normalized: {
      ...proposal,
      symbol,
      market: market as TradingProposal["market"],
      side: side as TradingProposal["side"],
      quantity,
      limitPrice,
      stopPrice,
      takeProfitPrice,
      proposedAt: proposal.proposedAt ?? Date.now(),
    },
  };
}
