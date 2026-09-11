import "dotenv/config";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import React from "react";
import { render } from "ink";
import { Agent } from "../cli/agent.js";
import { loadConfig } from "../cli/config.js";
import { EventBus } from "@nemesis-oss/nexum-core/runtime/events";
import { initialRuntimeState, Store } from "../runtime/store.js";
import { detectProjectInfo } from "../runtime/project-info.js";
import { ClarificationResponse } from "@nemesis-oss/nexum-core/runtime/types";
import { wireAgentBridge, BridgeableAgent } from "./agent-bridge.js";
import { App } from "./App.js";
import { validateAsl, generateAslGraph } from "@nemesis-oss/nexum-tools/asl/commands";
import { envIs } from "@nemesis-oss/nexum-core/platform/environment";
import { workspaceStateDir } from "@nemesis-oss/nexum-core/platform/paths";

function enableTerminalFeatures(): () => void {
  if (!process.stdin.isTTY) return () => {};
  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[3J\x1b[H\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?2004h");
  let restored = false;
  const cleanup = () => {
    if (restored) return;
    restored = true;
    process.stdout.write("\x1b[?2004l\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?1049l\x1b[?25h");
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("exit", cleanup);
  return cleanup;
}

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

// One-time, non-blocking check — whether run_shell's Docker sandbox (see
// tools/shell.ts's own lazy ensureDockerAvailable) is actually reachable, so
// the footer's Sandbox indicator reflects reality instead of assuming it's
// always up. Async so a slow/missing `docker` binary can't delay first paint
// the way a blocking execSync would.
function checkDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn("docker", ["info"], { stdio: "ignore" });
    probe.on("close", (code) => resolve(code === 0));
    probe.on("error", () => resolve(false));
  });
}

// Debug-only: dump every raw stdin chunk (as JSON-escaped text) to
// .nexum/paste-debug.log when NEXUM_DEBUG_STDIN=1, registered before
// anything else touches stdin so it sees genuinely raw terminal bytes.
// Kept as a standing diagnostic — terminals disagree wildly on how they
// encode paste/line-break bytes (see App.tsx's \r-vs-\n handling), and this
// is the fastest way to root-cause the next one.
if (envIs("DEBUG_STDIN", "1") && process.stdin.isTTY) {
  const debugDir = workspaceStateDir(process.cwd());
  mkdirSync(debugDir, { recursive: true });
  const logPath = path.join(debugDir, "paste-debug.log");
  process.stdin.prependListener("data", (data: Buffer) => {
    appendFileSync(logPath, `${new Date().toISOString()} len=${data.length} ${JSON.stringify(data.toString())}\n`);
  });
}

const cfg = loadConfig();

(async () => {
  const args = process.argv.slice(2);
  let initialTask: string | undefined;
  if (args[0] === "asl") {
    const cmd = args[1];
    if (cmd === "validate") {
      const ok = await validateAsl(cfg.workspaceRoot);
      process.exit(ok ? 0 : 1);
    } else if (cmd === "graph") {
      await generateAslGraph(cfg.workspaceRoot);
      process.exit(0);
    } else {
      console.error(`Unknown ASL command: ${cmd}`);
      console.error("Usage: nexum asl [validate|graph]");
      process.exit(1);
    }
  } else if (args[0] === "fix") {
    const rest = args.slice(1).join(" ").trim();
    initialTask = rest ? `Fix issue: ${rest}` : "Find and fix failing tests or diagnostics";
  } else if (args[0] === "issue" || args[0] === "--issue") {
    const issueNum = args[1]?.replace(/^#/, "");
    initialTask = issueNum
      ? `Investigate GitHub issue #${issueNum}, reproduce and fix the failure, run verification, and prepare a PR.`
      : "Inspect and resolve open GitHub issue";
  } else if (args.length > 0 && !args[0].startsWith("-")) {
    initialTask = args.join(" ").trim();
  }

  const bus = new EventBus();
  const store = new Store(
    initialRuntimeState({
      workspace: path.basename(cfg.workspaceRoot),
      branch: currentBranch(cfg.workspaceRoot),
      model: cfg.model,
      provider: cfg.tier,
      pricing: cfg.pricing,
    }),
  );
  store.attach(bus);
  const detectedProject = detectProjectInfo(cfg.workspaceRoot);
  bus.publish({ type: "project.detected", info: detectedProject });
  checkDockerAvailable().then((available) => bus.publish({ type: "sandbox.detected", available }));

  const agent = new Agent({ config: cfg });
  agent.setProjectInfo(detectedProject);

  // Agent.on<E extends AgentEventName> is structurally compatible with
  // BridgeableAgent.on<E extends string> at runtime (the bridge only uses
  // event names Agent emits), but TypeScript's generic-method variance rules
  // reject the assignment statically because AgentEventName is narrower than
  // string. Cast at this single bootstrap boundary.
  wireAgentBridge(agent as unknown as BridgeableAgent, bus);

  // Non-blocking: connecting spawns a subprocess per configured MCP server,
  // which shouldn't hold up the TUI's first paint. Publishes even an empty
  // list so the MCP actor moves out of "muted" once startup settles.
  agent
    .connectConfiguredMcpServers()
    .then((servers) => bus.publish({ type: "mcp.changed", servers }))
    .catch((e) => bus.publish({ type: "logs.appended", level: "error", source: "mcp", message: String(e) }));

  const shellAgent = {
    runUserMessage: (message: string) => agent.runUserMessage(message),
    setModel: (model: string) => agent.setModel(model),
    setTier: (tier: "local" | "cloud") => agent.setTier(tier),
    resetContext: () => agent.resetContext(),
    resumeSession: () => agent.resumeSession(),
    resumeSessionById: (id: string) => agent.resumeSessionById(id),
    hasResumableSession: () => agent.hasResumableSession(),
    listSessions: () => agent.listSessions(),
    getTools: () =>
      agent
        .getRegistry()
        .getTools()
        .map((t) => ({ name: t.name, description: t.description, category: agent.getRegistry().categoryOf(t.name) })),
    listModels: () => agent.listModels(),
    modelAvailability: (models: string[]) => agent.modelAvailability(models),
    modelCapabilities: (models: string[]) => agent.modelCapabilities(models),
    runPlan: (goal: string) => agent.runPlan(goal),
    hasResumablePlan: () => agent.hasResumablePlan(),
    resolveApproval: (id: string, approved: boolean) => agent.resolveApproval(id, approved),
    resolveClarification: (resp: ClarificationResponse) => agent.resolveClarification(resp),
    validateModel: () => agent.validateModel(),
    getSkillsRegistry: () => agent.getSkillsRegistry(),
    pinSkill: (id: string | null) => agent.pinSkill(id),
  };

  const disableFeatures = enableTerminalFeatures();
  const { waitUntilExit } = render(
    React.createElement(App, { bus, store, agent: shellAgent, workspaceRoot: cfg.workspaceRoot, initialTask }),
  );
  await waitUntilExit();
  disableFeatures();
})();
