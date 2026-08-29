import WebSocket from "ws";

export interface Tick {
  symbol: string;
  price: number;
  time: number;
}

export type AlertCondition = "above" | "below";

export interface Alert {
  id: number;
  symbol: string;
  condition: AlertCondition;
  threshold: number;
  triggered: boolean;
  triggeredAt: number | null;
  triggeredPrice: number | null;
}

const STREAM_BASE = "wss://stream.binance.com:9443/ws";
const FUTURES_STREAM_BASE = "wss://fstream.binance.com/ws";
const LIQUIDATIONS_STREAM = "!forceOrder@arr";
const MAX_LIQUIDATIONS_BUFFERED = 200;
/** Without this a blackholed connection leaves subscribe() pending forever,
 * which hangs the tool call and the agent turn behind it. */
const CONNECT_TIMEOUT_MS = 10_000;

function tickerStreamBase(market: string): string {
  return market === "usdm" || market === "coinm" ? FUTURES_STREAM_BASE : STREAM_BASE;
}

function socketKey(stream: string, market: string): string {
  return `${stream}:${market}`;
}

export interface Liquidation {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  time: number;
}

/** Parses a frame, returning undefined instead of throwing. Exchange frames
 * are remote input arriving on an EventEmitter listener, where a throw would
 * be an uncaught exception rather than a rejected promise. */
function safeParse(data: Buffer): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(data.toString());
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export interface BinanceStreamOptions {
  /** Override the spot ticker endpoint. Defaults to Binance; exists so the
   * stream logic can be exercised against a local server instead of requiring
   * live network in tests. */
  streamBase?: string;
  /** Override the futures endpoint. Same rationale as `streamBase`. */
  futuresStreamBase?: string;
  connectTimeoutMs?: number;
}

// ponytail: one manager, in-memory only — no persistence across restarts,
// add a store if alerts need to survive a process crash.
export class BinanceStreamManager {
  private sockets = new Map<string, WebSocket>();
  private latest = new Map<string, Tick>();
  private alerts: Alert[] = [];
  private nextAlertId = 1;
  private liquidations: Liquidation[] = [];
  private readonly streamBase: string;
  private readonly futuresStreamBase: string;
  private readonly connectTimeoutMs: number;

  constructor(opts: BinanceStreamOptions = {}) {
    this.streamBase = opts.streamBase ?? STREAM_BASE;
    this.futuresStreamBase = opts.futuresStreamBase ?? FUTURES_STREAM_BASE;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  }

  subscribe(symbol: string, market = "spot"): Promise<void> {
    const sym = symbol.toUpperCase();
    const stream = `${sym.toLowerCase()}@ticker`;
    const key = socketKey(stream, market);
    if (this.sockets.has(key)) return Promise.resolve();
    const latestKey = `${sym}:${market}`;

    return new Promise((resolve, reject) => {
      const base = market === "usdm" || market === "coinm" ? this.futuresStreamBase : this.streamBase;
      const ws = new WebSocket(`${base}/${stream}`);
      (ws as any)._socket?.unref();
      const timer = setTimeout(() => {
        this.sockets.delete(key);
        ws.terminate();
        reject(new Error(`timed out connecting to ${stream} after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);
      const onError = (err: Error) => {
        clearTimeout(timer);
        this.sockets.delete(key);
        reject(err);
      };
      ws.once("error", onError);
      ws.once("open", () => {
        clearTimeout(timer);
        ws.off("error", onError);
        (ws as any)._socket?.unref();
        resolve();
      });
      ws.on("message", (data: Buffer) => {
        // A throw inside a 'message' listener is an uncaught exception, which
        // takes the whole process down — and this is remote, untrusted input.
        const msg = safeParse(data);
        if (!msg) return;
        const price = Number(msg.c);
        if (!Number.isFinite(price)) return;
        const tick: Tick = { symbol: sym, price, time: Date.now() };
        this.latest.set(latestKey, tick);
        this.checkAlerts(tick, market);
      });
      ws.on("error", () => {
        // swallow post-open errors; getLatest()/isSubscribed() reflect staleness naturally
      });
      this.sockets.set(key, ws);
    });
  }

  unsubscribe(symbol: string, market = "spot"): boolean {
    const sym = symbol.toUpperCase();
    const stream = `${sym.toLowerCase()}@ticker`;
    const key = socketKey(stream, market);
    const ws = this.sockets.get(key);
    if (!ws) return false;
    ws.terminate();
    this.sockets.delete(key);
    this.latest.delete(`${sym}:${market}`);
    return true;
  }

  isSubscribed(symbol: string, market = "spot"): boolean {
    return this.sockets.has(socketKey(`${symbol.toLowerCase()}@ticker`, market));
  }

  getLatest(symbol: string, market = "spot"): Tick | undefined {
    return this.latest.get(`${symbol.toUpperCase()}:${market}`);
  }

  /** Symbols with a live ticker socket. Derived from `sockets` (the same
   * source `isSubscribed` uses) rather than `latest`, which only fills in
   * after the first tick arrives and so used to omit freshly subscribed or
   * silent symbols. */
  listSubscriptions(): string[] {
    return [...this.sockets.keys()]
      .filter((stream) => stream.endsWith("@ticker"))
      .map((stream) => stream.slice(0, -"@ticker".length).toUpperCase());
  }

  addAlert(symbol: string, condition: AlertCondition, threshold: number, market = "spot"): Alert {
    const alert: Alert = {
      id: this.nextAlertId++,
      symbol: symbol.toUpperCase(),
      condition,
      threshold,
      triggered: false,
      triggeredAt: null,
      triggeredPrice: null,
    };
    // store market on the alert so checkAlerts can match correctly
    (alert as any).market = market;
    this.alerts.push(alert);
    return alert;
  }

  removeAlert(id: number): boolean {
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => a.id !== id);
    return this.alerts.length < before;
  }

  listAlerts(): Alert[] {
    return [...this.alerts];
  }

  private checkAlerts(tick: Tick, market = "spot"): void {
    for (const alert of this.alerts) {
      if (alert.triggered || alert.symbol !== tick.symbol) continue;
      if ((alert as any).market && (alert as any).market !== market) continue;
      const hit = alert.condition === "above" ? tick.price >= alert.threshold : tick.price <= alert.threshold;
      if (hit) {
        alert.triggered = true;
        alert.triggeredAt = tick.time;
        alert.triggeredPrice = tick.price;
      }
    }
  }

  subscribeLiquidations(): Promise<void> {
    if (this.sockets.has(LIQUIDATIONS_STREAM)) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.futuresStreamBase}/${LIQUIDATIONS_STREAM}`);
      (ws as any)._socket?.unref();
      const timer = setTimeout(() => {
        this.sockets.delete(LIQUIDATIONS_STREAM);
        ws.terminate();
        reject(new Error(`timed out connecting to ${LIQUIDATIONS_STREAM} after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);
      const onError = (err: Error) => {
        clearTimeout(timer);
        this.sockets.delete(LIQUIDATIONS_STREAM);
        reject(err);
      };
      ws.once("error", onError);
      ws.once("open", () => {
        clearTimeout(timer);
        ws.off("error", onError);
        (ws as any)._socket?.unref();
        resolve();
      });
      ws.on("message", (data: Buffer) => {
        const msg = safeParse(data);
        const o = msg?.o as Record<string, unknown> | undefined;
        if (!o) return;
        this.liquidations.push({
          symbol: String(o.s),
          side: o.S as "BUY" | "SELL",
          price: Number(o.ap),
          quantity: Number(o.q),
          time: Number(o.T),
        });
        if (this.liquidations.length > MAX_LIQUIDATIONS_BUFFERED) this.liquidations.shift();
      });
      ws.on("error", () => {});
      this.sockets.set(LIQUIDATIONS_STREAM, ws);
    });
  }

  unsubscribeLiquidations(): boolean {
    const ws = this.sockets.get(LIQUIDATIONS_STREAM);
    if (!ws) return false;
    ws.terminate();
    this.sockets.delete(LIQUIDATIONS_STREAM);
    return true;
  }

  isSubscribedToLiquidations(): boolean {
    return this.sockets.has(LIQUIDATIONS_STREAM);
  }

  getLiquidations(symbol?: string): Liquidation[] {
    const list = symbol ? this.liquidations.filter((l) => l.symbol === symbol.toUpperCase()) : this.liquidations;
    return [...list];
  }

  closeAll(): void {
    for (const ws of this.sockets.values()) ws.terminate();
    this.sockets.clear();
    this.latest.clear();
    this.liquidations = [];
  }

  /** Waits for all currently-open sockets to fully close (use in tests/shutdown). */
  closeAllAsync(): Promise<void> {
    const closing = [...this.sockets.values()].map(
      (ws) =>
        new Promise<void>((resolve) => {
          if (ws.readyState === ws.CLOSED) return resolve();
          ws.once("close", resolve);
          ws.terminate();
        }),
    );
    this.sockets.clear();
    this.latest.clear();
    this.liquidations = [];
    return Promise.all(closing).then(() => undefined);
  }
}
