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

// ponytail: one manager, in-memory only — no persistence across restarts,
// add a store if alerts need to survive a process crash.
export class BinanceStreamManager {
  private sockets = new Map<string, WebSocket>();
  private latest = new Map<string, Tick>();
  private alerts: Alert[] = [];
  private nextAlertId = 1;
  private liquidations: Liquidation[] = [];

  subscribe(symbol: string, market = "spot"): Promise<void> {
    const sym = symbol.toUpperCase();
    const stream = `${sym.toLowerCase()}@ticker`;
    const key = socketKey(stream, market);
    if (this.sockets.has(key)) return Promise.resolve();
    const latestKey = `${sym}:${market}`;

    return new Promise((resolve, reject) => {
      const base = tickerStreamBase(market);
      const ws = new WebSocket(`${base}/${stream}`);
      // unref so open sockets don't block process exit (tests, graceful shutdown)
      (ws as any)._socket?.unref();
      const onError = (err: Error) => {
        this.sockets.delete(key);
        reject(err);
      };
      ws.once("error", onError);
      ws.once("open", () => {
        ws.off("error", onError);
        (ws as any)._socket?.unref();
        resolve();
      });
      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        const tick: Tick = { symbol: sym, price: Number(msg.c), time: Date.now() };
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

  listSubscriptions(): string[] {
    return [...this.latest.keys()];
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
      const ws = new WebSocket(`${FUTURES_STREAM_BASE}/${LIQUIDATIONS_STREAM}`);
      (ws as any)._socket?.unref();
      const onError = (err: Error) => {
        this.sockets.delete(LIQUIDATIONS_STREAM);
        reject(err);
      };
      ws.once("error", onError);
      ws.once("open", () => {
        ws.off("error", onError);
        (ws as any)._socket?.unref();
        resolve();
      });
      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        const o = msg.o;
        if (!o) return;
        this.liquidations.push({
          symbol: o.s,
          side: o.S,
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
