import { Tool } from "./tool.js";
import { PaperTradingManager } from "../exchange/paper-trading.js";

export class BinancePaperTradeTool extends Tool {
  constructor(private paper: PaperTradingManager) {
    super();
  }

  get name(): string {
    return "binance_paper_trade";
  }

  get description(): string {
    return (
      "Simulated position tracking against live Binance prices — NEVER touches a real exchange, " +
      "no API keys, no real money. Supports spot and usdm (USD-M futures) markets. Use to track " +
      "a discovered setup forward in time. action: 'open' (symbol, market, direction 'long'|'short', " +
      "quantity, optional stopPrice/targetPrice — marks entry at the current live price), " +
      "'list' (all positions, open ones mark-to-market against the live feed and auto-close on " +
      "stop/target), 'close' (id, closes at current live price)."
    );
  }

  get tags(): string[] {
    return ["binance", "paper-trading", "simulation", "quant-research"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        action: { type: "string", enum: ["open", "list", "close"] },
        symbol: { type: "string" },
        market: {
          type: "string",
          enum: ["spot", "usdm", "coinm"],
          description: "Default spot; use usdm for USD-M futures",
        },
        direction: { type: "string", enum: ["long", "short"] },
        quantity: { type: "number" },
        stopPrice: { type: "number" },
        targetPrice: { type: "number" },
        id: { type: "number" },
        openOnly: { type: "boolean", description: "For 'list': only return still-open positions" },
      },
      required: ["action"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = String(args.action ?? "");

    if (action === "open") {
      const symbol = String(args.symbol ?? "");
      const direction = args.direction as "long" | "short";
      const quantity = Number(args.quantity);
      const market = typeof args.market === "string" ? args.market : "spot";
      if (!symbol || (direction !== "long" && direction !== "short") || Number.isNaN(quantity)) {
        return { error: "InvalidArgs", message: "open requires symbol, direction ('long'|'short'), quantity" };
      }
      const stopPrice = typeof args.stopPrice === "number" ? args.stopPrice : undefined;
      const targetPrice = typeof args.targetPrice === "number" ? args.targetPrice : undefined;
      const result = await this.paper.open(symbol, direction, quantity, stopPrice, targetPrice, market);
      return "error" in result ? result : { ...result };
    }

    if (action === "list") {
      const openOnly = args.openOnly === true;
      return { positions: this.paper.list(openOnly) };
    }

    if (action === "close") {
      const id = Number(args.id);
      const closed = this.paper.close(id, "manual");
      return closed ? { ...closed } : { error: "NotFound", message: `No open position with id ${id}` };
    }

    return { error: "InvalidAction", message: "action must be 'open', 'list', or 'close'" };
  }
}
