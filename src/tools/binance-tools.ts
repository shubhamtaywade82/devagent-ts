import { Tool } from "./tool.js";
import { ema, rsi, macd, bollingerBands, sma } from "./indicators.js";

const MARKETS: Record<string, { base: string; prefixes: string[] }> = {
  spot: { base: "https://api.binance.com", prefixes: ["/api/v3/"] },
  usdm: { base: "https://fapi.binance.com", prefixes: ["/fapi/v1/", "/fapi/v2/"] },
  coinm: { base: "https://dapi.binance.com", prefixes: ["/dapi/v1/"] },
};

const KLINES_PATH: Record<string, string> = { spot: "/api/v3/klines", usdm: "/fapi/v1/klines", coinm: "/dapi/v1/klines" };

async function fetchBinance(market: string, path: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = MARKETS[market];
  if (!config) {
    return { error: "InvalidMarket", message: `market must be one of: ${Object.keys(MARKETS).join(", ")}` };
  }
  if (!config.prefixes.some((prefix) => path.startsWith(prefix))) {
    return { error: "InvalidPath", message: `path for market '${market}' must start with one of: ${config.prefixes.join(", ")}` };
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
    const market = typeof args.market === "string" ? args.market : "spot";
    const symbol = String(args.symbol ?? "");
    const interval = typeof args.interval === "string" ? args.interval : "1h";
    const limit = Math.min(Number(args.limit ?? 100) || 100, 500);
    const wanted = Array.isArray(args.indicators) && args.indicators.length > 0 ? (args.indicators as string[]) : ALL_INDICATORS;

    const path = KLINES_PATH[market];
    if (!path) {
      return { error: "InvalidMarket", message: `market must be one of: ${Object.keys(MARKETS).join(", ")}` };
    }

    const result = await fetchBinance(market, path, { symbol, interval, limit });
    if (result.error) return result;

    const rows = result.body as unknown[][];
    if (!Array.isArray(rows) || rows.length < 30) {
      return { error: "InsufficientData", message: `Need at least 30 candles for reliable indicators, got ${rows?.length ?? 0}. Increase limit.` };
    }
    const closes = rows.map((row) => Number(row[4]));

    const indicators: Record<string, unknown> = {};
    if (wanted.includes("sma")) indicators.sma20 = sma(closes, 20);
    if (wanted.includes("ema")) indicators.ema20 = ema(closes, 20);
    if (wanted.includes("rsi")) indicators.rsi14 = rsi(closes, 14);
    if (wanted.includes("macd")) indicators.macd = macd(closes);
    if (wanted.includes("bollinger")) indicators.bollinger = bollingerBands(closes, 20, 2);

    return { symbol, market, interval, candles: rows.length, lastClose: closes[closes.length - 1], indicators };
  }
}
