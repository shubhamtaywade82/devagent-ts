/**
 * Slash commands are plugins: a registry of named commands with aliases,
 * discoverable by prefix for autocomplete and executed by the prompt.
 */

import { ViewId } from "../runtime/types";
import { OverlayId } from "./ui-state";

/** Effects a command can request; the shell interprets them. */
export type CommandEffect =
  | { kind: "message"; text: string }
  | { kind: "open-overlay"; overlay: OverlayId }
  | { kind: "focus-view"; view: ViewId }
  | { kind: "clear-conversation" }
  | { kind: "set-model"; model: string }
  | { kind: "set-tier"; tier: "local" | "cloud" }
  | { kind: "activate-skill"; id: string }
  | { kind: "reset-context" }
  | { kind: "quit" }
  | { kind: "error"; text: string };

export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  execute(args: string): CommandEffect;
}

export class SlashCommandRegistry {
  private commands: SlashCommand[] = [];

  register(command: SlashCommand): void {
    this.commands = this.commands.filter((c) => c.name !== command.name).concat(command);
  }

  all(): SlashCommand[] {
    return [...this.commands].sort((a, b) => a.name.localeCompare(b.name));
  }

  find(name: string): SlashCommand | undefined {
    return this.commands.find((c) => c.name === name || c.aliases.includes(name));
  }

  /** Prefix matches for autocomplete, e.g. "mod" -> model, models. */
  complete(prefix: string): SlashCommand[] {
    return this.all().filter((c) => c.name.startsWith(prefix) || c.aliases.some((a) => a.startsWith(prefix)));
  }
}

/** Parse "/model qwen3:30b" into { name: "model", args: "qwen3:30b" }. */
export function parseSlashInput(input: string): { name: string; args: string } | null {
  if (!input.startsWith("/")) return null;
  const body = input.slice(1).trim();
  if (!body) return null;
  const space = body.indexOf(" ");
  if (space === -1) return { name: body, args: "" };
  return { name: body.slice(0, space), args: body.slice(space + 1).trim() };
}

export function builtinCommands(): SlashCommandRegistry {
  const registry = new SlashCommandRegistry();
  const viewCommand = (name: string, view: ViewId, description: string): SlashCommand => ({
    name,
    aliases: [],
    description,
    execute: () => ({ kind: "focus-view", view }),
  });

  registry.register({
    name: "help",
    aliases: ["h"],
    description: "Show help overlay",
    execute: () => ({ kind: "open-overlay", overlay: "help" }),
  });
  registry.register({
    name: "clear",
    aliases: [],
    description: "Clear the conversation view",
    execute: () => ({ kind: "clear-conversation" }),
  });
  registry.register({
    name: "reset",
    aliases: ["compact"],
    description: "Reset the model conversation context",
    execute: () => ({ kind: "reset-context" }),
  });
  registry.register({
    name: "model",
    aliases: [],
    description: "Switch model: /model [name]",
    execute: (args) => (args ? { kind: "set-model", model: args } : { kind: "open-overlay", overlay: "model" }),
  });
  registry.register({
    name: "tier",
    aliases: [],
    description: "Switch provider tier: /tier local|cloud",
    execute: (args) => {
      const tier = args.trim().toLowerCase();
      if (tier !== "local" && tier !== "cloud") {
        return { kind: "error", text: "Usage: /tier local|cloud" };
      }
      return { kind: "set-tier", tier };
    },
  });
  registry.register({
    name: "skills",
    aliases: [],
    description: "Browse skills, or activate one: /skills [id]",
    execute: (args) =>
      args.trim() ? { kind: "activate-skill", id: args.trim() } : { kind: "open-overlay", overlay: "skills" },
  });
  registry.register({
    name: "quit",
    aliases: ["exit"],
    description: "Quit DevAgent",
    execute: () => ({ kind: "quit" }),
  });
  registry.register(viewCommand("conversation", "conversation", "Focus the Conversation view"));
  registry.register(viewCommand("chat", "conversation", "Focus the Conversation view"));
  registry.register(viewCommand("execution", "execution", "Focus the Execution view"));
  registry.register(viewCommand("status", "execution", "Focus the Execution view"));
  registry.register(viewCommand("logs", "logs", "Focus the Logs view"));
  registry.register(viewCommand("git", "git", "Focus the Git view"));
  registry.register(viewCommand("tasks", "tasks", "Focus the Tasks view"));
  registry.register(viewCommand("memory", "memory", "Focus the Memory view"));
  registry.register(viewCommand("models", "models", "Focus the Models view"));
  registry.register(viewCommand("mcp", "mcp", "Focus the MCP view"));
  return registry;
}
