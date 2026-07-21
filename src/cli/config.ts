import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface LanguageOverride {
  enabled?: boolean;
  serverCommand?: string;
  serverArgs?: string[];
}

export interface LspCliConfig {
  idleTimeoutMs?: number;
  maxServers?: number;
  prewarm?: string[];
}

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
  languages?: Record<string, LanguageOverride>;
  lsp?: LspCliConfig;
  toolSelectionMode?: "heuristic" | "llm" | "hybrid";
  maxActiveTools?: number;
  /** Pool of Ollama Cloud API keys (e.g. separate accounts) — Provider rotates to the
   * next key on a 429 before giving up. Ollama Cloud only, not a multi-vendor router. */
  apiKeys?: string[];
  /** Preferred local model name (substring match) for the "quick" capability,
   * e.g. "minicpm5" — see ModelCatalog.modelsFor. */
  quickModel?: string;

  // ── Hybrid local-cloud architecture ──────────────────────────────────────
  /** Route trivial boilerplate tasks to the local quick model before calling cloud.
   * Default true when quickModel is set. Disable with DEVAGENT_LOCAL_WORKER=false. */
  enableLocalWorker?: boolean;
  /** After local generation, run a critic pass to catch confident-wrong answers.
   * Off by default (experimental). Enable with DEVAGENT_VERIFIER=true. */
  enableVerifier?: boolean;
  /** For 'unknown' heuristic decisions, draw N samples and check agreement.
   * Off by default. Enable with DEVAGENT_SELF_CONSISTENCY=true. */
  enableSelfConsistency?: boolean;
  /** Number of self-consistency samples. Default 3. */
  selfConsistencyN?: number;
  /** Agreement threshold below which to escalate. Default 0.5. */
  selfConsistencyThreshold?: number;
  /** TTL (ms) for the ModelAvailabilityChecker cache. Default 86_400_000 (24 h). */
  availabilityCheckTtlMs?: number;
  /** Pre-check cloud model subscription access at startup.
   * Default true when apiKeys are configured. Disable with DEVAGENT_AVAIL_CHECK=false. */
  enableAvailabilityCheck?: boolean;
  /** Layer-1 heuristic gate: skip the quick-model attempt entirely when the
   * prompt matches an explicit complexity trigger (debug/architecture/proof/
   * multi-step/etc.), escalating straight to the primary model instead.
   * Default true. Disable with DEVAGENT_HEURISTIC_GATE=false. */
  enableHeuristicGate?: boolean;
  /** Ollama itself has no published per-token price (subscription/GPU-time
   * billing) — this only computes a cost estimate if you supply your own
   * real rate. Omit to leave cost tracking off (the honest default). */
  pricing?: { inputPerMillion: number; outputPerMillion: number };
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
  toolSelectionMode?: string;
  maxActiveTools?: number;
  apiKeys?: string[];
  quickModel?: string;
  enableLocalWorker?: boolean;
  enableVerifier?: boolean;
  enableSelfConsistency?: boolean;
  selfConsistencyN?: number;
  selfConsistencyThreshold?: number;
  availabilityCheckTtlMs?: number;
  enableAvailabilityCheck?: boolean;
  enableHeuristicGate?: boolean;
  /** Ollama itself has no published per-token price (subscription/GPU-time
   * billing) — this only computes a cost estimate if you supply your own
   * real rate. Omit to leave cost tracking off (the honest default). */
  pricing?: { inputPerMillion: number; outputPerMillion: number };
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

// Matches how Claude Code/Cursor/most editor tooling resolve a project root:
// walk up from cwd to the nearest `.git` (a real repo needs no prior devagent
// session to be "found" — no chicken-and-egg where the first run in a new
// project, or a run from a subdirectory that hasn't had `.devagent` created
// yet, silently falls back to cwd and starts a disconnected history/config).
// `.devagent` presence is kept as a fallback signal for non-git workspaces.
function findWorkspaceRoot(cwd: string): string {
  if (process.env.DEVAGENT_WORKSPACE) return process.env.DEVAGENT_WORKSPACE;
  const home = homedir();
  const root = resolve("/");

  const walkUpTo = (marker: string): string | null => {
    let dir = resolve(cwd);
    while (dir !== root) {
      if (existsSync(join(dir, marker)) && dir !== home) return dir;
      dir = resolve(dir, "..");
    }
    return null;
  };

  return walkUpTo(".git") ?? walkUpTo(".devagent") ?? cwd;
}

function loadWorkspaceConfig(root: string): ConfigFile {
  const p = join(root, ".devagent", "config.json");
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
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const globalFile = loadGlobalConfig();
  const workspaceFile = loadWorkspaceConfig(workspaceRoot);
  // Workspace config overrides global, env vars override both
  const file = { ...globalFile, ...workspaceFile };
  const fromEnv = (key: string) => process.env[key];

  const rawTimeout = fromEnv("DEVAGENT_TIMEOUT_MS") || String(file.timeoutMs ?? "");
  const timeoutMs = rawTimeout && Number.isFinite(Number(rawTimeout)) ? Number(rawTimeout) : undefined;
  const rawShellTimeout = fromEnv("DEVAGENT_SHELL_TIMEOUT_SEC") || String(file.shellTimeoutSec ?? "");
  const shellTimeoutSec = rawShellTimeout && Number.isFinite(Number(rawShellTimeout)) ? Number(rawShellTimeout) : undefined;

  const basePrompt = fromEnv("DEVAGENT_SYSTEM_PROMPT") || file.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const agentsMd = loadAgentsFile(workspaceRoot);
  const systemPrompt = agentsMd ? `${basePrompt}\n\n## Project Rules\n\n${agentsMd}` : basePrompt;

  const rawMaxActiveTools = fromEnv("DEVAGENT_MAX_ACTIVE_TOOLS") || String(file.maxActiveTools ?? "");
  const maxActiveTools = rawMaxActiveTools && Number.isFinite(Number(rawMaxActiveTools)) ? Number(rawMaxActiveTools) : undefined;
  const toolSelectionMode = (fromEnv("DEVAGENT_TOOL_SELECTION_MODE") || file.toolSelectionMode) as "heuristic" | "llm" | "hybrid" | undefined;

  // Pool of Ollama Cloud keys: primary single key, comma-separated OLLAMA_API_KEYS,
  // and any keys listed in the config file, deduped in that priority order.
  const primaryApiKey = fromEnv("OLLAMA_API_KEY") || file.apiKey;
  const envKeys = (fromEnv("OLLAMA_API_KEYS") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const apiKeys = [...new Set([...(primaryApiKey ? [primaryApiKey] : []), ...envKeys, ...(file.apiKeys ?? [])])];

  const selfConsistencyN = Number(fromEnv("DEVAGENT_SC_N") || String(file.selfConsistencyN ?? "3"));
  const selfConsistencyThreshold = Number(
    fromEnv("DEVAGENT_SC_THRESHOLD") || String(file.selfConsistencyThreshold ?? "0.5"),
  );
  const availabilityCheckTtlMs = Number(
    fromEnv("DEVAGENT_AVAIL_TTL_MS") || String(file.availabilityCheckTtlMs ?? "86400000"),
  );

  const inputPerMillion = Number(fromEnv("DEVAGENT_PRICE_INPUT_PER_M") || String(file.pricing?.inputPerMillion ?? ""));
  const outputPerMillion = Number(fromEnv("DEVAGENT_PRICE_OUTPUT_PER_M") || String(file.pricing?.outputPerMillion ?? ""));
  const pricing =
    Number.isFinite(inputPerMillion) && Number.isFinite(outputPerMillion) && (inputPerMillion > 0 || outputPerMillion > 0)
      ? { inputPerMillion, outputPerMillion }
      : undefined;

  return {
    model: fromEnv("DEVAGENT_MODEL") || file.model || "qwen3.5:4b",
    workspaceRoot,
    tier: (fromEnv("DEVAGENT_TIER") || file.tier) === "cloud" ? "cloud" : "local",
    host: fromEnv("OLLAMA_HOST") || file.host,
    apiKey: primaryApiKey,
    timeoutMs,
    systemPrompt,
    shellImage: fromEnv("DEVAGENT_SHELL_IMAGE") || file.shellImage,
    shellTimeoutSec,
    toolSelectionMode,
    maxActiveTools,
    apiKeys: apiKeys.length ? apiKeys : undefined,
    quickModel: fromEnv("DEVAGENT_QUICK_MODEL") || file.quickModel,
    // Hybrid architecture flags
    enableLocalWorker: fromEnv("DEVAGENT_LOCAL_WORKER") !== "false" && (file.enableLocalWorker ?? true),
    enableVerifier: fromEnv("DEVAGENT_VERIFIER") === "true" || (file.enableVerifier ?? false),
    enableSelfConsistency:
      fromEnv("DEVAGENT_SELF_CONSISTENCY") === "true" || (file.enableSelfConsistency ?? false),
    selfConsistencyN,
    selfConsistencyThreshold,
    availabilityCheckTtlMs,
    enableAvailabilityCheck:
      fromEnv("DEVAGENT_AVAIL_CHECK") !== "false" && (file.enableAvailabilityCheck ?? true),
    enableHeuristicGate: fromEnv("DEVAGENT_HEURISTIC_GATE") !== "false" && (file.enableHeuristicGate ?? true),
    pricing,
  };
}