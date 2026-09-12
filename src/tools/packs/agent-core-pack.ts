/**
 * AgentCorePack (review item 21) — agent affordances: escalation, local
 * delegation, user clarification.
 */

import { EscalateTaskTool } from "../escalate-tool.js";
import { DelegateToLocalTool } from "../delegate-tool.js";
import type { LocalWorker } from "../../models/local-worker.js";
import { AskUserTool, ClarificationRequester } from "../ask-user-tool.js";
import { ToolPack, ToolPackEntry } from "../gateway/tool-pack.js";

export function agentCorePack(opts: { localWorker?: LocalWorker; requester?: ClarificationRequester }): ToolPack {
  const entries: ToolPackEntry[] = [{ tool: new EscalateTaskTool(), category: "Agent" }];
  if (opts.localWorker) {
    entries.push({ tool: new DelegateToLocalTool(opts.localWorker), category: "Agent" });
  }
  if (opts.requester) {
    entries.push({ tool: new AskUserTool(opts.requester), category: "Agent" });
  }
  return {
    id: "agent-core",
    description: "Agent affordances: escalate, delegate, ask user.",
    capability: "agent",
    entries,
  };
}
