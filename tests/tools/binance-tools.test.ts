import { BinancePublicApiTool, BinanceTechnicalIndicatorsTool } from "../../src/tools/binance-tools.js";

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
    }) ;

    const tool = new BinancePublicApiTool();
    const result = await tool.call({ path: "/api/v3/ticker/price", params: { symbol: "BTCUSDT" } });

    expect(result).toEqual({ status: 200, body: { symbol: "BTCUSDT", price: "60000.00" } });
    const calledUrl = ((globalThis as any).fetch as jest.Mock).mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toBe("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
  });

  it("defaults to the spot market when none is given", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }) ;
    const tool = new BinancePublicApiTool();
    await tool.call({ path: "/api/v3/exchangeInfo" });
    const calledUrl = ((globalThis as any).fetch as jest.Mock).mock.calls[0][0] as URL;
    expect(calledUrl.origin).toBe("https://api.binance.com");
  });

  it("routes to the futures host for market: usdm", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }) ;
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

  it("surfaces non-ok responses as BinanceApiError without throwing", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: -1121, msg: "Invalid symbol." }),
    }) ;

    const tool = new BinancePublicApiTool();
    const result = await tool.call({ path: "/api/v3/ticker/price", params: { symbol: "NOTREAL" } });
    expect(result.error).toBe("BinanceApiError");
    expect(result.status).toBe(400);
  });

  it("returns a RequestError instead of throwing on network failure", async () => {
    (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")) ;
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
    expect((indicators.rsi14 as number)).toBe(100); // monotonically rising closes
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

describe("BinancePublicApiTool (real network)", () => {
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

describe("BinanceTechnicalIndicatorsTool (real network)", () => {
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
