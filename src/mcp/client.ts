/**
 * Compatibility shim (review item 19): the legacy `connectMcpServer`
 * signature now routes through the v2 adapter boundary. New code should
 * import from mcp/adapter/mcp-client-factory.js (transports, auth,
 * security overrides).
 */

import { connectMcpServerV2 } from "./adapter/mcp-client-factory.js";
import { McpToolAdapter } from "./adapter/mcp-tool-adapter.js";
import type { Tool } from "../tools/tool.js";

export async function connectMcpServer(command: string, args: string[] = []): Promise<Tool[]> {
  const connection = await connectMcpServerV2({ kind: "stdio", command, args });
  return connection.tools.map(
    (t) =>
      new McpToolAdapter(
        {
          callTool: async (request) => {
            const result = await connection.client.callTool({
              name: request.name,
              arguments: request.arguments,
            });
            return result as unknown as Record<string, unknown>;
          },
        },
        {
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        },
      ),
  );
}

export { connectMcpServerV2, type McpTransportDescriptor, type McpServerConnection, type McpDiscoveredTool } from "./adapter/mcp-client-factory.js";
export { McpToolAdapter, type McpClientLike, type McpToolDescriptor } from "./adapter/mcp-tool-adapter.js";
export { mcpSecurityMetadata, type McpSecurityOverride } from "./adapter/security-metadata.js";
