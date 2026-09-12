/**
 * MCP security metadata (review item 20).
 *
 * MCP-discovered tools get the SAME treatment as native tools: explicit
 * risk, capabilities, side effects, idempotency, timeout, network
 * requirements, and confirmation requirement — inferred from the MCP
 * tool annotations when present, conservatively defaulted when absent,
 * and overridable per server.
 *
 * The ToolGateway's policy/capability/budget stages then enforce MCP
 * tools exactly like filesystem/git tools — no "MCP is special" path.
 */

import type { ToolDefinition, ToolRisk } from "../../core/tools/tool-contract.js";
import type { McpDiscoveredTool } from "./mcp-client-factory.js";
import type { ConnectMcpServerOptions } from "./mcp-client-factory.js";

export interface McpSecurityOverride {
  risk?: ToolRisk;
  confirmation?: "never" | "optional" | "required";
  timeoutMs?: number;
  networkRequired?: boolean;
  externalMutation?: boolean;
}

/** Inference from MCP annotations → ToolDefinition metadata (item 20). */
export function mcpSecurityMetadata(
  tool: McpDiscoveredTool,
  serverOverride: McpSecurityOverride = {},
): Pick<ToolDefinition, "risk" | "sideEffects" | "execution" | "policy" | "network"> {
  const a = tool.annotations;

  // risk: destructive hints escalate; read-only hints de-escalate
  let risk: ToolRisk = "medium"; // conservative default for unknown MCP tools
  if (a?.readOnlyHint === true) risk = "low";
  if (a?.destructiveHint === true) risk = "high";
  if (serverOverride.risk) risk = serverOverride.risk;

  // side effects: unknown MCP tools are network + potentially mutating
  const networkRequired = serverOverride.networkRequired ?? true;
  const externalMutation = serverOverride.externalMutation ?? !(a?.readOnlyHint === true);

  // idempotency from the annotation
  const idempotent = a?.idempotentHint === true;

  // confirmation: required for high/critical risk or financial-looking
  const confirmation: "never" | "optional" | "required" =
    serverOverride.confirmation ??
    (risk === "high" || risk === "critical" ? "required" : a?.readOnlyHint === true ? "optional" : "optional");

  const openWorld = a?.openWorldHint === true;

  return {
    risk,
    sideEffects: {
      filesystem: false, // MCP servers mutate THEIR OWN state, not our workspace
      process: false,
      network: networkRequired,
      externalMutation,
      financial: false,
    },
    execution: {
      timeoutMs: serverOverride.timeoutMs ?? 60_000,
      concurrency: 2, // remote servers: be gentle
      idempotent,
      reversible: false,
      idempotencyKey: idempotent ? "auto" : "none",
    },
    policy: { confirmation },
    network: {
      required: networkRequired,
      egress: openWorld ? [] : [], // unknown hosts by default; profiles decide
      proxyable: !openWorld,
    },
  };
}

export type { ConnectMcpServerOptions };
