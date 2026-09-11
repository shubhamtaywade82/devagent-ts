import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { LspManager } from "@nemesis-oss/nexum-tools/lsp/manager";
import { LanguageRegistry } from "@nemesis-oss/nexum-tools/lsp/registry";
import { SemanticIndex } from "@nemesis-oss/nexum-tools/intelligence/rails/index";
import { WorkspaceKnowledgeEngine } from "@nemesis-oss/nexum-tools/intelligence/knowledge-engine";
import { workspaceStateDir } from "@nemesis-oss/nexum-core/platform/paths";
import { LspSemanticPlugin } from "@nemesis-oss/nexum-tools/intelligence/semantic-plugin";
import { RailsSemanticPlugin } from "@nemesis-oss/nexum-tools/intelligence/rails/rails-plugin";
import { AslSemanticPlugin } from "@nemesis-oss/nexum-tools/intelligence/asl-plugin";
import type { SemanticQuery, CompositeResult } from "@nemesis-oss/nexum-tools/intelligence/types";
import type { LspServerState } from "@nemesis-oss/nexum-tools/lsp/protocol";

export interface AgentIntelligenceOptions {
  workspaceRoot: string;
  languages?: Record<string, Partial<import("@nemesis-oss/nexum-tools/lsp/registry").LanguageProviderConfig>>;
  lspConfig?: import("@nemesis-oss/nexum-tools/lsp/config").LspGlobalConfig;
  prewarm?: string[];
  onDiagnostics?: (filePath: string, diagnostics: unknown[]) => void;
  onServerStateChange?: (servers: LspServerState[]) => void;
}

export class AgentIntelligence {
  readonly lspManager: LspManager;
  readonly railsIndex: SemanticIndex;
  readonly knowledgeEngine: WorkspaceKnowledgeEngine;

  constructor(opts: AgentIntelligenceOptions) {
    const langRegistry = new LanguageRegistry(
      opts.languages as
        Record<string, Partial<import("@nemesis-oss/nexum-tools/lsp/registry").LanguageProviderConfig>> | undefined,
    );

    this.lspManager = new LspManager({
      workspaceRoot: opts.workspaceRoot,
      registry: langRegistry,
      lspConfig: opts.lspConfig ?? {},
      events: {
        onDiagnostics: opts.onDiagnostics,
        onServerStateChange: opts.onServerStateChange,
      },
    });

    if (opts.prewarm && opts.prewarm.length > 0) {
      this.lspManager.prewarm(opts.prewarm).catch(() => {});
    }

    const stateDir = workspaceStateDir(opts.workspaceRoot);
    mkdirSync(stateDir, { recursive: true });

    this.railsIndex = SemanticIndex.create(opts.workspaceRoot, {
      cachePath: join(stateDir, "rails-index.db"),
    });

    if (this.railsIndex.enabled) {
      this.railsIndex.build().catch(() => {});
    }

    this.knowledgeEngine = new WorkspaceKnowledgeEngine();
    this.knowledgeEngine.register(new LspSemanticPlugin(this.lspManager));
    this.knowledgeEngine.register(new RailsSemanticPlugin(this.railsIndex));
    this.knowledgeEngine.register(new AslSemanticPlugin(opts.workspaceRoot));
  }

  feedRailsIndex(toolName: string, args: Record<string, unknown>, result: Record<string, unknown>): void {
    if (!this.railsIndex.enabled || result.error) return;
    const MUTATING = new Set(["write_file", "patch_file", "append_file", "delete_file", "move_file", "copy_file"]);
    if (!MUTATING.has(toolName)) return;
    const paths = [args.path, args.source, args.destination, args.from, args.to].filter(
      (p): p is string => typeof p === "string" && (p.endsWith(".rb") || p.endsWith("Gemfile.lock")),
    );
    if (paths.length) this.railsIndex.update(paths).catch(() => {});
  }

  async semanticQuery(query: SemanticQuery): Promise<CompositeResult> {
    return this.knowledgeEngine.query(query);
  }

  get enabledPlugins(): string[] {
    return this.knowledgeEngine
      .getPlugins()
      .filter((p) => p.detect())
      .map((p) => p.id);
  }
}
