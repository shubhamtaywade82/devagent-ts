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
// Agent.on<E extends AgentEventName> is structurally compatible with
// BridgeableAgent.on<E extends string> at runtime (the bridge only uses
// event names Agent emits), but TypeScript's generic-method variance rules
// reject the assignment statically because AgentEventName is narrower than
// string. Cast at this single bootstrap boundary.
wireAgentBridge(agent as unknown as BridgeableAgent, bus);

render(React.createElement(App, { bus, store, agent }));
