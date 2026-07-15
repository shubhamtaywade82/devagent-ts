import { Tool } from "./tool.js";

const MARKETS: Record<string, { base: string; prefixes: string[] }> = {
  spot: { base: "https://api.binance.com", prefixes: ["/api/v3/"] },
  usdm: { base: "https://fapi.binance.com", prefixes: ["/fapi/v1/", "/fapi/v2/"] },
  coinm: { base: "https://dapi.binance.com", prefixes: ["/dapi/v1/"] },
};

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
    const config = MARKETS[market];
    if (!config) {
      return { error: "InvalidMarket", message: `market must be one of: ${Object.keys(MARKETS).join(", ")}` };
    }

    const path = String(args.path ?? "");
    if (!config.prefixes.some((prefix) => path.startsWith(prefix))) {
      return {
        error: "InvalidPath",
        message: `path for market '${market}' must start with one of: ${config.prefixes.join(", ")}`,
      };
    }

    const url = new URL(path, config.base);
    const params = args.params;
    if (params && typeof params === "object") {
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        url.searchParams.set(key, String(value));
      }
    }

    try {
      const response = await fetch(url, { method: "GET" });
      const body = await response.json();
      if (!response.ok) {
        return { error: "BinanceApiError", status: response.status, body };
      }
      return { status: response.status, body };
    } catch (e) {
      return { error: "RequestError", message: (e as Error).message };
    }
  }
}
