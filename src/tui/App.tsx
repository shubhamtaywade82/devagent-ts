import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventBus } from "../runtime/events";
import { Store } from "../runtime/store";
import { RuntimeState, VIEW_ORDER, ViewId } from "../runtime/types";
import { activeViewRows, densityForWidth, detailForDensity } from "../layout/density";
import { resolveKey, UiCommand } from "../interaction/keybindings";
import { initialUiState, uiReduce } from "../interaction/ui-state";
import { builtinCommands, CommandEffect, parseSlashInput, SlashCommandRegistry } from "../interaction/slash-commands";
import { HistoryManager } from "../interaction/history";
import { acceptWord, completions, ghostSuffix } from "../interaction/completion";
import { ErrorBoundary } from "./ErrorBoundary";
import { Header } from "./zones/Header";
import { ActivityStrip } from "./zones/ActivityStrip";
import { ContextStrip } from "./zones/ContextStrip";
import { PromptBar, promptBarRows } from "./zones/PromptBar";
import { ConversationView, ViewProps } from "./views/ConversationView";
import { ExecutionView } from "./views/ExecutionView";
import { TasksView } from "./views/TasksView";
import { GitView } from "./views/GitView";
import { LogsView } from "./views/LogsView";
import { MemoryView } from "./views/MemoryView";
import { ModelsView } from "./views/ModelsView";
import { McpView } from "./views/McpView";
import { CommandPalette } from "./overlays/CommandPalette";
import { HelpOverlay } from "./overlays/HelpOverlay";
import { ActorsOverlay } from "./overlays/ActorsOverlay";
import { ApprovalOverlay } from "./overlays/ApprovalOverlay";
import { ModelSwitcher } from "./overlays/ModelSwitcher";
import { SearchEverywhere } from "./overlays/SearchEverywhere";
import { SkillsOverlay } from "./overlays/SkillsOverlay";
import { SkillsRegistry } from "../skills/registry";

export interface ShellAgent {
  runUserMessage(message: string): Promise<unknown>;
  setModel?(model: string): void;
  setTier?(tier: string): void;
  resetContext?(): void;
  listModels?(): Promise<string[]>;
  /** Round-trips a real request through the new model; true, or an error string. */
  validateModel?(): Promise<true | string>;
  getSkillsRegistry?(): SkillsRegistry;
  pinSkill?(id: string | null): void;
}

export interface AppProps {
  bus: EventBus;
  store: Store;
  agent?: ShellAgent;
  registry?: SlashCommandRegistry;
  /** Explicit size for tests; defaults to the live terminal size. */
  columns?: number;
  rows?: number;
  now?: number;
  workspaceRoot?: string;
}

const VIEWS: Record<ViewId, (props: ViewProps) => JSX.Element> = {
  conversation: ConversationView,
  execution: ExecutionView,
  tasks: TasksView,
  git: GitView,
  logs: LogsView,
  memory: MemoryView,
  models: ModelsView,
  mcp: McpView,
};

const VIEW_LABELS: Record<ViewId, string> = {
  conversation: "Conversation",
  execution: "Execution",
  tasks: "Tasks",
  git: "Git",
  logs: "Logs",
  memory: "Memory",
  models: "Models",
  mcp: "MCP",
};

function useTerminalSize(columns?: number, rows?: number): { width: number; height: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    width: columns ?? stdout?.columns ?? 100,
    height: rows ?? stdout?.rows ?? 30,
  });
  useEffect(() => {
    if (columns != null && rows != null) return;
    if (!stdout) return;
    const onResize = () => setSize({ width: columns ?? stdout.columns ?? 100, height: rows ?? stdout.rows ?? 30 });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout, columns, rows]);
  return columns != null && rows != null ? { width: columns, height: rows } : size;
}

// Ink 3 bundles a React 17-era reconciler without useSyncExternalStore,
// so subscribe the classic way. The re-sync inside the effect catches any
// events published between first render and subscription.
function useRuntimeState(store: Store): RuntimeState {
  const [state, setState] = useState<RuntimeState>(() => store.getState());
  useEffect(() => {
    setState(store.getState());
    return store.subscribe(setState);
  }, [store]);
  return state;
}

export function App({ bus, store, agent, registry, columns, rows, now, workspaceRoot }: AppProps): JSX.Element {
  const { exit } = useApp();
  const state = useRuntimeState(store);
  const { width, height } = useTerminalSize(columns, rows);
  const [ui, uiDispatch] = useReducer(uiReduce, undefined, initialUiState);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [history] = useState(() => new HistoryManager());
  const [models, setModels] = useState<string[] | null>(null);
  const commandRegistry = useMemo(() => registry ?? builtinCommands(), [registry]);
  const pastingRef = useRef(false);
  const pasteBufRef = useRef("");
  const pasteCountRef = useRef(0);

  // Shared by both paste paths (bracketed-paste markers, and the plain
  // useInput fallback below for terminals that don't emit them): collapse
  // multi-line content into a "[Pasted text #N +K lines]" placeholder, but
  // keep the real content right after it so submitPrompt still sends it in
  // full. Single-line "pastes" are just appended — no placeholder needed.
  const appendPasted = useCallback((prev: string, pasted: string): string => {
    const lineCount = pasted.split("\n").length;
    if (lineCount <= 1) return prev + pasted;
    pasteCountRef.current += 1;
    const prefix = prev ? prev + "\n" : "";
    return `${prefix}[Pasted text #${pasteCountRef.current} +${lineCount} lines]\n${pasted}`;
  }, []);

  // Detect bracketed paste markers on stdin.
  // Uses prependListener so our handler runs BEFORE Ink's — once pastingRef
  // is true, useInput bails out and lets this handler set the prompt directly.
  useEffect(() => {
    if (!process.stdin.isTTY) return;
    let buf = "";
    const handler = (data: Buffer) => {
      buf += data.toString();

      if (buf.includes("\x1b[200~")) {
        pastingRef.current = true;
        pasteBufRef.current = "";
        buf = buf.replace("\x1b[200~", "");
      }

      if (pastingRef.current) {
        if (buf.includes("\x1b[201~")) {
          const parts = buf.split("\x1b[201~");
          pasteBufRef.current += parts[0] ?? "";
          const pasted = pasteBufRef.current;
          pasteBufRef.current = "";
          setPrompt((p) => appendPasted(p, pasted));
          buf = parts.slice(1).join("\x1b[201~");
          // Defer turning off pastingRef so any useInput callbacks queued
          // from INK's buffer see pastingRef.current = true and bail out.
          setTimeout(() => {
            pastingRef.current = false;
          }, 0);
        } else {
          pasteBufRef.current += buf;
          buf = "";
        }
      }

      if (!pastingRef.current) buf = "";
    };
    process.stdin.prependListener("data", handler);
    return () => {
      process.stdin.off("data", handler);
    };
  }, []);

  // Load the model list lazily when the switcher opens; cache afterwards.
  useEffect(() => {
    if (ui.overlay !== "model" || models !== null) return;
    let cancelled = false;
    if (!agent?.listModels) {
      setModels([]);
      return;
    }
    agent
      .listModels()
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ui.overlay, models, agent]);

  const density = densityForWidth(width);
  const detail = ui.zoom ? "full" : detailForDensity(density);
  const viewRows = activeViewRows(height, promptBarRows(prompt));
  const contentRows = Math.max(2, viewRows - 1);

  const completionItems = completions(prompt, commandRegistry);
  const activeCompletion = completionItems.length > 0;
  const ghost = activeCompletion ? "" : ghostSuffix(prompt, history.all());

  const applyEffect = useCallback(
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
          setModels(null); // invalidate the Ctrl+M cache — it belongs to the old tier
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
          const dir = join(root, ".devagent");
          mkdirSync(join(dir, "skills"), { recursive: true });
          writeFileSync(
            join(dir, "config.json"),
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
          bus.publish({ type: "notification", kind: "success", text: `.devagent/ created in ${dir}` });

          const agentsPath = join(root, "AGENTS.md");
          if (!existsSync(agentsPath) && agent) {
            const initPrompt = [
              `I just initialized DevAgent in \`${root}\`. Create \`AGENTS.md\` at the project root — this file tells future DevAgent sessions how to work with this codebase.`,
              "",
              "First explore the project (read key configs, understand the structure, check the tech stack, testing setup, linting rules, build system, etc).",
              "Then write `AGENTS.md` using the write_file tool. Cover:",
              "- Project purpose (brief)",
              "- Tech stack (language, framework, runtime)",
              "- Testing framework and how to run tests",
              "- Linting/formatting conventions",
              "- Build system and commands",
              "- Key directory structure",
              "- Any notable architecture decisions or conventions you observe",
              "",
              "Only create the file if you can successfully explore the project first. Be thorough.",
            ].join("\n");
            bus.publish({ type: "conversation.message", role: "user", text: initPrompt });
            setBusy(true);
            bus.publish({ type: "mode.changed", mode: "streaming" });
            agent
              .runUserMessage(initPrompt)
              .catch(() => {})
              .finally(() => {
                setBusy(false);
                bus.publish({ type: "model.streaming", streaming: false });
                bus.publish({ type: "mode.changed", mode: "idle" });
              });
          }
          break;
        }
        case "reset-context":
          agent?.resetContext?.();
          bus.publish({ type: "notification", kind: "info", text: "Context reset" });
          break;
        case "quit":
          exit();
          break;
        case "error":
          bus.publish({ type: "notification", kind: "error", text: effect.text });
          break;
      }
    },
    [agent, bus, exit, setBusy, store],
  );

  const submitPrompt = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed) return;
      history.add(trimmed);
      setPrompt("");
      setCompletionIndex(0);

      const slash = parseSlashInput(trimmed);
      if (slash) {
        const command = commandRegistry.find(slash.name);
        applyEffect(command ? command.execute(slash.args) : { kind: "error", text: `Unknown command: /${slash.name}` });
        return;
      }

      uiDispatch({ type: "focus-view", view: "conversation" });
      bus.publish({ type: "conversation.message", role: "user", text: trimmed });
      if (!agent) return;
      setBusy(true);
      bus.publish({ type: "mode.changed", mode: "streaming" });
      agent
        .runUserMessage(trimmed)
        .catch((e: unknown) => {
          bus.publish({ type: "error", message: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => {
          setBusy(false);
          bus.publish({ type: "model.streaming", streaming: false });
          bus.publish({ type: "mode.changed", mode: "idle" });
        });
    },
    [agent, applyEffect, bus, commandRegistry, history, uiDispatch],
  );

  const handleCommand = useCallback(
    (command: UiCommand): void => {
      switch (command.type) {
        case "quit":
          exit();
          return;
        case "approve":
        case "reject": {
          const approval = store.getState().approval;
          if (approval) {
            bus.publish({ type: "approval.resolved", id: approval.id, approved: command.type === "approve" });
            bus.publish({
              type: "notification",
              kind: command.type === "approve" ? "success" : "warning",
              text: command.type === "approve" ? "Approved" : "Rejected",
            });
          }
          if (ui.overlay === "diff") uiDispatch({ type: "close-overlay" });
          return;
        }
        case "cancel":
          setPrompt("");
          setCompletionIndex(0);
          history.stopBrowsing();
          return;
        default:
          uiDispatch(command);
      }
    },
    [bus, exit, history, store, ui.overlay],
  );

  useInput((input, key) => {
    if (pastingRef.current) return; // let the data handler manage paste content

    const ctx = { overlay: ui.overlay, promptHasText: prompt.length > 0, mode: state.mode };
    const command = resolveKey(input, key, ctx);
    if (command) {
      handleCommand(command);
      return;
    }
    if (ui.overlay) return; // remaining keys belong to the overlay's own handler

    // Prompt editing.
    if (key.return && key.shift) {
      setPrompt((p) => p + "\n");
      return;
    }
    if (key.return) {
      submitPrompt(prompt);
      return;
    }
    if (key.backspace || key.delete) {
      setPrompt((p) => p.slice(0, -1));
      setCompletionIndex(0);
      history.stopBrowsing();
      return;
    }
    if (key.tab) {
      if (activeCompletion) {
        const item = completionItems[Math.min(completionIndex, completionItems.length - 1)];
        setPrompt(item.insert);
        setCompletionIndex(0);
      } else if (ghost) {
        setPrompt(prompt + ghost);
      }
      return;
    }
    if (key.rightArrow && ghost) {
      setPrompt(prompt + acceptWord(ghost).accepted);
      return;
    }
    if (key.upArrow) {
      if (activeCompletion) setCompletionIndex((i) => Math.max(0, i - 1));
      else setPrompt(history.up(prompt));
      return;
    }
    if (key.downArrow) {
      if (activeCompletion) setCompletionIndex((i) => Math.min(completionItems.length - 1, i + 1));
      else setPrompt(history.down(prompt));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      // Real keystrokes arrive one character at a time; a chunk containing
      // an embedded newline can only be a paste the terminal delivered
      // without bracketed-paste markers (not all terminals emit them).
      // Route it through the same placeholder-collapse as bracketed paste.
      const cleaned = input.replace(/\r/g, "");
      setPrompt((p) => (cleaned.includes("\n") ? appendPasted(p, cleaned) : p + cleaned));
      setCompletionIndex(0);
    }
  });

  const ActiveView = VIEWS[ui.activeView];
  const approval = state.approval;
  const showApproval = approval != null && (ui.overlay === null || ui.overlay === "diff");
  const viewIndex = VIEW_ORDER.indexOf(ui.activeView) + 1;
  const title = ` ${viewIndex} ${VIEW_LABELS[ui.activeView]} `;
  const rule = "─".repeat(Math.max(0, width - title.length - 2));

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ErrorBoundary>
        <Header state={state} width={width} now={now} />
        <Box flexDirection="column" height={viewRows}>
          <Box height={1}>
            <Text color="gray">{"─"}</Text>
            <Text color="blue" bold>
              {title}
            </Text>
            <Text color="gray" wrap="truncate">
              {rule}
            </Text>
          </Box>
          {showApproval ? (
            <ApprovalOverlay request={approval} width={width} rows={contentRows} showDiff={ui.overlay === "diff"} />
          ) : ui.overlay === "palette" ? (
            <CommandPalette
              registry={commandRegistry}
              width={width}
              rows={contentRows}
              active={true}
              onAction={(effect) => {
                uiDispatch({ type: "close-overlay" });
                applyEffect(effect);
              }}
            />
          ) : ui.overlay === "help" ? (
            <HelpOverlay width={width} rows={contentRows} />
          ) : ui.overlay === "actors" ? (
            <ActorsOverlay state={state} width={width} rows={contentRows} />
          ) : ui.overlay === "model" ? (
            <ModelSwitcher
              current={state.model.name}
              models={models}
              width={width}
              rows={contentRows}
              active={true}
              onSelect={(model) => {
                uiDispatch({ type: "close-overlay" });
                applyEffect({ kind: "set-model", model });
              }}
            />
          ) : ui.overlay === "search" ? (
            <SearchEverywhere
              state={state}
              registry={commandRegistry}
              width={width}
              rows={contentRows}
              active={true}
              onSelect={(view) => {
                uiDispatch({ type: "close-overlay" });
                uiDispatch({ type: "focus-view", view });
              }}
            />
          ) : ui.overlay === "skills" ? (
            <SkillsOverlay
              skills={agent?.getSkillsRegistry?.().list() ?? []}
              width={width}
              rows={contentRows}
              active={true}
              onSelect={(id) => {
                uiDispatch({ type: "close-overlay" });
                applyEffect({ kind: "activate-skill", id });
              }}
            />
          ) : (
            <ActiveView state={state} width={width} rows={contentRows} detail={detail} />
          )}
        </Box>
        <Box height={1}>
          <Text color="gray" dimColor>
            {"─".repeat(Math.max(0, width - 1))}
          </Text>
        </Box>
        <ActivityStrip state={state} width={width} now={now} />
        <Box height={1}>
          <Text color="gray" dimColor>
            {"─".repeat(Math.max(0, width - 1))}
          </Text>
        </Box>
        <PromptBar text={prompt} ghost={ghost} width={width} busy={busy} />
        <ContextStrip
          state={state}
          width={width}
          activeView={ui.activeView}
          completionItems={activeCompletion ? completionItems : undefined}
          completionIndex={completionIndex}
        />
      </ErrorBoundary>
    </Box>
  );
}
