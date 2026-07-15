import { BinancePublicApiTool } from "../../src/tools/binance-tools.js";

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
