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
tags: [binance, crypto, futures, technical-analysis, trading, trading-setup, quant-research, backtesting]
compatibility: >
  Requires the binance_* tools registered on the agent
  (src/tools/binance-tools.ts, src/tools/backtest-tools.ts,
  src/tools/paper-trading-tools.ts).
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
- `binance_liquidations` — live futures liquidation feed (`subscribe`,
  then `list` after a few seconds to see what's buffered).
- `binance_backtest` — test a rule-based strategy (entry conditions +
  stop/target) against real historical klines. Returns trade log,
  win rate, expectancy, profit factor, max drawdown. This is how a
  hypothesis gets *proven*, not asserted.
- `binance_walk_forward` — same strategy run across sequential time
  windows independently; checks whether the edge is stable across
  regimes or was a one-window fluke. Reports per-window expectancy
  and a stability score.
- `binance_monte_carlo` — bootstrap-resamples the backtest's trade
  sequence thousands of times; reports median/p5/p95 return and
  probability of a net loss. A wide p5–p95 spread means the historical
  result isn't robust even if it looked good.
- `binance_param_sweep` — grid search over strategy parameters (NOT
  Bayesian optimization — plain grid search, honest for a search space
  this small). A narrow spike surrounded by poor neighbors = fragile
  (overfit); a broad plateau of decent results = robust.
- `binance_paper_trade` — track a validated hypothesis forward against
  live prices (open/list/close simulated positions). Never touches a
  real exchange, no keys, no real money — this is forward-testing, not
  execution.

## Not available — say so, don't fake it

- **Order execution against a real exchange / real account data** — not
  implemented and won't be added without the user separately
  authorizing trade-permissioned API keys. This agent can research and
  paper-trade only.
- **Bayesian optimization** — substituted with grid search
  (`binance_param_sweep`); say so if the user specifically asked for
  Bayesian methods, don't imply it's the same thing.

## Research loop

Applies whenever the user asks for a "strategy" or an "edge" — a quick
"what's the RSI" question doesn't need the full loop, use judgment.
Walk through these stages explicitly (as one agent adopting each lens
in sequence — this agent is single, tool-first, not a multi-agent
system; "act as the statistician now, then the critic" is a discipline
device, not a literal handoff):

1. **Observe** (data scientist lens) — pull indicators + order book +
   funding/OI/liquidations for the symbol. Two timeframes minimum for
   a real read — note if only one was pulled.
2. **Form a hypothesis** (hypothesis generator lens) — a specific,
   falsifiable, testable claim (e.g. "RSI<30 crossing back above 30
   while funding is negative precedes a >1% move within 24 candles on
   BTCUSDT 1h"), not a vague vibe. A claim that can't be phrased as
   entry conditions can't be tested — rephrase it until it can.
3. **Validate — actually test it** (statistician lens): convert the
   hypothesis into a `binance_backtest` strategy config and run it on
   real history. An untested hypothesis is not evidence, no matter how
   plausible it sounds. Then:
   - `binance_walk_forward` — is expectancy consistent across time
     windows, or did one lucky window carry the whole result?
   - `binance_monte_carlo` — is the result robust to trade-order
     luck, or does it fall apart under resampling (wide p5–p95,
     high probability of loss)?
   - `binance_param_sweep` — is the result a narrow spike (fragile,
     likely overfit) or a broad plateau (robust to small parameter
     changes)?
4. **Self-criticism** (critic lens) — actively try to disprove the
   result before presenting it:
   - Sample size: how many trades did the backtest produce? Under ~20
     trades, say so — a hypothesis is unconfirmed, not validated.
   - Look-ahead bias: does any condition reference information not
     actually available at that candle (e.g. the period's own high/low
     used to enter within the same period)?
   - Regime dependence: did `binance_walk_forward` show the edge only
     in one time window?
   - Parameter sensitivity: did `binance_param_sweep` show a spike or
     a plateau?
   - Execution realism: did the backtest fee (`feeBps`) reflect real
     round-trip cost? A thin edge that only survives at 0 fees isn't
     real.
   - If any of these fail, say the hypothesis is rejected or weak —
     do not present it as a setup anyway.
5. **Only then, a setup** — a hypothesis that survived steps 3-4 (not
   before):
   - Direction: long / short
   - Entry zone: tied to a real level (Bollinger band, SMA/EMA, recent
     swing) — not an arbitrary number
   - Invalidation (stop): the level that proves the thesis wrong
   - Target(s) with R:R computed from entry/stop/target
   - Cite the backtest evidence: trade count, win rate, expectancy,
     max drawdown, walk-forward stability, Monte Carlo p5/p95 —
     numbers, not adjectives
   - Position sizing note: risk-based ("risk 0.5-1% of account to the
     stop distance"), never a fixed size
   - What would flip this call
6. **Forward-test, don't stop at backtest** (portfolio manager lens) —
   offer to track the validated setup with `binance_paper_trade`
   (open a simulated position at the live price) rather than treating
   the backtest as the final word. Backtest performance on past data
   and live forward performance are different questions.

An answer that skips straight to a "setup" without a `binance_backtest`
call backing it is not this skill's output — it's exactly the
"eyeballed" answer this skill exists to prevent.

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
