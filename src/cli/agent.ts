import { CliConfig, loadConfig } from "./config";
import { Provider, ChatMessage } from "../provider/provider";
import { Registry } from "../tools/registry";
import { ReadFileTool, WriteFileTool, PathEscapeError } from "../tools/filesystem";
import { ShellTool } from "../tools/shell";
import { LoopDetector } from "../orchestrator/loop-detector";

export interface AgentEvents {
  onAssistantText?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onStatus?: (status: string) => void;
}

export interface AgentOptions {
  config?: Partial<CliConfig>;
  events?: AgentEvents;
}

export class Agent {
  private readonly provider: Provider;
  private readonly registry: Registry;
  private readonly loopDetector = new LoopDetector();
  private readonly maxToolTurns = 16;
  private readonly events: AgentEvents;

  constructor(opts: AgentOptions = {}) {
    const cfg = { ...loadConfig(), ...(opts.config ?? {}) };

    this.provider = new Provider({
      tier: "local",
      model: cfg.model,
      host: cfg.host,
      apiKey: process.env.OLLAMA_API_KEY,
      timeoutMs: typeof cfg.timeoutMs === "number" ? cfg.timeoutMs : Number(process.env.DEVAGENT_TIMEOUT_MS || "60000"),
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
      .register(new ShellTool(shellOpts));
  }

  async runUserMessage(userMessage: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          (loadConfig().systemPrompt ?? "") +
          "\n\nTool contract:\n" +
          "1) Call exactly one tool per assistant turn when appropriate.\n" +
          "2) If read_file returns `truncated`, that is a content ceiling, not an instruction to stop.\n" +
          "3) `PathEscapeError` means the path escaped the workspace root; fix the path and retry.\n" +
          "4) After tool results, continue toward the user's stated goal with minimal next steps.",
      },
      { role: "user", content: userMessage },
    ];

    let lastAssistantText = "";

    for (let toolTurn = 0; toolTurn < this.maxToolTurns; toolTurn++) {
      this.events.onStatus?.(`turn ${toolTurn + 1}`);

      const chatResponse = await this.provider.chat(messages, {
        stream: true,
        tools: this.registry.schemas(),
        onChunk: (chunk) => {
          const delta = chunk.message?.content;
          if (typeof delta === "string" && delta) {
            lastAssistantText += delta;
            this.events.onAssistantText?.(delta);
          }
        },
      });

      const assistantMessage = chatResponse.message as {
        content?: string;
        tool_calls?: Array<{
          function: { name: string; arguments: string };
        }>;
      };
      messages.push({
        role: "assistant",
        content: assistantMessage.content ?? "",
      });

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (!toolCalls.length) {
        return lastAssistantText || "(no response)";
      }

      for (const toolCall of toolCalls) {
        const name = toolCall.function.name;
        const sanitizedArguments = (toolCall.function.arguments || "{}").trim();
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(sanitizedArguments);
        } catch {
          // Leave args empty on malformed JSON.
        }

        this.events.onToolCall?.(name, args);

        try {
          const result = await this.registry.invoke(name, args);

          if (result.error === "PathEscapeError") {
            const guidance =
              "The previous tool call escaped the workspace root. Retry with a path under the current workspace root.";
            messages.push({
              role: "user",
              content: `[system] ${guidance}`,
            });
            continue;
          }

          this.events.onToolResult?.(name, result);
          messages.push({
            role: "tool",
            content:
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
          });

          const signature = `${name}:${JSON.stringify(args)}`;
          const errorForLoop =
            typeof result.error === "string"
              ? result.error
              : typeof result.message === "string"
                ? result.message
                : String(result);
          if (this.loopDetector.record(signature, args, errorForLoop)) {
            return (
              lastAssistantText +
              "\n[aborted] tool loop detected after repeated: " +
              signature
            );
          }
          if (toolTurn === this.maxToolTurns - 1) {
            return lastAssistantText || "(no response)";
          }
        } catch (e) {
          const err = e as Error;
          this.events.onError?.(err);
          messages.push({
            role: "tool",
            content: JSON.stringify({ error: err.constructor.name, message: err.message }, null, 2),
          });
        }
      }
    }

    return lastAssistantText || "(tool budget exceeded)";
  }
}