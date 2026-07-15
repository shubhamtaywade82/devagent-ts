---
name: crypto-futures-ta
description: >
  Use when the user asks for technical analysis, a trading setup, a
  "strategy", a market "edge", entry/exit levels, or a trade idea on a
  crypto symbol (spot or futures) backed by Binance data. Triggers for:
  "technical analysis for X", "trading setup", "find an edge", "build a
  strategy", "should I long or short X", "SOLUSDT/BTCUSDT strategy",
  funding/open-interest/long-short-ratio reads, order-book/order-flow
  reads. Enforces a discover-the-edge-first research process instead of
  jumping straight to a strategy.
tags: [binance, crypto, futures, technical-analysis, trading, trading-setup, quant-research]
compatibility: >
  Requires the binance_public_api, binance_technical_indicators,
  binance_order_book, binance_futures_stats, and binance_screener tools
  registered on the agent (src/tools/binance-tools.ts).
---

# Crypto Futures Research & Technical Analysis

## The objective is not a strategy

The objective is to discover a statistically significant, repeatable
market behavior — a strategy is just the implementation of an already-
discovered edge. Never respond to "build me a strategy" by writing
entry/exit rules directly. First establish: what pattern is claimed,
what evidence supports it, how strong is that evidence given the data
actually pulled this turn. Only convert a pattern into a concrete setup
once that evidence is stated.

If the user asks for "a profitable strategy" with no data pulled yet,
treat that as a request to *start the research loop below*, not a
request for boilerplate EMA-cross rules.

## Ground rule: no invented market facts

Every number and every market claim in the output must trace back to a
tool call made *this turn*. Never estimate, round from memory, or
eyeball raw kline/depth JSON by hand — `binance_technical_indicators`
already computes SMA/EMA/RSI/MACD/Bollinger deterministically; use it
instead of reading candle arrays. If a tool call fails or data is
insufficient, say so and either pull more data or state the limitation
— never fill the gap with a plausible-sounding guess.

State the evidence chain explicitly: **Observation → Evidence →
Hypothesis → Confluence check → Setup (only if confluence supports it)**.
If a link is missing (no supporting data pulled), do not produce a
directional call — say what's missing instead.

## Actual available tools (do not invent others)

Confirmed registered on this agent — use these, not a hypothetical
broader toolset:

- `binance_technical_indicators` — SMA20/EMA20/RSI14/MACD/Bollinger from
  klines. Any market/interval.
- `binance_order_book` — bid/ask volume + imbalance.
- `binance_futures_stats` — current mark price, funding rate, open
  interest (single latest snapshot, USD-M futures only).
- `binance_screener` — RSI oversold/overbought scan across a symbol list.
- `binance_watch_price` / `binance_unwatch_price` / `binance_price_alert`
  — live WebSocket ticker + threshold alerts.
- `binance_public_api` — generic GET escape hatch for anything not
  wrapped above. Useful for:
  - `/api/v3/trades`, `/api/v3/aggTrades` (spot recent trades)
  - `/fapi/v1/fundingRate` (funding rate *history*, not just latest)
  - `/futures/data/openInterestHist` (open interest history, usdm)
  - `/futures/data/globalLongShortAccountRatio`,
    `/futures/data/topLongShortPositionRatio`,
    `/futures/data/takerlongshortRatio` (positioning/crowding history,
    usdm)
  All are public, GET-only, no API key. Pass `market`, `path`, `params`.

## Not available — say so, don't fake it

If the research would benefit from these, say explicitly that the data
isn't available rather than approximating it:

- **Aggregate market liquidations** — Binance only exposes this as a
  public WebSocket stream (`!forceOrder@arr`), not wrapped by any tool
  here yet.
- **Backtesting / walk-forward / Monte Carlo / parameter-sensitivity
  testing** — no historical simulation engine exists in this agent.
  Any "expectancy" or "win rate" claim without one is an *untested
  hypothesis*, not a validated result — label it as such.
- **Order execution, account data, paper trading** — not implemented;
  this agent is read-only market data, it cannot place or simulate
  orders.

## Research loop

1. **Observe** — pull indicators + order book + (if futures) funding/OI
   for the symbol in question. Two timeframes minimum for a real read
   (e.g. 1h structure, 15m trigger) — note if only one was pulled.
2. **Form a hypothesis** — state a specific, falsifiable claim (e.g.
   "RSI<30 + positive bid imbalance + negative funding co-occurring
   suggests short-covering pressure"), not a vague vibe.
3. **Check confluence** — count how many of (structure, momentum,
   volatility, order-flow, positioning) actually agree with the
   hypothesis on the data pulled. State the count explicitly (e.g.
   "3/5 bullish"). This *is* the edge estimate for this turn — never
   claim "high probability" without showing it.
4. **Self-criticism** — before presenting a setup, check: is this
   conclusion drawn from a single snapshot (small sample, could be
   noise) or from history (fundingRate/openInterestHist pulled across
   multiple periods)? A single-snapshot read is weaker evidence than a
   pattern repeated across several periods — say which one this is.
5. **Only then, a setup** (if confluence and evidence are strong
   enough — otherwise say "no qualifying setup, evidence is mixed" and
   stop):
   - Direction: long / short
   - Entry zone: tied to a real level (Bollinger band, SMA/EMA, recent
     swing) — not an arbitrary number
   - Invalidation (stop): the level that proves the thesis wrong
   - Target(s) with R:R computed from entry/stop/target
   - Position sizing note: risk-based ("risk 0.5-1% of account to the
     stop distance"), never a fixed size
   - What would flip this call

## Discipline

- Funding rate and open interest/positioning ratios are
  sentiment/crowding signals, not entry triggers alone — extreme
  positive funding + bearish technicals is a stronger case than either
  alone.
- No claim of "edge", "high probability", or "statistically
  significant" without stating what evidence backs it and how many
  data points/periods it was observed over.
- This is data-driven scenario analysis from live market data, not a
  validated backtested strategy and not financial advice — say once,
  briefly.
