import { Tool, ToolError } from "./tool";
import { OllamaToolSchema } from "../ollama/provider";

export class Registry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  schemas(): OllamaToolSchema[] {
    return [...this.tools.values()].map((t) => t.schema);
  }

  // Tool failures are converted into a data payload, never thrown.
  // The model needs to see the failure to recover from it — an
  // exception here would kill the whole agent loop over one bad call.
  async invoke(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const tool = this.tools.get(name);
      if (!tool) throw new ToolError(`unknown tool: ${name}`);
      return await tool.call(args);
    } catch (e) {
      const err = e as Error;
      return { error: err.constructor.name, message: err.message };
    }
  }
}
