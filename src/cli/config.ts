import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface CliConfig {
  model: string;
  workspaceRoot: string;
  tier: "local" | "cloud";
  host?: string;
  apiKey?: string;
  timeoutMs?: number;
  systemPrompt?: string;
  shellImage?: string;
  shellTimeoutSec?: number;
}

interface ConfigFile {
  model?: string;
  tier?: string;
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

const GLOBAL_CONFIG_DIR = join(homedir(), ".devagent");

function loadGlobalConfig(): ConfigFile {
  const p = join(GLOBAL_CONFIG_DIR, "config.json");
  if (!existsSync(p)) return {};
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as ConfigFile;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // skip malformed config file
  }
  return {};
}

function findWorkspaceRoot(cwd: string): string {
  if (process.env.DEVAGENT_WORKSPACE) return process.env.DEVAGENT_WORKSPACE;
  let dir = resolve(cwd);
  const root = resolve("/");
  while (dir !== root) {
    if (existsSync(join(dir, ".devagent"))) return dir;
    dir = resolve(dir, "..");
  }
  return cwd;
}

function loadAgentsFile(root: string): string {
  for (const name of ["AGENTS.md", "DEVAGENT.md"]) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    try {
      return readFileSync(p, "utf8").trim();
    } catch {
      // skip unreadable file
    }
  }
  return "";
}

export function loadConfig(): CliConfig {
  const file = loadGlobalConfig();
  const fromEnv = (key: string) => process.env[key];

  const rawTimeout = fromEnv("DEVAGENT_TIMEOUT_MS") || String(file.timeoutMs ?? "");
  const timeoutMs = rawTimeout && Number.isFinite(Number(rawTimeout)) ? Number(rawTimeout) : undefined;
  const rawShellTimeout = fromEnv("DEVAGENT_SHELL_TIMEOUT_SEC") || String(file.shellTimeoutSec ?? "");
  const shellTimeoutSec = rawShellTimeout && Number.isFinite(Number(rawShellTimeout)) ? Number(rawShellTimeout) : undefined;

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const basePrompt = fromEnv("DEVAGENT_SYSTEM_PROMPT") || file.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const agentsMd = loadAgentsFile(workspaceRoot);
  const systemPrompt = agentsMd ? `${basePrompt}\n\n## Project Rules\n\n${agentsMd}` : basePrompt;

  return {
    model: fromEnv("DEVAGENT_MODEL") || file.model || "qwen3.5:4b",
    workspaceRoot,
    tier: (fromEnv("DEVAGENT_TIER") || file.tier) === "cloud" ? "cloud" : "local",
    host: fromEnv("OLLAMA_HOST") || file.host,
    apiKey: fromEnv("OLLAMA_API_KEY") || file.apiKey,
    timeoutMs,
    systemPrompt,
    shellImage: fromEnv("DEVAGENT_SHELL_IMAGE") || file.shellImage,
    shellTimeoutSec,
  };
}