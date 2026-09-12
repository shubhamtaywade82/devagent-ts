import { OllamaToolSchema } from "../models/adapters/provider.js";
import type { ToolCallContext } from "../core/tools/tool-contract.js";

export class ToolError extends Error {}

export abstract class Tool {
  abstract get name(): string;
  abstract get description(): string;

  get tags(): string[] {
    return [];
  }

  get capabilities(): string[] {
    return [];
  }

  get parameters(): Record<string, unknown> {
    return { type: "object", properties: {}, required: [] };
  }

  get schema(): OllamaToolSchema {
    return {
      type: "function",
      function: { name: this.name, description: this.description, parameters: this.parameters },
    };
  }

  /**
   * Execute the tool. The optional call context (review item 16) carries
   * the run's AbortSignal + correlation: long-running tools (shell,
   * browser, MCP, watchers) SHOULD check `callCtx?.signal` so cancellation
   * reaches tool code. Tools that predate the context ignore it.
   */
  abstract call(args: Record<string, unknown>, callCtx?: ToolCallContext): Promise<Record<string, unknown>>;
}
