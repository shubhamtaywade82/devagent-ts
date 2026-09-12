/**
 * DatabasePack (review item 21) — sqlite queries against workspace databases.
 */

import { SqliteQueryTool } from "../database-tools.js";
import { ToolPack, packOf } from "../gateway/tool-pack.js";

export function databasePack(root: string): ToolPack {
  return packOf(
    "database",
    "SQLite queries against workspace databases.",
    "data",
    [[new SqliteQueryTool(root), { risk: "medium", sideEffects: { filesystem: true } }]],
    "Database",
  );
}
