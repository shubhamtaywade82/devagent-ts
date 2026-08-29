import { Registry } from "../tools/registry.js";
import { ReadFileTool, WriteFileTool } from "../tools/filesystem.js";
import { ShellTool } from "../tools/shell.js";
import {
  ListDirectoryTool, DeleteFileTool, MakeDirectoryTool, CopyFileTool, MoveFileTool,
} from "../tools/directory-tools.js";
import { PatchTool, AppendTool } from "../tools/edit-tools.js";
import { SnapshotBackupTool } from "../tools/backup-tools.js";
import { WatchTool } from "../tools/watch-tool.js";
import { SearchCodeTool } from "../tools/search-tools.js";
import { GitTool } from "../tools/git-tools.js";
import { EscalateTaskTool } from "../tools/escalate-tool.js";
import { DockerTool } from "../tools/docker-tools.js";
import { GitHubTool } from "../tools/github-tools.js";
import { SqliteQueryTool } from "../tools/database-tools.js";
import { RunTestsTool, RunLintTool, RunFormatTool, RunBuildTool } from "../tools/project-tools.js";
import { RunRubocopTool } from "../tools/rubocop-tool.js";
import { RunRSpecTool } from "../tools/rspec-tool.js";
import {
  GetDefinitionTool, FindReferencesTool, RenameSymbolTool,
  WorkspaceSymbolsTool, DocumentSymbolsTool, HoverTool,
  DiagnosticsTool, CodeActionsTool, FormatDocumentTool,
  SignatureHelpTool, CompletionTool, SemanticTokensTool,
} from "../tools/lsp-tools.js";
import { LspManager } from "../lsp/manager.js";
import {
  BrowserNavigateTool, BrowserClickTool, BrowserFillTool,
  BrowserGetTextTool, BrowserScreenshotTool, BrowserEvaluateTool, BrowserCloseTool,
} from "../tools/browser-tools.js";
import { BrowserManager } from "../browser/manager.js";
import {
  BinancePublicApiTool, BinanceTechnicalIndicatorsTool, BinanceOrderBookTool,
  BinanceFuturesStatsTool, BinanceScreenerTool, BinanceWatchPriceTool,
  BinanceUnwatchPriceTool, BinancePriceAlertTool, BinanceLiquidationsTool,
} from "../tools/binance-tools.js";
import { BinanceStreamManager } from "../exchange/binance-stream.js";
import {
  BinanceBacktestTool, BinanceWalkForwardTool, BinanceMonteCarloTool, BinanceParamSweepTool,
} from "../tools/backtest-tools.js";
import { BinancePaperTradeTool } from "../tools/paper-trading-tools.js";
import { PaperTradingManager } from "../exchange/paper-trading.js";
import { SemanticIndex, createRailsTools } from "../intelligence/rails/index.js";
import { connectMcpServer } from "../mcp/client.js";
import { Tool } from "../tools/tool.js";
import { SearchDocsTool, GetDocTool, ListDocSourcesTool } from "../tools/docs-tools.js";
import { DocsStore } from "../docs/store.js";
import { DelegateToLocalTool } from "../tools/delegate-tool.js";
import type { LocalWorker } from "../provider/local-worker.js";

export type ToolOnOutput = (stream: "stdout" | "stderr", chunk: string) => void;

export class AgentToolManager {
  readonly registry = new Registry();

  constructor() {}

  registerBaseTools(root: string, onOutput?: ToolOnOutput): void {
    const shellOpts: ConstructorParameters<typeof ShellTool>[0] = {
      workspaceRoot: root,
    };
    if (onOutput) shellOpts.onOutput = onOutput;

    this.registry
      .register(new ReadFileTool(root), "Filesystem")
      .register(new WriteFileTool(root), "Filesystem")
      .register(new ShellTool(shellOpts), "Shell")
      .register(new ListDirectoryTool(root), "Filesystem")
      .register(new DeleteFileTool(root), "Filesystem")
      .register(new MakeDirectoryTool(root), "Filesystem")
      .register(new CopyFileTool(root), "Filesystem")
      .register(new MoveFileTool(root), "Filesystem")
      .register(new PatchTool(root), "Filesystem")
      .register(new AppendTool(root), "Filesystem")
      .register(new SnapshotBackupTool(root), "Filesystem")
      .register(new WatchTool(root), "Filesystem")
      .register(new SearchCodeTool(root), "Search")
      .register(new GitTool(root), "Git")
      .register(new EscalateTaskTool(), "Agent")
      .register(new DockerTool(root), "Docker")
      .register(new GitHubTool(root), "Git")
      .register(new SqliteQueryTool(root), "Database")
      .register(new RunTestsTool(root), "Project")
      .register(new RunLintTool(root), "Project")
      .register(new RunFormatTool(root), "Project")
      .register(new RunBuildTool(root), "Project")
      .register(new RunRubocopTool(root), "Ruby")
      .register(new RunRSpecTool(root), "Ruby")
      .register(new BinancePublicApiTool(), "Market")
      .register(new BinanceTechnicalIndicatorsTool(), "Market")
      .register(new BinanceOrderBookTool(), "Market")
      .register(new BinanceFuturesStatsTool(), "Market")
      .register(new BinanceScreenerTool(), "Market")
      .register(new BinanceBacktestTool(), "Market")
      .register(new BinanceWalkForwardTool(), "Market")
      .register(new BinanceMonteCarloTool(), "Market")
      .register(new BinanceParamSweepTool(), "Market");
  }

  registerHybridTools(localWorker: LocalWorker | undefined): void {
    if (!localWorker) return;
    this.registry.register(new DelegateToLocalTool(localWorker), "Agent");
  }

  registerBinanceStreamTools(stream: BinanceStreamManager): void {
    this.registry
      .register(new BinanceWatchPriceTool(stream), "Market")
      .register(new BinanceUnwatchPriceTool(stream), "Market")
      .register(new BinancePriceAlertTool(stream), "Market")
      .register(new BinanceLiquidationsTool(stream), "Market");

    const paper = new PaperTradingManager(stream);
    this.registry.register(new BinancePaperTradeTool(paper), "Market");
  }

  registerLspTools(lsp: LspManager): void {
    this.registry
      .register(new GetDefinitionTool(lsp), "Code Intelligence")
      .register(new FindReferencesTool(lsp), "Code Intelligence")
      .register(new RenameSymbolTool(lsp), "Code Intelligence")
      .register(new WorkspaceSymbolsTool(lsp), "Code Intelligence")
      .register(new DocumentSymbolsTool(lsp), "Code Intelligence")
      .register(new HoverTool(lsp), "Code Intelligence")
      .register(new DiagnosticsTool(lsp), "Code Intelligence")
      .register(new CodeActionsTool(lsp), "Code Intelligence")
      .register(new FormatDocumentTool(lsp), "Code Intelligence")
      .register(new SignatureHelpTool(lsp), "Code Intelligence")
      .register(new CompletionTool(lsp), "Code Intelligence")
      .register(new SemanticTokensTool(lsp), "Code Intelligence");
  }

  registerBrowserTools(browser: BrowserManager): void {
    this.registry
      .register(new BrowserNavigateTool(browser), "Browser")
      .register(new BrowserClickTool(browser), "Browser")
      .register(new BrowserFillTool(browser), "Browser")
      .register(new BrowserGetTextTool(browser), "Browser")
      .register(new BrowserScreenshotTool(browser), "Browser")
      .register(new BrowserEvaluateTool(browser), "Browser")
      .register(new BrowserCloseTool(browser), "Browser");
  }

  registerRailsTools(rails: SemanticIndex): void {
    for (const tool of createRailsTools(rails)) {
      this.registry.register(tool, "Rails");
    }
  }

  registerDocsTools(store: DocsStore, workspaceRoot: string): void {
    this.registry
      .register(new SearchDocsTool(store, workspaceRoot), "Docs")
      .register(new GetDocTool(store), "Docs")
      .register(new ListDocSourcesTool(store, workspaceRoot), "Docs");
  }

  registerTool(tool: Tool, category = "General"): void {
    this.registry.register(tool, category);
  }

  async registerMcpServer(command: string, args: string[] = []): Promise<Tool[]> {
    const tools = await connectMcpServer(command, args);
    for (const tool of tools) this.registry.register(tool, "MCP");
    return tools;
  }
}
