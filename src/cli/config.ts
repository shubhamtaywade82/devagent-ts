export interface CliConfig {
  model: string;
  workspaceRoot: string;
  host?: string;
  apiKey?: string;
  timeoutMs?: number;
  systemPrompt?: string;
  shellImage?: string;
  shellTimeoutSec?: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are a focused coding assistant operating in a local workspace. \
Use the provided tools to edit code, inspect files, and run commands from the workspace root. \
Prefer minimal, surgical changes. If a command fails, inspect the error and fix the cause; do not spin into broad refactors.`;

export function loadConfig(): CliConfig {
  return {
    model: process.env.DEVAGENT_MODEL || "qwen3.5:4b",
    workspaceRoot: process.env.DEVAGENT_WORKSPACE || process.cwd(),
    host: process.env.OLLAMA_HOST,
    apiKey: undefined,
    timeoutMs: Number(process.env.DEVAGENT_TIMEOUT_MS || "60000"),
    systemPrompt: process.env.DEVAGENT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
    shellImage: process.env.DEVAGENT_SHELL_IMAGE,
    shellTimeoutSec: Number(process.env.DEVAGENT_SHELL_TIMEOUT_SEC || "30"),
  };
}