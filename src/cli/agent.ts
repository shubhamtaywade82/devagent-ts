import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CliConfig, loadConfig } from "./config";
import { Provider, ChatMessage } from "../provider/provider";
import { Registry } from "../tools/registry";
import { ReadFileTool, WriteFileTool } from "../tools/filesystem";
import { ShellTool } from "../tools/shell";
import {
  ListDirectoryTool,
  DeleteFileTool,
  MakeDirectoryTool,
  CopyFileTool,
  MoveFileTool,
} from "../tools/directory-tools";
import { PatchTool, AppendTool } from "../tools/edit-tools";
import { SnapshotBackupTool } from "../tools/backup-tools";
import { WatchTool } from "../tools/watch-tool";
import { SearchCodeTool } from "../tools/search-tools";
import { GitTool } from "../tools/git-tools";
import { RunTestsTool, RunLintTool, RunFormatTool, RunBuildTool } from "../tools/project-tools";
import { LoopDetector } from "../orchestrator/loop-detector";
import { MemoryStore } from "../memory/store";
import { Orchestrator } from "../orchestrator/orchestrator";
import { AgentStepRunner } from "../orchestrator/agent-planner";
import { PlanStep, Planner } from "../orchestrator/types";
import { connectMcpServer } from "../mcp/client";

export interface AgentEvents {
  onAssistantText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onStatus?: (status: string) => void;
}

type AgentEventName = keyof AgentEvents;
type AgentEventHandler<E extends AgentEventName> = NonNullable<AgentEvents[E]>;

export interface AgentOptions {
  config?: Partial<CliConfig>;
  events?: AgentEvents;
}

export class Agent {
  private readonly provider: Provider;
  private readonly registry: Registry;
  private readonly loopDetector = new LoopDetector();
  private readonly maxToolTurns = 128;
  private readonly memory: MemoryStore;
  readonly events: AgentEvents;
  private messages: ChatMessage[] = [];
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(opts: AgentOptions = {}) {
    const cfg = { ...loadConfig(), ...(opts.config ?? {}) };

    this.provider = new Provider({
      tier: cfg.tier,
      model: cfg.model,
      host: cfg.host,
      apiKey: cfg.apiKey,
      ...(cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {}),
    });

    this.events = opts.events ?? {};

    const shellOpts: ConstructorParameters<typeof ShellTool>[0] = {
      workspaceRoot: cfg.workspaceRoot,
    };
    if (cfg.shellImage) shellOpts.image = cfg.shellImage;
    if (cfg.shellTimeoutSec) shellOpts.timeoutSec = cfg.shellTimeoutSec;

    this.registry = new Registry()
      .register(new ReadFileTool(cfg.workspaceRoot))
      .register(new WriteFileTool(cfg.workspaceRoot))
      .register(new ShellTool(shellOpts))
      .register(new ListDirectoryTool(cfg.workspaceRoot))
      .register(new DeleteFileTool(cfg.workspaceRoot))
      .register(new MakeDirectoryTool(cfg.workspaceRoot))
      .register(new CopyFileTool(cfg.workspaceRoot))
      .register(new MoveFileTool(cfg.workspaceRoot))
      .register(new PatchTool(cfg.workspaceRoot))
      .register(new AppendTool(cfg.workspaceRoot))
      .register(new SnapshotBackupTool(cfg.workspaceRoot))
      .register(new WatchTool(cfg.workspaceRoot))
      .register(new SearchCodeTool(cfg.workspaceRoot))
      .register(new GitTool(cfg.workspaceRoot))
      .register(new RunTestsTool(cfg.workspaceRoot))
      .register(new RunLintTool(cfg.workspaceRoot))
      .register(new RunFormatTool(cfg.workspaceRoot))
      .register(new RunBuildTool(cfg.workspaceRoot));

    const devagentDir = join(cfg.workspaceRoot, ".devagent");
    mkdirSync(devagentDir, { recursive: true });
    this.memory = new MemoryStore(join(devagentDir, "memory.db"));
  }

  on<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (...args: unknown[]) => void);
    this.listeners.set(event, set);
    return this;
  }

  private emit<E extends AgentEventName>(event: E, ...args: Parameters<AgentEventHandler<E>>): void {
    (this.events[event] as ((...a: typeof args) => void) | undefined)?.(...args);
    this.listeners.get(event)?.forEach((h) => h(...args));
  }

  async runUserMessage(userMessage: string): Promise<string> {
    const header = (loadConfig().systemPrompt ?? "") +
      "\n\nTool contract:\n" +
      "1) Call exactly one tool per assistant turn when appropriate.\n" +
      "2) If read_file returns `truncated`, that is a content ceiling, not an instruction to stop.\n" +
      "3) `PathEscapeError` means the path escaped the workspace root; fix the path and retry.\n" +
      "4) After tool results, continue toward the user's stated goal with minimal next steps.";

    if (!this.messages.length) {
      this.messages = [{ role: "system", content: header }];
    }

    this.messages.push({ role: "user", content: userMessage });
    this.memory.appendMessage("user", userMessage);

    let lastAssistantText = "";

    for (let toolTurn = 0; toolTurn < this.maxToolTurns; toolTurn++) {
      this.emit("onStatus", `turn ${toolTurn + 1}`);

      const chatResponse = await this.provider.chat(this.messages, {
        stream: true,
        tools: this.registry.schemas(),
        onChunk: (chunk) => {
          const delta = chunk.message?.content;
          if (typeof delta === "string" && delta) {
            lastAssistantText += delta;
            this.emit("onAssistantText", delta);
          }
          const thinking = (chunk.message as any)?.thinking;
          if (typeof thinking === "string" && thinking) {
            this.emit("onThinking", thinking);
          }
        },
      });

      const assistantMessage = chatResponse.message as {
        content?: string;
        tool_calls?: Array<{ function: { name: string; arguments: any } }>;
      };
      this.messages.push({
        role: "assistant",
        content: assistantMessage.content ?? "",
      });

      const toolCalls = assistantMessage.tool_calls ?? [];
      const hasContent = (assistantMessage.content ?? "").trim().length > 0;

      if (!toolCalls.length) {
        if (hasContent) {
          this.memory.appendMessage("assistant", lastAssistantText);
          return lastAssistantText;
        }
        if (toolTurn < this.maxToolTurns - 1) {
          this.messages.push({
            role: "user",
            content: "[system] You were thinking but produced no action or response. Please continue toward the goal: call a tool or provide your final answer now.",
          });
          continue;
        }
        return lastAssistantText || "(no response)";
      }

      for (const toolCall of toolCalls) {
        const name = toolCall.function.name;
        const rawArguments = toolCall.function.arguments;
        let args: Record<string, unknown> = {};

        if (typeof rawArguments === "object" && rawArguments !== null) {
          args = rawArguments as Record<string, unknown>;
        } else if (typeof rawArguments === "string" && rawArguments) {
          try {
            args = JSON.parse(rawArguments);
          } catch {
            // leave args empty on malformed JSON
          }
        }

        this.emit("onToolCall", name, args);

        try {
          const result = await this.registry.invoke(name, args);

          const errorLabel =
            typeof result.error === "string"
              ? result.error
              : typeof result.message === "string"
                ? result.message
                : String(result);

          if (result.error === "PathEscapeError") {
            this.messages.push({
              role: "tool",
              content: JSON.stringify({ error: "PathEscapeError", message: result.message }, null, 2),
            });
            const guidance =
              "The previous tool call escaped the workspace root. Retry with a path under the current workspace root.";
            this.messages.push({ role: "user", content: `[system] ${guidance}` });

            if (this.loopDetector.record(name, args, errorLabel)) {
              return lastAssistantText + "\n[aborted] tool loop detected after repeated escapes.";
            }
            continue;
          }

          this.emit("onToolResult", name, result);
          this.messages.push({
            role: "tool",
            content: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          });

          if (this.loopDetector.record(name, args, errorLabel)) {
            return lastAssistantText + "\n[aborted] tool loop detected after repeated: " + name;
          }
          if (toolTurn === this.maxToolTurns - 1) {
            return lastAssistantText || "(no response)";
          }
        } catch (e) {
          const err = e as Error;
          this.emit("onError", err);
          this.messages.push({
            role: "tool",
            content: JSON.stringify({ error: err.constructor.name, message: err.message }, null, 2),
          });
        }
      }
    }

    return lastAssistantText || "(tool budget exceeded)";
  }

  async runPlannedTask(steps: PlanStep[], planner: Planner): Promise<PlanStep[]> {
    const orchestrator = new Orchestrator({
      steps,
      runner: new AgentStepRunner(this),
      planner,
      runRollback: async (command: string) => {
        await this.runUserMessage(`Roll back by running exactly this: ${command}`);
      },
    });
    return orchestrator.run();
  }

  setModel(model: string): void {
    this.provider.setModel(model);
    this.resetContext();
  }

  setTier(tier: string): void {
    this.provider.setTier(tier as any);
  }

  setRuntimeHost(host: string): void {
    this.provider.setRuntimeHost(host);
  }

  get currentModel(): string {
    return this.provider.currentModel;
  }

  resetContext(): void {
    this.messages = [];
  }

  getRegistry(): Registry {
    return this.registry;
  }

  async registerMcpServer(command: string, args: string[] = []): Promise<void> {
    const tools = await connectMcpServer(command, args);
    for (const tool of tools) this.registry.register(tool);
  }
}
