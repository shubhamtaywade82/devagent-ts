import { useCallback } from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import { EventBus } from "../../runtime/events.js";
import { Store } from "../../runtime/store.js";
import { CommandEffect } from "../../interaction/slash-commands.js";
import { runDoctor } from "../../cli/doctor.js";
import { WorkspaceManager } from "../../platform/workspace.js";
import type { AgentMode } from "../../runtime/types.js";
import type { ShellAgent } from "../App.js";

/**
 * Extracted from App.tsx — handles the execution of slash-command effects
 * (model changes, tier switches, session resume, plan runs, etc.).
 *
 * This was the single largest block inside App (~230 lines) and is now
 * a focused, testable hook with a single dependency array.
 */
export function useCommandEffects(
  bus: EventBus,
  store: Store,
  agent: ShellAgent | undefined,
  workspaceRoot: string | undefined,
  setBusy: (busy: boolean) => void,
  uiDispatch: React.Dispatch<any>,
): (effect: CommandEffect) => Promise<void> {
  return useCallback(
    async (effect: CommandEffect): Promise<void> => {
      switch (effect.kind) {
        case "message":
          bus.publish({ type: "conversation.message", role: "system", text: effect.text });
          break;
        case "open-overlay":
          uiDispatch({ type: "open-overlay", overlay: effect.overlay });
          break;
        case "focus-view":
          uiDispatch({ type: "focus-view", view: effect.view });
          break;
        case "clear-conversation":
          bus.publish({ type: "conversation.clear" });
          break;
        case "set-model": {
          const previous = store.getState().model.name;
          if (effect.model === previous) break;
          agent?.setModel?.(effect.model);
          bus.publish({ type: "model.changed", name: effect.model });
          if (!agent?.validateModel) {
            bus.publish({ type: "notification", kind: "success", text: `Model: ${effect.model}` });
            break;
          }
          bus.publish({ type: "notification", kind: "info", text: `Validating ${effect.model}…` });
          const result = await agent.validateModel();
          if (result === true) {
            bus.publish({ type: "notification", kind: "success", text: `Model: ${effect.model}` });
          } else {
            agent?.setModel?.(previous);
            bus.publish({ type: "model.changed", name: previous });
            bus.publish({ type: "notification", kind: "error", text: `${effect.model} ${result}` });
          }
          break;
        }
        case "set-tier": {
          const previousTier = store.getState().model.provider;
          if (effect.tier === previousTier) break;
          agent?.setTier?.(effect.tier);
          bus.publish({ type: "model.changed", name: store.getState().model.name, provider: effect.tier });
          bus.publish({ type: "notification", kind: "success", text: `Tier: ${effect.tier}` });
          break;
        }
        case "activate-skill": {
          const registry = agent?.getSkillsRegistry?.();
          const meta = registry?.get(effect.id);
          if (!meta) {
            bus.publish({ type: "notification", kind: "error", text: `Unknown skill: ${effect.id}` });
            break;
          }
          agent?.pinSkill?.(effect.id);
          bus.publish({ type: "notification", kind: "success", text: `Skill pinned: ${meta.name}` });
          break;
        }
        case "init-workspace": {
          const root = workspaceRoot ?? process.cwd();
          // Route every state-path decision through the WorkspaceManager:
          // init creates `.nexum` (never the legacy `.devagent`) and migrates
          // any legacy workspace as a side effect (docs/REBRANDING.md §4).
          const mgr = new WorkspaceManager(root);
          mgr.ensure();
          const paths = mgr.paths();
          mkdirSync(paths.skillsDir, { recursive: true });
          writeFileSync(
            paths.configFile,
            JSON.stringify(
              {
                model: store.getState().model.name,
                tier: store.getState().model.provider,
                host: process.env.OLLAMA_HOST || null,
              },
              null,
              2,
            ),
          );
          bus.publish({ type: "notification", kind: "success", text: `Workspace initialized at ${mgr.dir}` });
          break;
        }
        case "reset-context":
          agent?.resetContext?.();
          bus.publish({ type: "notification", kind: "info", text: "Context reset" });
          break;
        case "resume-session":
        case "resume-session-by-id": {
          const restored =
            effect.kind === "resume-session-by-id" ? agent?.resumeSessionById?.(effect.id) : agent?.resumeSession?.();
          if (!restored || restored.length === 0) {
            bus.publish({ type: "notification", kind: "info", text: "No previous session to resume" });
            break;
          }
          bus.publish({ type: "conversation.clear" });
          for (const m of restored) {
            if (m.role !== "user" && m.role !== "assistant") continue;
            if (!m.content) continue;
            bus.publish({ type: "conversation.message", role: m.role, text: m.content });
          }
          bus.publish({
            type: "notification",
            kind: "success",
            text: `Resumed session (${restored.length} messages)`,
          });
          break;
        }
        case "toggle-sidebar":
          uiDispatch({ type: "toggle-sidebar" });
          break;
        case "run-plan": {
          if (!effect.goal && !agent?.hasResumablePlan?.()) {
            bus.publish({ type: "notification", kind: "error", text: "Usage: /plan <task description>" });
            break;
          }
          bus.publish({
            type: "notification",
            kind: "info",
            text: effect.goal ? `Planning: ${effect.goal}` : "Resuming interrupted plan…",
          });
          agent?.runPlan?.(effect.goal).catch((e: unknown) =>
            bus.publish({
              type: "notification",
              kind: "error",
              text: `Plan failed: ${e instanceof Error ? e.message : String(e)}`,
            }),
          );
          break;
        }
        case "set-theme":
          bus.publish({ type: "theme.changed", theme: effect.theme });
          bus.publish({ type: "notification", kind: "info", text: `Theme: ${effect.theme}` });
          break;
        case "next-theme": {
          const order = ["default", "midnight", "solarized"] as const;
          const next = order[(order.indexOf(store.getState().theme) + 1) % order.length];
          bus.publish({ type: "theme.changed", theme: next });
          bus.publish({ type: "notification", kind: "info", text: `Theme: ${next}` });
          break;
        }
        case "show-tool-info": {
          const tool = agent?.getTools?.().find((t) => t.name === effect.name);
          bus.publish({
            type: "notification",
            kind: "info",
            text: tool ? `${tool.name} (${tool.category}): ${tool.description}` : `Unknown tool: ${effect.name}`,
          });
          break;
        }
        case "learn":
          if (agent && agent.addLearning) {
            agent.addLearning("user_preference", "user explicitly typed /learn", effect.rule);
            bus.publish({
              type: "notification",
              kind: "success",
              text: `Learned: ${effect.rule.slice(0, 40)}${effect.rule.length > 40 ? "..." : ""}`,
            });
          } else {
            bus.publish({ type: "notification", kind: "error", text: "Learning not supported by agent" });
          }
          break;
        case "set-agent-mode": {
          const valid = ["ask", "code", "architect", "review", "debug", "autonomous"];
          if (valid.includes(effect.mode)) {
            bus.publish({ type: "mode.agent", mode: effect.mode as AgentMode });
            bus.publish({ type: "notification", kind: "info", text: `Mode: ${effect.mode}` });
          }
          break;
        }
        case "run-shell": {
          bus.publish({ type: "conversation.message", role: "user", text: `Run: ${effect.command}` });
          if (agent) {
            setBusy(true);
            bus.publish({ type: "mode.changed", mode: "streaming" });
            agent
              .runUserMessage(`Run the following shell command and show me the output:\n\n${effect.command}`)
              .catch(() => {})
              .finally(() => {
                setBusy(false);
                bus.publish({ type: "model.streaming", streaming: false });
                bus.publish({ type: "mode.changed", mode: "idle" });
              });
          }
          break;
        }
        case "search":
          uiDispatch({ type: "open-overlay", overlay: "search" });
          break;
        case "next-mode": {
          const modeList = ["ask", "code", "architect", "review", "debug", "autonomous"];
          const current = store.getState().agentMode;
          const idx = modeList.indexOf(current);
          const next = modeList[(idx + 1) % modeList.length] as AgentMode;
          bus.publish({ type: "mode.agent", mode: next });
          bus.publish({ type: "notification", kind: "info", text: `Mode: ${next}` });
          break;
        }
        case "doctor": {
          bus.publish({ type: "notification", kind: "info", text: "Running system doctor…" });
          runDoctor()
            .then((report) => {
              const output = "🩺 **Nexum System Health Report**\n\n" + report.lines.map((l) => `• ${l}`).join("\n");
              bus.publish({ type: "conversation.message", role: "assistant", text: output });
              bus.publish({ type: "notification", kind: "success", text: "System check completed" });
            })
            .catch((err) => {
              bus.publish({
                type: "notification",
                kind: "error",
                text: `Doctor failed: ${err instanceof Error ? err.message : String(err)}`,
              });
            });
          break;
        }
        case "error":
          bus.publish({ type: "notification", kind: "error", text: effect.text });
          break;
      }
    },
    [agent, bus, setBusy, store, uiDispatch, workspaceRoot],
  );
}
