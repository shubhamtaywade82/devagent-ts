import "dotenv/config";
import path from "node:path";
import { execSync } from "node:child_process";
import React from "react";
import { render } from "ink";
import { Agent } from "../cli/agent";
import { loadConfig } from "../cli/config";
import { EventBus } from "../runtime/events";
import { initialRuntimeState, Store } from "../runtime/store";
import { wireAgentBridge, BridgeableAgent } from "./agent-bridge";
import { App } from "./App";

function currentBranch(workspaceRoot: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const cfg = loadConfig();
const bus = new EventBus();
const store = new Store(
  initialRuntimeState({
    workspace: path.basename(cfg.workspaceRoot),
    branch: currentBranch(cfg.workspaceRoot),
    model: cfg.model,
  }),
);
store.attach(bus);

const agent = new Agent({ config: cfg });

// Model discovery for the Ctrl+M switcher — same endpoints the classic
// CLI uses, kept off the Agent class since it is provider-plumbing only.
async function listModels(): Promise<string[]> {
  const base = cfg.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const apiPath = cfg.tier === "cloud" ? "/v1/models" : "/api/tags";
  try {
    const resp = await fetch(`${base}${apiPath}`);
    if (!resp.ok) return [];
    if (cfg.tier === "cloud") {
      const data = (await resp.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => m.id);
    }
    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}
// Agent.on<E extends AgentEventName> is structurally compatible with
// BridgeableAgent.on<E extends string> at runtime (the bridge only uses
// event names Agent emits), but TypeScript's generic-method variance rules
// reject the assignment statically because AgentEventName is narrower than
// string. Cast at this single bootstrap boundary.
wireAgentBridge(agent as unknown as BridgeableAgent, bus);

const shellAgent = {
  runUserMessage: (message: string) => agent.runUserMessage(message),
  setModel: (model: string) => agent.setModel(model),
  resetContext: () => agent.resetContext(),
  listModels,
  validateModel: () => agent.validateModel(),
};

render(React.createElement(App, { bus, store, agent: shellAgent }));
