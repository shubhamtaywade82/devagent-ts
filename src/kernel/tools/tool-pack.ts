/**
 * ToolPack — the unit of capability composition.
 *
 * A pack is a named, self-contained bundle of tools that a product agent
 * mounts into the kernel. The runtime itself never knows about Git, Rails,
 * Binance, or LSP: those live in packs registered by the owning product
 * (DevAgent mounts the git/filesystem/lsp packs; CryptoAgent mounts the
 * crypto pack). This is the boundary that keeps the kernel generic.
 *
 * Packs register into the kernel ToolCatalog (metadata-aware) and, while
 * the legacy Registry remains the execution path for the CLI agent loop,
 * the pack builder mirrors registrations there too — one list of tools,
 * two synchronized views.
 */

import { Tool } from "../../tools/tool.js";
import { ToolCatalog, LegacyToolMetadata } from "./tool-catalog.js";

/** One tool inside a pack: the legacy instance plus optional metadata. */
export interface ToolPackEntry {
  tool: Tool;
  category?: string;
  metadata?: LegacyToolMetadata;
}

export interface ToolPack {
  /** Stable pack id, e.g. "filesystem", "git", "crypto-trading". */
  id: string;
  description: string;
  /** Capability tag stamped onto every tool in the pack. */
  capability: string;
  entries: ToolPackEntry[];
}

/** Build a pack from legacy Tool instances. */
export function defineToolPack(
  id: string,
  description: string,
  capability: string,
  entries: ToolPackEntry[],
): ToolPack {
  return { id, description, capability, entries };
}

/**
 * Convenience builder: `packOf("fs", "Filesystem tools", "filesystem", [ReadFileTool, ...])`
 * where tools may be bare instances (metadata inferred), `[tool, metadata]`
 * tuples (metadata explicit), or full `{ tool, category, metadata }` entries.
 */
export function packOf(
  id: string,
  description: string,
  capability: string,
  tools: Array<Tool | [Tool, LegacyToolMetadata] | ToolPackEntry>,
  category = "General",
): ToolPack {
  return defineToolPack(
    id,
    description,
    capability,
    tools.map((t) => {
      if (t instanceof Tool) return { tool: t, category };
      if (Array.isArray(t)) return { tool: t[0], category, metadata: t[1] };
      return t;
    }),
  );
}

/**
 * Mount a pack into a kernel catalog. Capability defaults to the pack's
 * capability but each entry's metadata can add more. Returns the tool ids
 * that were registered (mirroring to a legacy Registry is the caller's job —
 * see src/cli/agent-tools.ts).
 */
export function mountToolPack(pack: ToolPack, catalog: ToolCatalog): string[] {
  const registered: string[] = [];
  for (const entry of pack.entries) {
    const meta: LegacyToolMetadata = {
      ...(entry.metadata ?? {}),
      capabilities: entry.metadata?.capabilities ?? [pack.capability],
      pack: entry.metadata?.pack ?? pack.id,
    };
    catalog.registerLegacy(entry.tool, entry.category ?? "General", meta);
    registered.push(entry.tool.name);
  }
  return registered;
}
