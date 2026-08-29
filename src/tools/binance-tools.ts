import { Tool } from "./tool.js";
import { ema, rsi, macd, bollingerBands, sma } from "./indicators.js";
import { BinanceStreamManager, AlertCondition } from "../exchange/binance-stream.js";

export function normalizeMarket(rawMarket?: string): string {
  if (!rawMarket) return "spot";
  const m = rawMarket.toLowerCase().trim();
  if (m === "futures" || m === "usdt" || m === "usdt-m" || m === "usdtm" || m === "perpetual" || m === "fapi")
    return "usdm";
  if (m === "coin" || m === "coin-m" || m === "coinm" || m === "dapi") return "coinm";
  return m;
}

const MARKETS: Record<string, { base: string; prefixes: string[] }> = {
  spot: { base: "https://api.binance.com", prefixes: ["/api/v3/"] },
  usdm: { base: "https://fapi.binance.com", prefixes: ["/fapi/v1/", "/fapi/v2/", "/futures/data/"] },
  coinm: { base: "https://dapi.binance.com", prefixes: ["/dapi/v1/"] },
};

const KLINES_PATH: Record<string, string> = {
  spot: "/api/v3/klines",
  usdm: "/fapi/v1/klines",
  coinm: "/dapi/v1/klines",
};

async function fetchBinance(
  rawMarket: string,
  path: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const market = normalizeMarket(rawMarket);
  const config = MARKETS[market];
  if (!config) {
    return {
      error: "InvalidMarket",
      message: `market must be one of: ${Object.keys(MARKETS).join(", ")} (aliases: futures, usdt, coin)`,
    };
  }
  if (!config.prefixes.some((prefix) => path.startsWith(prefix))) {
    return {
      error: "InvalidPath",
      message: `path for market '${market}' must start with one of: ${config.prefixes.join(", ")}`,
    };
  }

  const url = new URL(path, config.base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  try {
    const response = await fetch(url, { method: "GET" });
    const body = await response.json();
    if (!response.ok) return { error: "BinanceApiError", status: response.status, body };
    return { status: response.status, body };
  } catch (e) {
    return { error: "RequestError", message: (e as Error).message };
  }
}

// ponytail: GET-only + no API key ever sent, so this is structurally incapable of
// trading/account access regardless of path — no need for a per-endpoint allowlist.
export class BinancePublicApiTool extends Tool {
  get name(): string {
    return "binance_public_api";
  }

  get description(): string {
    return (
      "GET a public Binance REST API endpoint (no auth) — market data, tickers, order book, " +
      "klines, exchange info. market: 'spot' (api.binance.com, paths under /api/v3/), " +
      "'usdm' (USD-M futures, fapi.binance.com, /fapi/v1|v2/), 'coinm' (COIN-M futures, " +
      "dapi.binance.com, /dapi/v1/). Example path: /api/v3/ticker/price?symbol=BTCUSDT."
    );
  }

  get tags(): string[] {
    return ["binance", "market-data", "http"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        market: { type: "string", enum: Object.keys(MARKETS), description: "Which Binance API to hit (default spot)" },
        path: { type: "string", description: "Endpoint path, e.g. /api/v3/klines" },
        params: { type: "object", description: "Query string parameters, e.g. { symbol: 'BTCUSDT', interval: '1h' }" },
      },
      required: ["path"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const market = typeof args.market === "string" ? args.market : "spot";
    const path = String(args.path ?? "");
    const params = args.params && typeof args.params === "object" ? (args.params as Record<string, unknown>) : {};
    return fetchBinance(market, path, params);
  }
}

const ALL_INDICATORS = ["sma", "ema", "rsi", "macd", "bollinger"] as const;

// ponytail: models don't reliably respect the enum casing/spelling in the schema
// ("SMA20", "BB", "MACD" all showed up in practice) — normalize aliases at the
// trust boundary instead of silently returning {} for anything that doesn't match.
const INDICATOR_ALIASES: Record<string, string> = {
  sma: "sma",
  sma20: "sma",
  ema: "ema",
  ema20: "ema",
  rsi: "rsi",
  rsi14: "rsi",
  macd: "macd",
  bollinger: "bollinger",
  bollingerbands: "bollinger",
  bb: "bollinger",
  bb20: "bollinger",
};

function normalizeIndicators(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length === 0) return ALL_INDICATORS;
  const normalized = input
    .map(
      (v) =>
        INDICATOR_ALIASES[
          String(v)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
        ],
    )
    .filter((v): v is string => Boolean(v));
  return normalized.length > 0 ? [...new Set(normalized)] : ALL_INDICATORS;
}

export class BinanceTechnicalIndicatorsTool extends Tool {
  get name(): string {
    return "binance_technical_indicators";
  }

  get description(): string {
    return (
      "Fetch recent Binance klines (candles) and compute technical indicators from closing " +
      "prices — SMA(20), EMA(20), RSI(14), MACD(12,26,9), Bollinger Bands(20,2). Deterministic " +
      "math, not an LLM guess from raw candle numbers. Use this instead of eyeballing klines for trend/momentum questions."
    );
  }

  get tags(): string[] {
    return ["binance", "market-data", "technical-analysis", "indicators"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string", description: "e.g. BTCUSDT, SOLUSDT" },
        market: { type: "string", enum: Object.keys(MARKETS), description: "Default spot" },
        interval: { type: "string", description: "Binance kline interval, e.g. 1m, 15m, 1h, 4h, 1d (default 1h)" },
        limit: { type: "number", description: "Number of candles to fetch, max 500 (default 100)" },
        indicators: {
          type: "array",
          items: { type: "string", enum: ALL_INDICATORS as unknown as string[] },
          description: "Which indicators to compute (default: all)",
        },
      },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const market = normalizeMarket(typeof args.market === "string" ? args.market : undefined);
    const symbol = String(args.symbol ?? "");
    const interval = typeof args.interval === "string" ? args.interval : "1h";
    const limit = Math.min(Number(args.limit ?? 100) || 100, 500);
    const wanted = new Set(normalizeIndicators(args.indicators));

    const path = KLINES_PATH[market];
    if (!path) {
      return { error: "InvalidMarket", message: `market must be one of: ${Object.keys(MARKETS).join(", ")}` };
    }

    const result = await fetchBinance(market, path, { symbol, interval, limit });
    if (result.error) return result;

    const rows = result.body as unknown[][];
    if (!Array.isArray(rows) || rows.length < 30) {
      return {
        error: "InsufficientData",
        message: `Need at least 30 candles for reliable indicators, got ${rows?.length ?? 0}. Increase limit.`,
      };
    }
    const closes = rows.map((row) => Number(row[4]));

    const indicators: Record<string, unknown> = {};
    if (wanted.has("sma")) indicators.sma20 = sma(closes, 20);
    if (wanted.has("ema")) indicators.ema20 = ema(closes, 20);
    if (wanted.has("rsi")) indicators.rsi14 = rsi(closes, 14);
    if (wanted.has("macd")) indicators.macd = macd(closes);
    if (wanted.has("bollinger")) indicators.bollinger = bollingerBands(closes, 20, 2);

    return { symbol, market, interval, candles: rows.length, lastClose: closes[closes.length - 1], indicators };
  }
}

const DEPTH_PATH: Record<string, string> = { spot: "/api/v3/depth", usdm: "/fapi/v1/depth", coinm: "/dapi/v1/depth" };

export class BinanceOrderBookTool extends Tool {
  get name(): string {
    return "binance_order_book";
  }

  get description(): string {
    return "Fetch the Binance order book for a symbol and compute bid/ask volume imbalance — positive means more buy pressure near the top of book.";
  }

  get tags(): string[] {
    return ["binance", "market-data", "order-book"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string", description: "e.g. BTCUSDT" },
        market: { type: "string", enum: Object.keys(MARKETS), description: "Default spot" },
        limit: { type: "number", description: "Depth of book to fetch: 5,10,20,50,100,500,1000 (default 50)" },
      },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const market = normalizeMarket(typeof args.market === "string" ? args.market : undefined);
    const symbol = String(args.symbol ?? "");
    const limit = Number(args.limit ?? 50) || 50;
    const path = DEPTH_PATH[market];
    if (!path) {
      return { error: "InvalidMarket", message: `market must be one of: ${Object.keys(MARKETS).join(", ")}` };
    }

    const result = await fetchBinance(market, path, { symbol, limit });
    if (result.error) return result;

    const body = result.body as { bids: [string, string][]; asks: [string, string][] };
    const bidVolume = body.bids.reduce((sum, [, qty]) => sum + Number(qty), 0);
    const askVolume = body.asks.reduce((sum, [, qty]) => sum + Number(qty), 0);
    const imbalance = (bidVolume - askVolume) / (bidVolume + askVolume);

    return {
      symbol,
      market,
      bestBid: body.bids[0]?.[0] ?? null,
      bestAsk: body.asks[0]?.[0] ?? null,
      bidVolume,
      askVolume,
      imbalance,
    };
  }
}

export class BinanceFuturesStatsTool extends Tool {
  get name(): string {
    return "binance_futures_stats";
  }

  get description(): string {
    return "Fetch USD-M futures funding rate and open interest for a symbol — sentiment/positioning signal, not available on spot.";
  }

  get tags(): string[] {
    return ["binance", "market-data", "futures", "funding-rate", "open-interest"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: { symbol: { type: "string", description: "e.g. BTCUSDT" } },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const symbol = String(args.symbol ?? "");
    const [premium, openInterest] = await Promise.all([
      fetchBinance("usdm", "/fapi/v1/premiumIndex", { symbol }),
      fetchBinance("usdm", "/fapi/v1/openInterest", { symbol }),
    ]);
    if (premium.error) return premium;
    if (openInterest.error) return openInterest;

    const p = premium.body as { markPrice: string; lastFundingRate: string; nextFundingTime: number };
    const oi = openInterest.body as { openInterest: string };
    return {
      symbol,
      markPrice: Number(p.markPrice),
      lastFundingRate: Number(p.lastFundingRate),
      nextFundingTime: p.nextFundingTime,
      openInterest: Number(oi.openInterest),
    };
  }
}

export class BinanceScreenerTool extends Tool {
  get name(): string {
    return "binance_screener";
  }

  get description(): string {
    return "Run RSI(14) across multiple symbols and flag oversold (<30) / overbought (>70) — quick multi-symbol momentum scan. Supports spot, usdm, and coinm markets.";
  }

  get tags(): string[] {
    return ["binance", "market-data", "technical-analysis", "screener"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
          description: 'e.g. ["BTCUSDT", "ETHUSDT", "SOLUSDT"], max 20',
        },
        market: { type: "string", enum: Object.keys(MARKETS), description: "Default spot" },
        interval: { type: "string", description: "Default 1h" },
      },
      required: ["symbols"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const symbols = (Array.isArray(args.symbols) ? args.symbols : []).slice(0, 20) as string[];
    if (symbols.length === 0) return { error: "InvalidSymbols", message: "symbols must be a non-empty array" };
    const market = normalizeMarket(typeof args.market === "string" ? args.market : undefined);
    const interval = typeof args.interval === "string" ? args.interval : "1h";
    const path = KLINES_PATH[market];
    if (!path) return { error: "InvalidMarket", message: `market must be one of: ${Object.keys(MARKETS).join(", ")}` };

    const results = await Promise.all(
      symbols.map(async (symbol) => {
        const result = await fetchBinance(market, path, { symbol, interval, limit: 100 });
        if (result.error) return { symbol, error: result.error, message: result.message };
        const rows = result.body as unknown[][];
        if (rows.length < 30) return { symbol, error: "InsufficientData" };
        const closes = rows.map((row) => Number(row[4]));
        const rsi14 = rsi(closes, 14);
        return {
          symbol,
          rsi14,
          lastClose: closes[closes.length - 1],
          signal: rsi14 < 30 ? "oversold" : rsi14 > 70 ? "overbought" : "neutral",
        };
      }),
    );

    return { market, interval, results };
  }
}

/** Structured OHLCV candle array — open, high, low, close, volume, timestamp. */
export class BinanceOhlcvTool extends Tool {
  get name(): string {
    return "binance_ohlcv";
  }

  get description(): string {
    return (
      "Fetch Binance klines as a structured OHLCV array (open, high, low, close, volume, openTime). " +
      "Use when you need raw candle data for custom analysis or backtesting — prefer " +
      "binance_technical_indicators when you just need standard TA outputs."
    );
  }

  get tags(): string[] {
    return ["binance", "market-data", "ohlcv", "candles"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string", description: "e.g. BTCUSDT" },
        market: { type: "string", enum: Object.keys(MARKETS), description: "Default spot" },
        interval: { type: "string", description: "Kline interval, e.g. 1m, 15m, 1h, 4h, 1d (default 1h)" },
        limit: { type: "number", description: "Number of candles, max 500 (default 100)" },
      },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const market = normalizeMarket(typeof args.market === "string" ? args.market : undefined);
    const symbol = String(args.symbol ?? "");
    const interval = typeof args.interval === "string" ? args.interval : "1h";
    const limit = Math.min(Number(args.limit ?? 100) || 100, 500);
    const path = KLINES_PATH[market];
    if (!path) return { error: "InvalidMarket", message: `market must be one of: ${Object.keys(MARKETS).join(", ")}` };

    const result = await fetchBinance(market, path, { symbol, interval, limit });
    if (result.error) return result;

    const rows = result.body as unknown[][];
    const candles = rows.map((row) => ({
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }));
    return { symbol, market, interval, count: candles.length, candles };
  }
}

/** Compute indicators for multiple timeframes in one call — saves N round-trips for MTF confluence. */
export class BinanceMultiTimeframeTool extends Tool {
  get name(): string {
    return "binance_multi_timeframe";
  }

  get description(): string {
    return (
      "Fetch technical indicators for multiple timeframes in a single call — essential for " +
      "multi-timeframe (MTF) confluence analysis. Returns SMA20, EMA20, RSI14, MACD, Bollinger " +
      "Bands for each requested interval. Saves N separate indicator calls."
    );
  }

  get tags(): string[] {
    return ["binance", "market-data", "technical-analysis", "multi-timeframe"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string", description: "e.g. BTCUSDT, SOLUSDT" },
        market: { type: "string", enum: Object.keys(MARKETS), description: "Default spot" },
        intervals: {
          type: "array",
          items: { type: "string" },
          description: 'List of intervals, e.g. ["15m", "1h", "4h"]. Max 5.',
        },
        limit: { type: "number", description: "Candles per interval, max 500 (default 200)" },
        indicators: {
          type: "array",
          items: { type: "string" },
          description:
            "Indicators to compute per interval (default: all). Same aliases as binance_technical_indicators.",
        },
      },
      required: ["symbol", "intervals"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const market = normalizeMarket(typeof args.market === "string" ? args.market : undefined);
    const symbol = String(args.symbol ?? "");
    const intervals = (Array.isArray(args.intervals) ? (args.intervals as string[]) : []).slice(0, 5);
    if (intervals.length === 0) return { error: "InvalidArgs", message: "intervals must be a non-empty array" };
    const limit = Math.min(Number(args.limit ?? 200) || 200, 500);
    const wanted = new Set(normalizeIndicators(args.indicators));
    const path = KLINES_PATH[market];
    if (!path) return { error: "InvalidMarket", message: `market must be one of: ${Object.keys(MARKETS).join(", ")}` };

    const results = await Promise.all(
      intervals.map(async (interval) => {
        const result = await fetchBinance(market, path, { symbol, interval, limit });
        if (result.error) return { interval, error: result.error };
        const rows = result.body as unknown[][];
        if (!Array.isArray(rows) || rows.length < 30)
          return { interval, error: "InsufficientData", got: rows?.length ?? 0 };
        const closes = rows.map((row) => Number(row[4]));
        const indicators: Record<string, unknown> = {};
        if (wanted.has("sma")) indicators.sma20 = sma(closes, 20);
        if (wanted.has("ema")) indicators.ema20 = ema(closes, 20);
        if (wanted.has("rsi")) indicators.rsi14 = rsi(closes, 14);
        if (wanted.has("macd")) indicators.macd = macd(closes);
        if (wanted.has("bollinger")) indicators.bollinger = bollingerBands(closes, 20, 2);
        return { interval, candles: rows.length, lastClose: closes[closes.length - 1], indicators };
      }),
    );

    return { symbol, market, timeframes: results };
  }
}

/** VWAP + volume distribution across price levels — spot and futures. */
export class BinanceVolumeTool extends Tool {
  get name(): string {
    return "binance_volume_analysis";
  }

  get description(): string {
    return (
      "Compute VWAP (volume-weighted average price) and a volume-by-price distribution from recent " +
      "klines. Useful for identifying high-volume nodes (support/resistance) and fair value."
    );
  }

  get tags(): string[] {
    return ["binance", "market-data", "volume", "vwap"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string", description: "e.g. BTCUSDT" },
        market: { type: "string", enum: Object.keys(MARKETS), description: "Default spot" },
        interval: { type: "string", description: "Kline interval (default 1h)" },
        limit: { type: "number", description: "Candles to use, max 500 (default 200)" },
        buckets: { type: "number", description: "Number of price-level buckets for distribution (default 10)" },
      },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const market = normalizeMarket(typeof args.market === "string" ? args.market : undefined);
    const symbol = String(args.symbol ?? "");
    const interval = typeof args.interval === "string" ? args.interval : "1h";
    const limit = Math.min(Number(args.limit ?? 200) || 200, 500);
    const buckets = Math.min(Math.max(Number(args.buckets ?? 10) || 10, 2), 50);
    const path = KLINES_PATH[market];
    if (!path) return { error: "InvalidMarket", message: `market must be one of: ${Object.keys(MARKETS).join(", ")}` };

    const result = await fetchBinance(market, path, { symbol, interval, limit });
    if (result.error) return result;

    const rows = result.body as unknown[][];
    if (!Array.isArray(rows) || rows.length < 2)
      return { error: "InsufficientData", message: "Need at least 2 candles" };

    // VWAP: sum(typical_price * volume) / sum(volume)
    let pvSum = 0;
    let volSum = 0;
    const highs: number[] = [];
    const lows: number[] = [];
    for (const row of rows) {
      const h = Number(row[2]);
      const l = Number(row[3]);
      const c = Number(row[4]);
      const v = Number(row[5]);
      const tp = (h + l + c) / 3;
      pvSum += tp * v;
      volSum += v;
      highs.push(h);
      lows.push(l);
    }
    const vwap = volSum > 0 ? pvSum / volSum : 0;

    // Volume-by-price distribution
    const priceMin = Math.min(...lows);
    const priceMax = Math.max(...highs);
    const bucketSize = (priceMax - priceMin) / buckets;
    const dist = Array.from({ length: buckets }, (_, i) => ({
      low: priceMin + i * bucketSize,
      high: priceMin + (i + 1) * bucketSize,
      volume: 0,
    }));
    for (const row of rows) {
      const tp = (Number(row[2]) + Number(row[3]) + Number(row[4])) / 3;
      const v = Number(row[5]);
      const idx = Math.min(Math.floor((tp - priceMin) / bucketSize), buckets - 1);
      if (idx >= 0) dist[idx].volume += v;
    }
    const pocIdx = dist.reduce((best, b, i) => (b.volume > dist[best].volume ? i : best), 0);

    return {
      symbol,
      market,
      interval,
      candles: rows.length,
      vwap: Math.round(vwap * 100) / 100,
      volumeByPrice: dist.map((b) => ({
        ...b,
        low: Math.round(b.low * 100) / 100,
        high: Math.round(b.high * 100) / 100,
        volume: Math.round(b.volume * 100) / 100,
      })),
      pointOfControl: { low: dist[pocIdx].low, high: dist[pocIdx].high, volume: dist[pocIdx].volume },
    };
  }
}

/** Funding rate history + long/short ratio for positioning context. */
export class BinanceFundingHistoryTool extends Tool {
  get name(): string {
    return "binance_funding_history";
  }

  get description(): string {
    return (
      "Fetch USD-M futures funding rate history and the global long/short ratio for a symbol. " +
      "Persistent positive funding = crowded longs; persistent negative = crowded shorts. " +
      "Combine with open interest and liquidation data for a full positioning picture."
    );
  }

  get tags(): string[] {
    return ["binance", "market-data", "futures", "funding-rate", "long-short-ratio"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string", description: "e.g. BTCUSDT" },
        limit: { type: "number", description: "Number of funding periods to return (default 20, max 100)" },
      },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const symbol = String(args.symbol ?? "");
    const limit = Math.min(Number(args.limit ?? 20) || 20, 100);

    const [fundingRes, lsrRes] = await Promise.all([
      fetchBinance("usdm", "/fapi/v1/fundingRate", { symbol, limit }),
      fetchBinance("usdm", "/futures/data/globalLongShortAccountRatio", { symbol, period: "1h", limit: 5 }),
    ]);

    const out: Record<string, unknown> = { symbol };

    if (!fundingRes.error) {
      const rows = fundingRes.body as Array<{ fundingTime: number; fundingRate: string }>;
      out.fundingHistory = rows.map((r) => ({ time: r.fundingTime, rate: Number(r.fundingRate) }));
      if (rows.length > 0) {
        const rates = rows.map((r) => Number(r.fundingRate));
        out.avgFundingRate = rates.reduce((a, b) => a + b, 0) / rates.length;
        out.lastFundingRate = rates[rates.length - 1];
      }
    } else {
      out.fundingError = fundingRes.error;
    }

    if (!lsrRes.error) {
      const rows = lsrRes.body as Array<{
        longShortRatio: string;
        longAccount: string;
        shortAccount: string;
        timestamp: number;
      }>;
      out.longShortRatio = rows.map((r) => ({
        time: r.timestamp,
        ratio: Number(r.longShortRatio),
        longPct: Number(r.longAccount),
        shortPct: Number(r.shortAccount),
      }));
    } else {
      out.longShortRatioError = lsrRes.error;
    }

    return out;
  }
}

/** Open interest history for USD-M futures — rising OI + rising price = momentum, divergence = warning. */
export class BinanceOpenInterestHistoryTool extends Tool {
  get name(): string {
    return "binance_open_interest_history";
  }

  get description(): string {
    return (
      "Fetch historical USD-M futures open interest (# contracts outstanding) for a symbol and period. " +
      "Rising OI + rising price = bullish momentum. Rising OI + falling price = bearish. " +
      "OI drops sharply = position squaring (potential reversal). " +
      "Combine with funding rate and LSR for a complete positioning picture."
    );
  }

  get tags(): string[] {
    return ["binance", "market-data", "futures", "open-interest"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string", description: "e.g. BTCUSDT, SOLUSDT" },
        period: {
          type: "string",
          enum: ["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"],
          description: "Aggregation period (default 1h)",
        },
        limit: { type: "number", description: "Number of periods to return (default 30, max 500)" },
      },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const symbol = String(args.symbol ?? "");
    const period = typeof args.period === "string" ? args.period : "1h";
    const limit = Math.min(Number(args.limit ?? 30) || 30, 500);

    const result = await fetchBinance("usdm", "/futures/data/openInterestHist", { symbol, period, limit });
    if (result.error) return result;

    const rows = result.body as Array<{
      symbol: string;
      sumOpenInterest: string;
      sumOpenInterestValue: string;
      timestamp: number;
    }>;
    const series = rows.map((r) => ({
      time: r.timestamp,
      openInterest: Number(r.sumOpenInterest),
      notionalValue: Number(r.sumOpenInterestValue),
    }));

    if (series.length < 2) return { symbol, period, series };

    const first = series[0].openInterest;
    const last = series[series.length - 1].openInterest;
    const changePct = ((last - first) / first) * 100;

    return { symbol, period, count: series.length, changePct: Math.round(changePct * 100) / 100, series };
  }
}

/** Spot vs futures price basis — premium = contango/bullish, discount = backwardation/bearish. */
export class BinanceFuturesBasisTool extends Tool {
  get name(): string {
    return "binance_futures_basis";
  }

  get description(): string {
    return (
      "Compare the USD-M futures mark price against the spot price for a symbol to compute the basis " +
      "(futures - spot) and basis percentage. A positive basis (premium) = contango, often bullish. " +
      "A negative basis (discount/backwardation) = bearish pressure or supply shock. " +
      "Combine with funding rate to distinguish structural from speculative premium."
    );
  }

  get tags(): string[] {
    return ["binance", "market-data", "futures", "basis", "arbitrage"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string", description: "e.g. BTCUSDT, SOLUSDT" },
      },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const symbol = String(args.symbol ?? "");

    const [spotRes, futuresRes] = await Promise.all([
      fetchBinance("spot", "/api/v3/ticker/price", { symbol }),
      fetchBinance("usdm", "/fapi/v1/premiumIndex", { symbol }),
    ]);

    if (spotRes.error) return { ...spotRes, context: "spot price fetch failed" };
    if (futuresRes.error) return { ...futuresRes, context: "futures price fetch failed" };

    const spotPrice = Number((spotRes.body as { price: string }).price);
    const f = futuresRes.body as { markPrice: string; lastFundingRate: string; nextFundingTime: number };
    const markPrice = Number(f.markPrice);
    const basis = markPrice - spotPrice;
    const basisPct = (basis / spotPrice) * 100;

    return {
      symbol,
      spotPrice,
      markPrice,
      basis: Math.round(basis * 10000) / 10000,
      basisPct: Math.round(basisPct * 10000) / 10000,
      lastFundingRate: Number(f.lastFundingRate),
      nextFundingTime: f.nextFundingTime,
      interpretation:
        basisPct > 0.05 ? "premium (contango)" : basisPct < -0.05 ? "discount (backwardation)" : "near parity",
    };
  }
}

abstract class BinanceStreamTool extends Tool {
  constructor(protected stream: BinanceStreamManager) {
    super();
  }

  get tags(): string[] {
    return ["binance", "market-data", "websocket", "real-time"];
  }
}

export class BinanceWatchPriceTool extends BinanceStreamTool {
  get name(): string {
    return "binance_watch_price";
  }

  get description(): string {
    return "Subscribe to a live Binance WebSocket ticker stream for a symbol and return the latest price. Supports spot and usdm (futures) markets. Call repeatedly to poll a live feed instead of re-fetching REST each time.";
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string", description: "e.g. BTCUSDT" },
        market: { type: "string", enum: ["spot", "usdm", "coinm"], description: "Default spot" },
      },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const symbol = String(args.symbol ?? "").toUpperCase();
    const market = normalizeMarket(typeof args.market === "string" ? args.market : undefined);
    try {
      if (!this.stream.isSubscribed(symbol, market)) await this.stream.subscribe(symbol, market);
    } catch (e) {
      return { error: "SubscribeError", message: (e as Error).message };
    }

    // First tick may not have arrived yet right after subscribing.
    for (let i = 0; i < 20; i++) {
      const tick = this.stream.getLatest(symbol, market);
      if (tick) return { ...tick, market };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { error: "NoTickYet", message: "Subscribed but no price received yet, try again" };
  }
}

export class BinanceUnwatchPriceTool extends BinanceStreamTool {
  get name(): string {
    return "binance_unwatch_price";
  }

  get description(): string {
    return "Unsubscribe from a symbol's live WebSocket ticker stream.";
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        symbol: { type: "string" },
        market: { type: "string", enum: ["spot", "usdm", "coinm"], description: "Default spot" },
      },
      required: ["symbol"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const symbol = String(args.symbol ?? "");
    const market = normalizeMarket(typeof args.market === "string" ? args.market : undefined);
    const removed = this.stream.unsubscribe(symbol, market);
    return { unsubscribed: removed };
  }
}

export class BinanceLiquidationsTool extends BinanceStreamTool {
  get name(): string {
    return "binance_liquidations";
  }

  get description(): string {
    return (
      "Live futures liquidation feed (WebSocket, no key). action: 'subscribe' (start buffering, " +
      "returns immediately — liquidations accumulate in the background, call 'list' after a few " +
      "seconds), 'list' (recent liquidations, optionally filtered by symbol), 'unsubscribe'. A " +
      "burst of same-side liquidations often precedes/confirms a squeeze — use with order-book and " +
      "funding data, not alone."
    );
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        action: { type: "string", enum: ["subscribe", "list", "unsubscribe"] },
        symbol: { type: "string", description: "Optional filter for 'list'" },
      },
      required: ["action"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = String(args.action ?? "");

    if (action === "subscribe") {
      try {
        if (!this.stream.isSubscribedToLiquidations()) await this.stream.subscribeLiquidations();
      } catch (e) {
        return { error: "SubscribeError", message: (e as Error).message };
      }
      return { subscribed: true };
    }

    if (action === "list") {
      const symbol = typeof args.symbol === "string" ? args.symbol : undefined;
      return { liquidations: this.stream.getLiquidations(symbol) };
    }

    if (action === "unsubscribe") {
      return { unsubscribed: this.stream.unsubscribeLiquidations() };
    }

    return { error: "InvalidAction", message: "action must be 'subscribe', 'list', or 'unsubscribe'" };
  }
}

export class BinancePriceAlertTool extends BinanceStreamTool {
  get name(): string {
    return "binance_price_alert";
  }

  get description(): string {
    return (
      "Manage live price alerts backed by the WebSocket ticker stream. action: 'create' " +
      "(symbol, condition: 'above'|'below', threshold — auto-subscribes to the symbol), " +
      "'list' (all alerts with triggered status), 'remove' (id)."
    );
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "remove"] },
        symbol: { type: "string" },
        market: { type: "string", enum: ["spot", "usdm", "coinm"], description: "Default spot" },
        condition: { type: "string", enum: ["above", "below"] },
        threshold: { type: "number" },
        id: { type: "number" },
      },
      required: ["action"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = String(args.action ?? "");

    if (action === "create") {
      const symbol = String(args.symbol ?? "").toUpperCase();
      const condition = args.condition as AlertCondition;
      const threshold = Number(args.threshold);
      const market = normalizeMarket(typeof args.market === "string" ? args.market : undefined);
      if (!symbol || (condition !== "above" && condition !== "below") || Number.isNaN(threshold)) {
        return { error: "InvalidArgs", message: "create requires symbol, condition ('above'|'below'), threshold" };
      }
      try {
        if (!this.stream.isSubscribed(symbol, market)) await this.stream.subscribe(symbol, market);
      } catch (e) {
        return { error: "SubscribeError", message: (e as Error).message };
      }
      const alert = this.stream.addAlert(symbol, condition, threshold, market);
      return { ...alert, market };
    }

    if (action === "list") {
      return { alerts: this.stream.listAlerts() };
    }

    if (action === "remove") {
      const id = Number(args.id);
      const removed = this.stream.removeAlert(id);
      return { removed };
    }

    return { error: "InvalidAction", message: "action must be 'create', 'list', or 'remove'" };
  }
}
