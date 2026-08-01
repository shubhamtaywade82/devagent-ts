import { loadConfig } from "./config.js";
import { LspManager } from "../lsp/manager.js";
import type { LspServerState } from "../lsp/protocol.js";
import { fileURLToPath } from "node:url";

export type DoctorReport = {
  ok: boolean;
  lines: string[];
};

export async function runDoctor(): Promise<DoctorReport> {
  const lines: string[] = [];
  const config = loadConfig();

  lines.push(`workspaceRoot: ${config.workspaceRoot}`);
  lines.push(`model: ${config.model}`);
  lines.push(`host: ${config.host ?? "http://localhost:11434"}`);
  lines.push(`apiKeysCount: ${(config.apiKeys || []).length}`);

  try {
    const lsp = new LspManager({ workspaceRoot: config.workspaceRoot });
    const providers = lsp.registry.allProviders();
    const activeStates: LspServerState[] = lsp.getServerStates();
    lines.push(`lsp: ${providers.length} configured language providers`);
    for (const p of providers.slice(0, 8)) {
      lines.push(`  - ${p.id} (${p.language}) -> ${p.serverCommand}`);
    }
    if (activeStates.length > 0) {
      lines.push(`lsp active sessions: ${activeStates.length}`);
      for (const s of activeStates) {
        lines.push(`  - ${s.language}: ${s.status}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`lsp: check failed (${msg})`);
  }

  return { ok: true, lines };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  runDoctor().then((r) => {
    console.log("=== DevAgent Doctor ===");
    console.log(r.lines.join("\n"));
  });
}
