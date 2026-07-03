import { readFileSync, statSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Registry } from "../tools/registry";
import { ReadFileTool, WriteFileTool } from "../tools/filesystem";
import { ShellTool } from "../tools/shell";

export function buildRegistry(root: string): Registry {
  const registry = new Registry()
    .register(new ReadFileTool(root))
    .register(new WriteFileTool(root))
    .register(new ShellTool({ workspaceRoot: root }));

  return registry;
}

export function buildSummaryMarkdown(root: string): string {
  try {
    const entries = readdirSync(root);
    let md = `Workspace root: ${root}\nFiles:\n`;
    for (const name of entries.slice(0, 200)) {
      const full = resolve(root, name);
      md += `- ${name}${statSync(full).isDirectory() ? "/" : ""}\n`;
    }
    if (entries.length > 200) md += `- ...(${entries.length - 200} more)\n`;
    return md;
  } catch (e) {
    return `Workspace root: ${root}\n(unreadable: ${(e as Error).message})`;
  }
}
