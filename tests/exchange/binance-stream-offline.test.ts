import { WebSocketServer } from "ws";
import { AddressInfo } from "node:net";
import { BinanceStreamManager } from "../../src/exchange/binance-stream.js";

// Offline counterpart to binance-stream.test.ts: drives the same stream logic
// against a local WebSocket server, so the frame handling and connect timeout
// are covered without requiring live network access to Binance.
describe("BinanceStreamManager (local server)", () => {
  let server: WebSocketServer;
  let base: string;
  let manager: BinanceStreamManager;
  const send: string[] = [];

  beforeEach(async () => {
    send.length = 0;
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => server.once("listening", r));
    base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    server.on("connection", (socket) => {
      for (const frame of send) socket.send(frame);
    });
    manager = new BinanceStreamManager({ streamBase: base, connectTimeoutMs: 2000 });
  });

  afterEach(async () => {
    manager.closeAll();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const settle = () => new Promise((r) => setTimeout(r, 150));

  it("records a tick from a well-formed frame", async () => {
    send.push(JSON.stringify({ c: "64000.5" }));
    await manager.subscribe("BTCUSDT");
    await settle();

    expect(manager.getLatest("BTCUSDT")?.price).toBe(64000.5);
  });

  // A throw inside a ws 'message' listener is an uncaught exception, not a
  // rejected promise — a single malformed frame from the exchange used to take
  // the whole agent process down.
  it("survives a malformed frame and still processes the next one", async () => {
    send.push("<html>not json</html>", "{truncated", JSON.stringify({ c: "101" }));
    await manager.subscribe("BTCUSDT");
    await settle();

    expect(manager.getLatest("BTCUSDT")?.price).toBe(101);
  });

  it("ignores a frame whose price is not a finite number", async () => {
    send.push(JSON.stringify({ c: "not-a-price" }));
    await manager.subscribe("BTCUSDT");
    await settle();

    expect(manager.getLatest("BTCUSDT")).toBeUndefined();
  });

  it("lists a subscription before any tick has arrived", async () => {
    await manager.subscribe("ETHUSDT");

    expect(manager.listSubscriptions()).toEqual(["ETHUSDT"]);
    expect(manager.isSubscribed("ETHUSDT")).toBe(true);
  });

  it("rejects rather than hanging when the endpoint never completes a handshake", async () => {
    // Port 1 refuses immediately on most systems; a blackhole address exercises
    // the timeout path instead of the error path.
    const hung = new BinanceStreamManager({ streamBase: "ws://192.0.2.1:9", connectTimeoutMs: 300 });

    await expect(hung.subscribe("BTCUSDT")).rejects.toThrow();
    expect(hung.isSubscribed("BTCUSDT")).toBe(false);
  }, 10000);
});
