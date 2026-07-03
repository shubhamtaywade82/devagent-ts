import React from "react";
import { render } from "ink";
import { Agent } from "../cli/agent";
import { loadConfig } from "../cli/config";
import { App, AppAgent } from "./App";

const cfg = loadConfig();
const agent = new Agent();

// Agent.on<E extends AgentEventName> is structurally compatible with
// AppAgent's BridgeableAgent.on<E extends string> at runtime (it accepts
// exactly the event names AppAgent ever calls it with), but TypeScript's
// generic-method variance rules reject the assignment statically because
// AgentEventName is narrower than string. Cast at this single bootstrap
// boundary rather than widening Agent's own event typing repo-wide.
render(React.createElement(App, { agent: agent as unknown as AppAgent, workspaceRoot: cfg.workspaceRoot, model: cfg.model }));
