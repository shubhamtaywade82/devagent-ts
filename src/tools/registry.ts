import { Tool, ToolError } from "./tool.js";
import { OllamaToolSchema } from "../provider/provider.js";

const TOOL_ALIASES: Record<string, string> = {
  open_file: "read_file",
  cat_file: "read_file",
  view_file: "read_file",
  print_tree: "list_dir",
  tree: "list_dir",
  ls: "list_dir",
  search_codebase: "search_code",
  find_code: "search_code",
  execute_command: "run_shell",
  bash: "run_shell",
  sh: "run_shell",
};

function normalizeArgs(tool: Tool, rawArgs: unknown): Record<string, unknown> {
  if (typeof rawArgs !== "object" || rawArgs === null) return {};

  const properties = (tool.parameters?.properties ?? {}) as Record<string, unknown>;
  const propKeys = Object.keys(properties);

  if (Array.isArray(rawArgs)) {
    const mapped: Record<string, unknown> = {};
    rawArgs.forEach((val, idx) => {
      if (propKeys[idx]) mapped[propKeys[idx]] = val;
    });
    return mapped;
  }

  const keys = Object.keys(rawArgs);
  const isNumericKeys = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
  if (isNumericKeys) {
    const mapped: Record<string, unknown> = {};
    keys.forEach((k) => {
      const idx = Number(k);
      if (propKeys[idx]) mapped[propKeys[idx]] = (rawArgs as Record<string, unknown>)[k];
    });
    return mapped;
  }

  return rawArgs as Record<string, unknown>;
}

export class Registry {
  private readonly tools = new Map<string, Tool>();
  private readonly categories = new Map<string, string>();

  register(tool: Tool, category = "General"): this {
    this.tools.set(tool.name, tool);
    this.categories.set(tool.name, category);
    return this;
  }

  getTools(): Tool[] {
    return [...this.tools.values()];
  }

  categoryOf(name: string): string {
    return this.categories.get(name) ?? "General";
  }

  schemas(): OllamaToolSchema[] {
    return [...this.tools.values()].map((t) => t.schema);
  }

  async invoke(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const targetName = TOOL_ALIASES[name] ?? name;
      const tool = this.tools.get(targetName);
      if (!tool) throw new ToolError(`unknown tool: ${name}`);
      const effectiveArgs = normalizeArgs(tool, args);
      return await tool.call(effectiveArgs);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return { error: err.constructor.name, message: err.message };
    }
  }
}
