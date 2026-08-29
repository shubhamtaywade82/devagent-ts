import {
  BinancePublicApiTool,
  BinanceTechnicalIndicatorsTool,
  BinanceOrderBookTool,
  BinanceFuturesStatsTool,
  BinanceScreenerTool,
  BinanceWatchPriceTool,
  BinanceUnwatchPriceTool,
  BinancePriceAlertTool,
  BinanceLiquidationsTool,
  BinanceOhlcvTool,
  BinanceMultiTimeframeTool,
  BinanceVolumeTool,
  BinanceFundingHistoryTool,
  BinanceOpenInterestHistoryTool,
  BinanceFuturesBasisTool,
} from "../../src/tools/binance-tools.js";
import { BinanceStreamManager } from "../../src/exchange/binance-stream.js";

const skipNetwork = process.env.SKIP_NETWORK_TESTS === "true";
const describeIfNetwork = skipNetwork ? describe.skip : describe;

function fakeKline(close: number, i: number): unknown[] {
  const t = 1700000000000 + i * 3600000;
  return [t, close, close, close, close, "100", t + 3599999, "0", 0, "0", "0", "0"];
}

describe("BinancePublicApiTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("fetches a spot endpoint and returns the parsed body", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ symbol: "BTCUSDT", price: "60000.00" }),
    });

    const tool = new BinancePublicApiTool();
    const result = await tool.call({ path: "/api/v3/ticker/price", params: { symbol: "BTCUSDT" } });

    expect(result).toEqual({ status: 200, body: { symbol: "BTCUSDT", price: "60000.00" } });
    const calledUrl = ((globalThis as any).fetch as jest.Mock).mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toBe("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
  });

  it("defaults to the spot market when none is given", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const tool = new BinancePublicApiTool();
    await tool.call({ path: "/api/v3/exchangeInfo" });
    const calledUrl = ((globalThis as any).fetch as jest.Mock).mock.calls[0][0] as URL;
    expect(calledUrl.origin).toBe("https://api.binance.com");
  });

  it("routes to the futures host for market: usdm", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const tool = new BinancePublicApiTool();
    await tool.call({ market: "usdm", path: "/fapi/v1/premiumIndex" });
    const calledUrl = ((globalThis as any).fetch as jest.Mock).mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toBe("https://fapi.binance.com/fapi/v1/premiumIndex");
  });

  it("rejects an unknown market", async () => {
    const tool = new BinancePublicApiTool();
    const result = await tool.call({ market: "nope", path: "/api/v3/ping" });
    expect(result.error).toBe("InvalidMarket");
  });

  it("rejects a path outside the market's allowed prefixes (blocks e.g. /sapi/ account endpoints)", async () => {
    const tool = new BinancePublicApiTool();
    const result = await tool.call({ path: "/sapi/v1/account" });
    expect(result.error).toBe("InvalidPath");
  });

  it("allows /futures/data/ paths on usdm (open interest history, long/short ratio)", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const tool = new BinancePublicApiTool();
    const result = await tool.call({
      market: "usdm",
      path: "/futures/data/openInterestHist",
      params: { symbol: "BTCUSDT", period: "1h" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
  });

  it("surfaces non-ok responses as BinanceApiError without throwing", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: -1121, msg: "Invalid symbol." }),
    });

    const tool = new BinancePublicApiTool();
    const result = await tool.call({ path: "/api/v3/ticker/price", params: { symbol: "NOTREAL" } });
    expect(result.error).toBe("BinanceApiError");
    expect(result.status).toBe(400);
  });

  it("returns a RequestError instead of throwing on network failure", async () => {
    (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const tool = new BinancePublicApiTool();
    const result = await tool.call({ path: "/api/v3/ping" });
    expect(result.error).toBe("RequestError");
  });
});

describe("BinanceTechnicalIndicatorsTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("computes indicators from fetched klines", async () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    const rows = closes.map((c, i) => fakeKline(c, i));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });

    const tool = new BinanceTechnicalIndicatorsTool();
    const result = await tool.call({ symbol: "SOLUSDT" });

    expect(result.symbol).toBe("SOLUSDT");
    expect(result.candles).toBe(40);
    const indicators = result.indicators as Record<string, unknown>;
    expect(indicators.sma20).toBeCloseTo(closes.slice(-20).reduce((a, b) => a + b, 0) / 20);
    expect(indicators.rsi14 as number).toBe(100); // monotonically rising closes
    expect(indicators.macd).toBeDefined();
    expect(indicators.bollinger).toBeDefined();
  });

  it("only computes the requested indicators", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => fakeKline(100 + i, i));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });

    const tool = new BinanceTechnicalIndicatorsTool();
    const result = await tool.call({ symbol: "BTCUSDT", indicators: ["rsi"] });
    const indicators = result.indicators as Record<string, unknown>;
    expect(indicators.rsi14).toBeDefined();
    expect(indicators.sma20).toBeUndefined();
    expect(indicators.macd).toBeUndefined();
  });

  it("normalizes mis-cased/aliased indicator names instead of silently returning {} (regression: models pass 'SMA', 'BB20', 'MACD')", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => fakeKline(100 + i, i));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });

    const tool = new BinanceTechnicalIndicatorsTool();
    const result = await tool.call({ symbol: "BTCUSDT", indicators: ["SMA20", "EMA20", "RSI14", "MACD", "BB"] });
    const indicators = result.indicators as Record<string, unknown>;
    expect(indicators.sma20).toBeDefined();
    expect(indicators.ema20).toBeDefined();
    expect(indicators.rsi14).toBeDefined();
    expect(indicators.macd).toBeDefined();
    expect(indicators.bollinger).toBeDefined();
  });

  it("falls back to all indicators when every requested name is unrecognized", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => fakeKline(100 + i, i));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });

    const tool = new BinanceTechnicalIndicatorsTool();
    const result = await tool.call({ symbol: "BTCUSDT", indicators: ["nonsense"] });
    const indicators = result.indicators as Record<string, unknown>;
    expect(indicators.sma20).toBeDefined();
    expect(indicators.rsi14).toBeDefined();
  });

  it("errors when too few candles are returned", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => fakeKline(100 + i, i));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });

    const tool = new BinanceTechnicalIndicatorsTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.error).toBe("InsufficientData");
  });

  it("rejects an unknown market", async () => {
    const tool = new BinanceTechnicalIndicatorsTool();
    const result = await tool.call({ symbol: "BTCUSDT", market: "nope" });
    expect(result.error).toBe("InvalidMarket");
  });
});

describe("BinanceOrderBookTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("computes bid/ask imbalance", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        bids: [
          ["100", "10"],
          ["99", "5"],
        ],
        asks: [
          ["101", "3"],
          ["102", "2"],
        ],
      }),
    });
    const tool = new BinanceOrderBookTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.bidVolume).toBe(15);
    expect(result.askVolume).toBe(5);
    expect(result.imbalance).toBeCloseTo(0.5); // (15-5)/(15+5)
    expect(result.bestBid).toBe("100");
    expect(result.bestAsk).toBe("101");
  });
});

describe("BinanceFuturesStatsTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("combines premium index and open interest", async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: URL) => {
      if (url.toString().includes("premiumIndex")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ markPrice: "60000.5", lastFundingRate: "0.0001", nextFundingTime: 123 }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ openInterest: "1234.5" }) });
    });
    const tool = new BinanceFuturesStatsTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.markPrice).toBe(60000.5);
    expect(result.lastFundingRate).toBe(0.0001);
    expect(result.openInterest).toBe(1234.5);
  });
});

describe("BinanceScreenerTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("flags oversold and overbought symbols", async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: URL) => {
      const symbol = url.searchParams.get("symbol");
      const closes =
        symbol === "UPUSDT"
          ? Array.from({ length: 40 }, (_, i) => 100 + i)
          : Array.from({ length: 40 }, (_, i) => 100 - i);
      const rows = closes.map((c, i) => fakeKline(c, i));
      return Promise.resolve({ ok: true, status: 200, json: async () => rows });
    });
    const tool = new BinanceScreenerTool();
    const result = await tool.call({ symbols: ["UPUSDT", "DOWNUSDT"] });
    const results = result.results as Array<{ symbol: string; signal: string }>;
    expect(results.find((r) => r.symbol === "UPUSDT")?.signal).toBe("overbought");
    expect(results.find((r) => r.symbol === "DOWNUSDT")?.signal).toBe("oversold");
  });

  it("rejects an empty symbols array", async () => {
    const tool = new BinanceScreenerTool();
    const result = await tool.call({ symbols: [] });
    expect(result.error).toBe("InvalidSymbols");
  });

  it("includes market in result", async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      const rows = Array.from({ length: 40 }, (_, i) => fakeKline(100 + i, i));
      return Promise.resolve({ ok: true, status: 200, json: async () => rows });
    });
    const tool = new BinanceScreenerTool();
    const result = await tool.call({ symbols: ["BTCUSDT"], market: "usdm" });
    expect(result.market).toBe("usdm");
    expect(result.error).toBeUndefined();
  });
});

function fakeStream(overrides: Partial<BinanceStreamManager> = {}): BinanceStreamManager {
  return {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockReturnValue(true),
    isSubscribed: jest.fn().mockReturnValue(false),
    getLatest: jest.fn().mockReturnValue(undefined),
    listSubscriptions: jest.fn().mockReturnValue([]),
    addAlert: jest.fn(),
    removeAlert: jest.fn().mockReturnValue(true),
    listAlerts: jest.fn().mockReturnValue([]),
    subscribeLiquidations: jest.fn().mockResolvedValue(undefined),
    unsubscribeLiquidations: jest.fn().mockReturnValue(true),
    isSubscribedToLiquidations: jest.fn().mockReturnValue(false),
    getLiquidations: jest.fn().mockReturnValue([]),
    closeAll: jest.fn(),
    ...overrides,
  } as unknown as BinanceStreamManager;
}

describe("BinanceLiquidationsTool", () => {
  it("subscribes", async () => {
    const stream = fakeStream();
    const tool = new BinanceLiquidationsTool(stream);
    const result = await tool.call({ action: "subscribe" });
    expect(stream.subscribeLiquidations).toHaveBeenCalled();
    expect(result).toEqual({ subscribed: true });
  });

  it("does not re-subscribe if already subscribed", async () => {
    const stream = fakeStream({ isSubscribedToLiquidations: jest.fn().mockReturnValue(true) });
    const tool = new BinanceLiquidationsTool(stream);
    await tool.call({ action: "subscribe" });
    expect(stream.subscribeLiquidations).not.toHaveBeenCalled();
  });

  it("lists liquidations, optionally filtered by symbol", async () => {
    const liqs = [{ symbol: "BTCUSDT", side: "SELL" as const, price: 60000, quantity: 1, time: 1 }];
    const stream = fakeStream({ getLiquidations: jest.fn().mockReturnValue(liqs) });
    const tool = new BinanceLiquidationsTool(stream);
    const result = await tool.call({ action: "list", symbol: "BTCUSDT" });
    expect(stream.getLiquidations).toHaveBeenCalledWith("BTCUSDT");
    expect(result.liquidations).toEqual(liqs);
  });

  it("unsubscribes", async () => {
    const stream = fakeStream();
    const tool = new BinanceLiquidationsTool(stream);
    const result = await tool.call({ action: "unsubscribe" });
    expect(result).toEqual({ unsubscribed: true });
  });

  it("returns a SubscribeError instead of throwing", async () => {
    const stream = fakeStream({ subscribeLiquidations: jest.fn().mockRejectedValue(new Error("connect failed")) });
    const tool = new BinanceLiquidationsTool(stream);
    const result = await tool.call({ action: "subscribe" });
    expect(result.error).toBe("SubscribeError");
  });

  it("rejects an unknown action", async () => {
    const tool = new BinanceLiquidationsTool(fakeStream());
    const result = await tool.call({ action: "nope" });
    expect(result.error).toBe("InvalidAction");
  });
});

describe("BinanceWatchPriceTool", () => {
  it("subscribes then returns the latest tick once available", async () => {
    const tick = { symbol: "BTCUSDT", price: 60000, time: 1 };
    const stream = fakeStream({
      isSubscribed: jest.fn().mockReturnValue(false),
      getLatest: jest.fn().mockReturnValue(tick),
    });
    const tool = new BinanceWatchPriceTool(stream);
    const result = await tool.call({ symbol: "btcusdt" });
    expect(stream.subscribe).toHaveBeenCalledWith("BTCUSDT", "spot");
    expect(result).toMatchObject({ symbol: "BTCUSDT", price: 60000 });
  });

  it("does not re-subscribe if already subscribed", async () => {
    const tick = { symbol: "BTCUSDT", price: 1, time: 1 };
    const stream = fakeStream({
      isSubscribed: jest.fn().mockReturnValue(true),
      getLatest: jest.fn().mockReturnValue(tick),
    });
    const tool = new BinanceWatchPriceTool(stream);
    await tool.call({ symbol: "BTCUSDT" });
    expect(stream.subscribe).not.toHaveBeenCalled();
  });

  it("returns a SubscribeError instead of throwing", async () => {
    const stream = fakeStream({ subscribe: jest.fn().mockRejectedValue(new Error("connect failed")) });
    const tool = new BinanceWatchPriceTool(stream);
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.error).toBe("SubscribeError");
  });
});

describe("BinanceUnwatchPriceTool", () => {
  it("unsubscribes", async () => {
    const stream = fakeStream();
    const tool = new BinanceUnwatchPriceTool(stream);
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(stream.unsubscribe).toHaveBeenCalledWith("BTCUSDT", "spot");
    expect(result).toEqual({ unsubscribed: true });
  });
});

describe("BinancePriceAlertTool", () => {
  it("creates an alert, subscribing first if needed", async () => {
    const alert = {
      id: 1,
      symbol: "BTCUSDT",
      condition: "above",
      threshold: 70000,
      triggered: false,
      triggeredAt: null,
      triggeredPrice: null,
    };
    const stream = fakeStream({ addAlert: jest.fn().mockReturnValue(alert) });
    const tool = new BinancePriceAlertTool(stream);
    const result = await tool.call({ action: "create", symbol: "btcusdt", condition: "above", threshold: 70000 });
    expect(stream.subscribe).toHaveBeenCalledWith("BTCUSDT", "spot");
    expect(stream.addAlert).toHaveBeenCalledWith("BTCUSDT", "above", 70000, "spot");
    expect(result).toMatchObject(alert);
  });

  it("rejects an invalid create call", async () => {
    const tool = new BinancePriceAlertTool(fakeStream());
    const result = await tool.call({ action: "create", symbol: "BTCUSDT" });
    expect(result.error).toBe("InvalidArgs");
  });

  it("lists alerts", async () => {
    const stream = fakeStream({ listAlerts: jest.fn().mockReturnValue([{ id: 1 }]) });
    const tool = new BinancePriceAlertTool(stream);
    const result = await tool.call({ action: "list" });
    expect(result.alerts).toEqual([{ id: 1 }]);
  });

  it("removes an alert", async () => {
    const stream = fakeStream();
    const tool = new BinancePriceAlertTool(stream);
    const result = await tool.call({ action: "remove", id: 1 });
    expect(stream.removeAlert).toHaveBeenCalledWith(1);
    expect(result).toEqual({ removed: true });
  });

  it("rejects an unknown action", async () => {
    const tool = new BinancePriceAlertTool(fakeStream());
    const result = await tool.call({ action: "nope" });
    expect(result.error).toBe("InvalidAction");
  });
});

describeIfNetwork("BinancePublicApiTool (real network)", () => {
  it("pings the real Binance spot API", async () => {
    const tool = new BinancePublicApiTool();
    const result = await tool.call({ path: "/api/v3/ping" });
    expect(result.status).toBe(200);
  }, 15000);

  it("fetches a real BTCUSDT spot price", async () => {
    const tool = new BinancePublicApiTool();
    const result = await tool.call({ path: "/api/v3/ticker/price", params: { symbol: "BTCUSDT" } });
    expect(result.status).toBe(200);
    expect((result.body as { symbol: string }).symbol).toBe("BTCUSDT");
  }, 15000);
});

describeIfNetwork("BinanceTechnicalIndicatorsTool (real network)", () => {
  it("computes real indicators for BTCUSDT", async () => {
    const tool = new BinanceTechnicalIndicatorsTool();
    const result = await tool.call({ symbol: "BTCUSDT", interval: "1h", limit: 100 });
    expect(result.symbol).toBe("BTCUSDT");
    const indicators = result.indicators as Record<string, unknown>;
    expect(typeof indicators.rsi14).toBe("number");
    expect(indicators.rsi14 as number).toBeGreaterThanOrEqual(0);
    expect(indicators.rsi14 as number).toBeLessThanOrEqual(100);
  }, 15000);
});

describeIfNetwork("BinanceOrderBookTool (real network)", () => {
  it("fetches a real BTCUSDT order book", async () => {
    const tool = new BinanceOrderBookTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(typeof result.imbalance).toBe("number");
  }, 15000);
});

describeIfNetwork("BinanceFuturesStatsTool (real network)", () => {
  it("fetches real BTCUSDT funding rate and open interest", async () => {
    const tool = new BinanceFuturesStatsTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(typeof result.markPrice).toBe("number");
    expect(typeof result.openInterest).toBe("number");
  }, 15000);
});

describeIfNetwork("BinanceScreenerTool (real network)", () => {
  it("screens real symbols", async () => {
    const tool = new BinanceScreenerTool();
    const result = await tool.call({ symbols: ["BTCUSDT", "ETHUSDT"] });
    const results = result.results as Array<{ symbol: string; signal: string }>;
    expect(results).toHaveLength(2);
    expect(["oversold", "overbought", "neutral"]).toContain(results[0].signal);
  }, 15000);
});

describe("BinanceOhlcvTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("returns structured OHLCV candles", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => fakeKline(100 + i, i));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });
    const tool = new BinanceOhlcvTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.count).toBe(10);
    const candles = result.candles as Array<{
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      openTime: number;
    }>;
    expect(candles[0].close).toBe(100);
    expect(typeof candles[0].volume).toBe("number");
    expect(typeof candles[0].openTime).toBe("number");
  });

  it("rejects an unknown market", async () => {
    const tool = new BinanceOhlcvTool();
    const result = await tool.call({ symbol: "BTCUSDT", market: "nope" });
    expect(result.error).toBe("InvalidMarket");
  });
});

describe("BinanceMultiTimeframeTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("returns indicators for each interval", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => fakeKline(100 + i, i));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });
    const tool = new BinanceMultiTimeframeTool();
    const result = await tool.call({ symbol: "BTCUSDT", intervals: ["1h", "4h"] });
    expect(result.symbol).toBe("BTCUSDT");
    const tfs = result.timeframes as Array<{ interval: string; indicators: Record<string, unknown> }>;
    expect(tfs).toHaveLength(2);
    expect(tfs[0].interval).toBe("1h");
    expect(tfs[0].indicators.rsi14).toBeDefined();
  });

  it("errors when intervals is empty", async () => {
    const tool = new BinanceMultiTimeframeTool();
    const result = await tool.call({ symbol: "BTCUSDT", intervals: [] });
    expect(result.error).toBe("InvalidArgs");
  });

  it("caps intervals at 5", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => fakeKline(100 + i, i));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });
    const tool = new BinanceMultiTimeframeTool();
    const result = await tool.call({ symbol: "BTCUSDT", intervals: ["1m", "5m", "15m", "1h", "4h", "1d"] });
    const tfs = result.timeframes as unknown[];
    expect(tfs).toHaveLength(5);
  });
});

describe("BinanceVolumeTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("computes VWAP and volume distribution", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => {
      const c = 100 + i;
      const t = 1700000000000 + i * 3600000;
      return [t, c - 1, c + 1, c - 1, c, "100", t + 3599999, "0", 0, "0", "0", "0"];
    });
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });
    const tool = new BinanceVolumeTool();
    const result = await tool.call({ symbol: "BTCUSDT", buckets: 5 });
    expect(typeof result.vwap).toBe("number");
    expect(result.vwap as number).toBeGreaterThan(0);
    const dist = result.volumeByPrice as unknown[];
    expect(dist).toHaveLength(5);
    expect(result.pointOfControl).toBeDefined();
  });

  it("errors with insufficient data", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const tool = new BinanceVolumeTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.error).toBe("InsufficientData");
  });
});

describe("BinanceFundingHistoryTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("combines funding history and long/short ratio", async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: URL) => {
      if (url.toString().includes("fundingRate")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            { fundingTime: 1, fundingRate: "0.0001" },
            { fundingTime: 2, fundingRate: "0.0002" },
          ],
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ longShortRatio: "1.5", longAccount: "0.6", shortAccount: "0.4", timestamp: 1000 }],
      });
    });
    const tool = new BinanceFundingHistoryTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.symbol).toBe("BTCUSDT");
    const history = result.fundingHistory as Array<{ rate: number }>;
    expect(history).toHaveLength(2);
    expect(result.avgFundingRate).toBeCloseTo(0.00015);
    const lsr = result.longShortRatio as Array<{ ratio: number; longPct: number }>;
    expect(lsr[0].ratio).toBe(1.5);
    expect(lsr[0].longPct).toBe(0.6);
  });

  it("surfaces partial errors gracefully", async () => {
    (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const tool = new BinanceFundingHistoryTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    // Both sub-requests failed — should have error fields, not throw
    expect(result.symbol).toBe("BTCUSDT");
    expect(result.fundingError ?? result.longShortRatioError).toBeDefined();
  });
});

describe("BinanceOpenInterestHistoryTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("returns OI series with changePct", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { symbol: "BTCUSDT", sumOpenInterest: "1000", sumOpenInterestValue: "60000000", timestamp: 1 },
        { symbol: "BTCUSDT", sumOpenInterest: "1100", sumOpenInterestValue: "66000000", timestamp: 2 },
      ],
    });
    const tool = new BinanceOpenInterestHistoryTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.symbol).toBe("BTCUSDT");
    expect(result.count).toBe(2);
    expect(result.changePct).toBeCloseTo(10); // 10% increase
    const series = result.series as Array<{ openInterest: number }>;
    expect(series[1].openInterest).toBe(1100);
  });

  it("forwards fetch errors cleanly", async () => {
    (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const tool = new BinanceOpenInterestHistoryTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.error).toBe("RequestError");
  });
});

describe("BinanceFuturesBasisTool", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("computes basis and interpretation", async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: URL) => {
      if (url.toString().includes("fapi.binance.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ markPrice: "60300.00", lastFundingRate: "0.0001", nextFundingTime: 9999 }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ price: "60000.00" }) });
    });
    const tool = new BinanceFuturesBasisTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.spotPrice).toBe(60000);
    expect(result.markPrice).toBe(60300);
    expect(result.basis).toBeCloseTo(300);
    expect(result.basisPct).toBeCloseTo(0.5);
    expect(result.interpretation).toBe("premium (contango)");
  });

  it("returns discount interpretation when futures below spot", async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: URL) => {
      if (url.toString().includes("fapi.binance.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ markPrice: "59900.00", lastFundingRate: "-0.0001", nextFundingTime: 9999 }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ price: "60000.00" }) });
    });
    const tool = new BinanceFuturesBasisTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(result.interpretation).toBe("discount (backwardation)");
  });
});

describe("BinanceWatchPriceTool (market-aware)", () => {
  it("passes market to stream.subscribe and stream.getLatest", async () => {
    const tick = { symbol: "SOLUSDT", price: 72.5, time: 1 };
    const stream = fakeStream({
      isSubscribed: jest.fn().mockReturnValue(false),
      getLatest: jest.fn().mockReturnValue(tick),
    });
    const tool = new BinanceWatchPriceTool(stream);
    const result = await tool.call({ symbol: "SOLUSDT", market: "usdm" });
    expect(stream.subscribe).toHaveBeenCalledWith("SOLUSDT", "usdm");
    expect(stream.getLatest).toHaveBeenCalledWith("SOLUSDT", "usdm");
    expect(result.market).toBe("usdm");
    expect(result.price).toBe(72.5);
  });
});

describe("BinanceMultiTimeframeTool (real network)", () => {
  it("fetches real SOLUSDT indicators across 15m/1h/4h", async () => {
    const tool = new BinanceMultiTimeframeTool();
    const result = await tool.call({
      symbol: "SOLUSDT",
      market: "usdm",
      intervals: ["15m", "1h", "4h"],
      indicators: ["rsi", "macd"],
    });
    expect(result.symbol).toBe("SOLUSDT");
    const tfs = result.timeframes as Array<{ interval: string; indicators: Record<string, unknown> }>;
    expect(tfs).toHaveLength(3);
    for (const tf of tfs) {
      expect(tf.indicators.rsi14 as number).toBeGreaterThanOrEqual(0);
      expect(tf.indicators.macd).toBeDefined();
    }
  }, 20000);
});

describe("BinanceFuturesBasisTool (real network)", () => {
  it("computes real BTCUSDT futures basis", async () => {
    const tool = new BinanceFuturesBasisTool();
    const result = await tool.call({ symbol: "BTCUSDT" });
    expect(typeof result.spotPrice).toBe("number");
    expect(typeof result.markPrice).toBe("number");
    expect(typeof result.basisPct).toBe("number");
    expect(["premium (contango)", "discount (backwardation)", "near parity"]).toContain(result.interpretation);
  }, 15000);
});

describe("BinanceOpenInterestHistoryTool (real network)", () => {
  it("fetches real BTCUSDT open interest history", async () => {
    const tool = new BinanceOpenInterestHistoryTool();
    const result = await tool.call({ symbol: "BTCUSDT", period: "1h", limit: 10 });
    expect(result.symbol).toBe("BTCUSDT");
    const series = result.series as Array<{ openInterest: number }>;
    expect(series.length).toBeGreaterThan(0);
    expect(series[0].openInterest).toBeGreaterThan(0);
  }, 15000);
});
