import { Registry } from "@nemesis-oss/nexum-tools/tools/registry";
import { Tool } from "@nemesis-oss/nexum-tools/tools/tool";
import { connectMcpServer } from "@nemesis-oss/nexum-mcp/mcp/client";
import type { LocalWorker } from "@nemesis-oss/nexum-models/provider/local-worker";
import type { ClarificationRequester } from "@nemesis-oss/nexum-tools/tools/ask-user-tool";
import type { LspManager } from "@nemesis-oss/nexum-tools/lsp/manager";
import type { BrowserManager } from "@nemesis-oss/nexum-tools/browser/manager";
import type { BinanceStreamManager } from "@nemesis-oss/nexum-tools/exchange/binance-stream";
import type { SemanticIndex } from "@nemesis-oss/nexum-tools/intelligence/rails/index";
import type { DocsStore } from "@nemesis-oss/nexum-tools/docs/store";
import type { ToolResult } from "@nemesis-oss/nexum-core/kernel/tools/tool-definition";
import { DefaultToolGateway } from "@nemesis-oss/nexum-core/kernel/tools/tool-gateway";
import { ToolCatalog } from "@nemesis-oss/nexum-core/kernel/tools/tool-catalog";
import { mountToolPack, ToolPack } from "@nemesis-oss/nexum-core/kernel/tools/tool-pack";
import { parityPosture } from "@nemesis-oss/nexum-core/kernel/policy/postures";
import {
  agentCorePack,
  browserPack,
  cryptoPack,
  databasePack,
  dockerPack,
  docsPack,
  filesystemPack,
  gitPack,
  lspPack,
  projectPack,
  railsPack,
  rubyPack,
  searchPack,
  shellPack,
} from "@nemesis-oss/nexum-tools/packs/index";

export type ToolOnOutput = (stream: "stdout" | "stderr", chunk: string) => void;

/**
 * Tool ownership and registration.
 *
 * Refactored around kernel ToolPacks: every register* method now builds a
 * pack and mounts it into BOTH the legacy Registry (the CLI Agent's
 * execution path during migration) and the kernel ToolCatalog (metadata +
 * ToolGateway enforcement for kernel-native runs). Tool definitions and
 * their risk/side-effect metadata live with the domain packs
 * (src/packs/index.ts); this class is becoming a thin composition root.
 */
export class AgentToolManager {
  readonly registry = new Registry();
  /** Kernel-side catalog mirroring the legacy registry (ToolDefinitions). */
  readonly kernelCatalog = new ToolCatalog();
  /**
   * Gateway for kernel-native tool invocation. Since the enforcement flip
   * this runs the parity posture (RulePolicyEngine): destructive shell,
   * git push / PR creation, file deletion, and financial tools require a
   * resolved confirmation — surfaced as a structured ConfirmationRequired
   * outcome that the strategy's resolveConfirmation hook resolves through
   * the ApprovalBroker. Schema validation is strict: malformed tool
   * arguments fail as structured ValidationError observations (after the
   * weak-model repair pass) instead of reaching tool code.
   */
  readonly gateway: DefaultToolGateway;
  /** Packs mounted this session, by id (observability / capability scoping). */
  readonly mountedPacks = new Map<string, ToolPack>();

  constructor() {
    this.gateway = new DefaultToolGateway({
      catalog: this.kernelCatalog,
      policyEngine: parityPosture(),
      validation: "strict",
      label: "tool-gateway",
    });
  }

  /**
   * Mount a pack: kernel catalog (definitions + handlers) and legacy
   * registry (execution parity). Later packs win on name collisions, both
   * sides — matching the legacy register() overwrite semantics.
   */
  registerToolPack(pack: ToolPack): void {
    this.mountedPacks.set(pack.id, pack);
    mountToolPack(pack, this.kernelCatalog);
    for (const entry of pack.entries) {
      this.registry.register(entry.tool, entry.category ?? "General");
    }
  }

  registerBaseTools(root: string, onOutput?: ToolOnOutput): void {
    this.registerToolPack(filesystemPack(root));
    this.registerToolPack(shellPack(root, onOutput));
    this.registerToolPack(searchPack(root));
    this.registerToolPack(gitPack(root));
    this.registerToolPack(projectPack(root));
    this.registerToolPack(rubyPack(root));
    this.registerToolPack(dockerPack(root));
    this.registerToolPack(databasePack(root));
  }

  registerHybridTools(localWorker: LocalWorker | undefined): void {
    this.registerToolPack(agentCorePack({ localWorker }));
  }

  registerClarificationTool(requester: ClarificationRequester): void {
    this.registerToolPack(agentCorePack({ requester }));
  }

  registerBinanceStreamTools(stream: BinanceStreamManager): void {
    this.registerToolPack(cryptoPack(stream));
  }

  registerLspTools(lsp: LspManager): void {
    this.registerToolPack(lspPack(lsp));
  }

  registerBrowserTools(browser: BrowserManager): void {
    this.registerToolPack(browserPack(browser));
  }

  registerRailsTools(rails: SemanticIndex): void {
    this.registerToolPack(railsPack(rails));
  }

  registerDocsTools(store: DocsStore, workspaceRoot: string): void {
    this.registerToolPack(docsPack(store, workspaceRoot));
  }

  registerTool(tool: Tool, category = "General"): void {
    this.registry.register(tool, category);
    this.kernelCatalog.registerLegacy(tool, category);
  }

  async registerMcpServer(command: string, args: string[] = []): Promise<Tool[]> {
    const tools = await connectMcpServer(command, args);
    for (const tool of tools) this.registerTool(tool, "MCP");
    return tools;
  }

  /**
   * Kernel gateway invocation: normalize → validate(policy per engine) →
   * per-tool concurrency → timeout → structured ToolResult. `result.data`
   * keeps the exact record shape the legacy Registry.invoke returned, so
   * callers migrate by swapping the call, not the handling code.
   */
  invokeTool(
    name: string,
    args: Record<string, unknown>,
    ctx?: { agentId?: string; runId?: string; signal?: AbortSignal },
  ): Promise<ToolResult> {
    return this.gateway.invoke(name, args, ctx);
  }
}
