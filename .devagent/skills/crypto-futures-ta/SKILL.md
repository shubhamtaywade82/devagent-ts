---
name: crypto-futures-ta
description: >
  Use when the user asks for technical analysis, a trading setup, an
  "edge", entry/exit levels, or a trade idea on a crypto symbol (spot
  or futures) backed by Binance data. Triggers for: "technical
  analysis for X", "trading setup", "find an edge", "should I long or
  short X", "SOLUSDT/BTCUSDT strategy", futures funding/open-interest
  reads, order-book/order-flow reads. Produces a structured,
  institutional-desk-style analysis from real tool output, not
  freehand commentary.
tags: [binance, crypto, futures, technical-analysis, trading, trading-setup]
compatibility: >
  Requires the binance_technical_indicators, binance_order_book,
  binance_futures_stats, and binance_screener tools registered on the
  agent (src/tools/binance-tools.ts).
---

# Crypto Futures Technical Analysis

## Ground rule

Every number in the output must come from a tool call made *this turn*.
Never estimate, round from memory, or eyeball raw kline/depth JSON by
hand — `binance_technical_indicators` already computes SMA/EMA/RSI/MACD/
Bollinger deterministically; use it instead of reading candle arrays.
If a tool call fails or returns an error, say so — don't fill the gap
with a plausible-sounding guess.

## Data to pull

For a full setup on `SYMBOL`, call in this order (parallelize where the
agent supports it):

1. `binance_technical_indicators` — spot, interval `1h` for swing bias,
   `15m` for entry timing. All indicators, `limit >= 100`.
2. `binance_order_book` — `limit: 50` or `100`. Read `imbalance` for
   near-term order-flow bias.
3. `binance_futures_stats` — only if the user means futures/perp
   (funding rate, open interest). Skip for a pure spot question.
4. `binance_screener` — only if comparing against other symbols or the
   user didn't name one.

Use two timeframes minimum (e.g. 1h for structure, 15m for trigger) —
single-timeframe reads produce lower-confidence setups; say so if only
one timeframe was pulled.

## Output structure

Always answer in this shape, institutional-desk style — terse, numeric,
no hedging filler:

**1. Market structure** — trend direction from price vs SMA20/EMA20 on
the higher timeframe. State it as a fact from the numbers, not vibes.

**2. Momentum** — RSI14 reading (oversold <30 / neutral 30-70 /
overbought >70) and MACD state (line vs signal, histogram
direction/sign = momentum accelerating or decaying).

**3. Volatility** — price position relative to Bollinger bands (near
upper/lower/mid), band width if it matters (wide = trending, tight =
squeeze setup).

**4. Order flow** — order-book imbalance sign/magnitude; funding rate
sign (positive = longs paying shorts, crowded long; negative = crowded
short) and open interest level if futures data was pulled.

**5. Confluence** — count how many of (structure, momentum, volatility,
order-flow) agree on direction. State the count explicitly (e.g. "3/4
bullish"). This *is* the edge estimate — don't claim "high probability"
without showing the confluence count that backs it.

**6. Trade setup** (only if confluence >= 3/4; otherwise say "no
qualifying setup" and stop here):
   - Direction: long / short
   - Entry zone: specific price level or range, tied to a real level
     (Bollinger band, SMA/EMA, recent swing) — not an arbitrary number
   - Invalidation (stop): the level that proves the thesis wrong
   - Target(s): next structural level, with R:R computed from
     entry/stop/target (state the ratio, e.g. "R:R ≈ 1:2.3")
   - Position sizing note: risk-based, not fixed-size ("risk 0.5-1% of
     account to the stop distance above")

**7. Invalidation / no-trade conditions** — what would flip this call
(e.g. "if RSI breaks above 70 before entry, thesis is stale, re-pull
data").

## Discipline

- No setup is "guaranteed" or "high probability" without the confluence
  count shown. If confluence is 2/4 or lower, say the market is mixed
  and do not manufacture a directional call.
- Funding rate and open interest are sentiment/crowding signals, not
  entry triggers on their own — extreme positive funding + bearish
  technicals is a stronger short case than either alone.
- Always timestamp implicitly by stating the interval/limit pulled, so
  the user knows how fresh the read is.
- This is data-driven scenario analysis, not financial advice — say so
  once, briefly, don't repeat it every section.
