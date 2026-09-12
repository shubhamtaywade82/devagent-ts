/**
 * RailsPack (review item 21) — semantic Rails queries over the rails domain
 * index (domains/rails/).
 */

import { Tool } from "../tool.js";
import { SemanticIndex, createRailsTools } from "../../domains/rails/index.js";
import { ToolPack, packOf } from "../gateway/tool-pack.js";

export function railsPack(rails: SemanticIndex): ToolPack {
  const tools: Tool[] = createRailsTools(rails);
  return packOf("rails", "Rails semantic index queries.", "code-intelligence", tools, "Rails");
}
