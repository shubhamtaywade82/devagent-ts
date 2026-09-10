/**
 * Domain packs — bridge between domain tools and the kernel.
 *
 * The kernel never imports these; products mount them explicitly:
 *
 *   devAgent.mount(filesystemPack, gitPack, lspPack, ...)
 *   cryptoAgent.mount(cryptoPack)
 *
 * Each pack declares the risk/side-effect/confirmation metadata for its
 * tools (the security contract), so the ToolGateway can enforce it without
 * the runtime knowing any domain semantics.
 */

import { Tool } from "../tools/tool.js";
import {
  ReadFileTool,
  WriteFileTool,
} from "../tools/filesystem.js";
import { ShellTool } from "../tools/shell.js";
import {
  ListDirectoryTool,
  DeleteFileTool,
  MakeDirectoryTool,
  CopyFileTool,
  MoveFileTool,
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
  GetDefinitionTool,
  FindReferencesTool,
  RenameSymbolTool,
  WorkspaceSymbolsTool,
  DocumentSymbolsTool,
  HoverTool,
  DiagnosticsTool,
  CodeActionsTool,
  FormatDocumentTool,
  SignatureHelpTool,
  CompletionTool,
  SemanticTokensTool,
} from "../tools/lsp-tools.js";
import { LspManager } from "../lsp/manager.js";
import {
  BrowserNavigateTool,
  BrowserClickTool,
  BrowserFillTool,
  BrowserGetTextTool,
  BrowserScreenshotTool,
  BrowserEvaluateTool,
  BrowserCloseTool,
} from "../tools/browser-tools.js";
import { BrowserManager } from "../browser/manager.js";
import {
  BinancePublicApiTool,
  BinanceTechnicalIndicatorsTool,
  BinanceOrderBookTool,
  BinanceFuturesStatsTool,
  BinanceScreenerTool,
  BinanceWatchPriceTool,
  BinanceUnwatchPriceTool,
  BinancePriceAlertTool,
  BinanceLiquidationsTool,
  BinanceOhlcvTool,
  BinanceMultiTimeframeTool,
  BinanceVolumeTool,
  BinanceFundingHistoryTool,
  BinanceOpenInterestHistoryTool,
  BinanceFuturesBasisTool,
} from "../tools/binance-tools.js";
import {
  BinanceBacktestTool,
  BinanceWalkForwardTool,
  BinanceMonteCarloTool,
  BinanceParamSweepTool,
} from "../tools/backtest-tools.js";
import { BinancePaperTradeTool } from "../tools/paper-trading-tools.js";
import { BinanceStreamManager } from "../exchange/binance-stream.js";
import { PaperTradingManager } from "../exchange/paper-trading.js";
import { SemanticIndex, createRailsTools } from "../intelligence/rails/index.js";
import { SearchDocsTool, GetDocTool, ListDocSourcesTool } from "../tools/docs-tools.js";
import { DocsStore } from "../docs/store.js";
import { DelegateToLocalTool } from "../tools/delegate-tool.js";
import type { LocalWorker } from "../provider/local-worker.js";
import { AskUserTool, ClarificationRequester } from "../tools/ask-user-tool.js";

import { ToolPack, ToolPackEntry, packOf } from "../kernel/tools/tool-pack.js";
import type { ToolRisk } from "../kernel/tools/tool-definition.js";

export type PackShellOutput = (stream: "stdout" | "stderr", chunk: string) => void;

type Meta = ToolPackEntry["metadata"];

/** Filesystem CRUD + patch + watch — the DevAgent's core mutation surface. */
export function filesystemPack(root: string): ToolPack {
  return packOf(
    "filesystem",
    "Workspace file operations: read, write, list, copy, move, delete, patch, watch.",
    "filesystem",
    [
      new ReadFileTool(root),
      new WriteFileTool(root),
      new ListDirectoryTool(root),
      new DeleteFileTool(root),
      new MakeDirectoryTool(root),
      new CopyFileTool(root),
      new MoveFileTool(root),
      new PatchTool(root),
      new AppendTool(root),
      new SnapshotBackupTool(root),
      new WatchTool(root),
    ],
    "Filesystem",
  );
}

/** Shell execution — Docker-sandboxed at the tool level; declared high-risk. */
export function shellPack(root: string, onOutput?: PackShellOutput): ToolPack {
  const opts: ConstructorParameters<typeof ShellTool>[0] = { workspaceRoot: root };
  if (onOutput) opts.onOutput = onOutput;
  const shell = new ShellTool(opts);
  return packOf(
    "shell",
    "Shell command execution (Docker-sandboxed when available).",
    "process",
    [[shell, { risk: "high", sideEffects: { filesystem: true, process: true, network: true } }]],
    "Shell",
  );
}

export function searchPack(root: string): ToolPack {
  return packOf("search", "Workspace code search.", "search", [new SearchCodeTool(root)], "Search");
}

export function gitPack(root: string): ToolPack {
  return packOf(
    "git",
    "Git and GitHub operations.",
    "vcs",
    [
      new GitTool(root),
      new GitHubTool(root),
    ].map((tool) => ({ tool, category: "Git", metadata: { risk: "high" as ToolRisk } })),
    "Git",
  );
}

export function projectPack(root: string): ToolPack {
  return packOf(
    "project",
    "Project lifecycle: tests, lint, format, build.",
    "build",
    [
      new RunTestsTool(root),
      new RunLintTool(root),
      new RunFormatTool(root),
      new RunBuildTool(root),
    ].map((tool) => ({ tool, category: "Project", metadata: { risk: "medium" as ToolRisk } })),
    "Project",
  );
}

export function rubyPack(root: string): ToolPack {
  return packOf(
    "ruby",
    "Ruby/Rails project tooling: RuboCop, RSpec.",
    "build",
    [new RunRubocopTool(root), new RunRSpecTool(root)],
    "Ruby",
  );
}

export function dockerPack(root: string): ToolPack {
  return packOf(
    "docker",
    "Docker container management.",
    "devops",
    [[new DockerTool(root), { risk: "high", sideEffects: { process: true, network: true } }]],
    "Docker",
  );
}

export function databasePack(root: string): ToolPack {
  return packOf(
    "database",
    "SQLite queries against workspace databases.",
    "data",
    [[new SqliteQueryTool(root), { risk: "medium", sideEffects: { filesystem: true } }]],
    "Database",
  );
}

export function lspPack(lsp: LspManager): ToolPack {
  return packOf(
    "lsp",
    "Code intelligence: definitions, references, rename, hover, diagnostics.",
    "code-intelligence",
    [
      new GetDefinitionTool(lsp),
      new FindReferencesTool(lsp),
      new RenameSymbolTool(lsp),
      new WorkspaceSymbolsTool(lsp),
      new DocumentSymbolsTool(lsp),
      new HoverTool(lsp),
      new DiagnosticsTool(lsp),
      new CodeActionsTool(lsp),
      new FormatDocumentTool(lsp),
      new SignatureHelpTool(lsp),
      new CompletionTool(lsp),
      new SemanticTokensTool(lsp),
    ].map((tool) => ({ tool, category: "Code Intelligence", metadata: { risk: "medium" as ToolRisk } })),
    "Code Intelligence",
  );
}

export function browserPack(browser: BrowserManager): ToolPack {
  return packOf(
    "browser",
    "Browser automation: navigate, click, fill, extract, screenshot, evaluate.",
    "browser",
    [
      new BrowserNavigateTool(browser),
      new BrowserClickTool(browser),
      new BrowserFillTool(browser),
      new BrowserGetTextTool(browser),
      new BrowserScreenshotTool(browser),
      new BrowserEvaluateTool(browser),
      new BrowserCloseTool(browser),
    ].map((tool) => ({ tool, category: "Browser", metadata: { risk: "medium" as ToolRisk } })),
    "Browser",
  );
}

export function docsPack(store: DocsStore, workspaceRoot: string): ToolPack {
  return packOf(
    "docs",
    "Workspace documentation search and retrieval.",
    "docs",
    [new SearchDocsTool(store, workspaceRoot), new GetDocTool(store), new ListDocSourcesTool(store, workspaceRoot)],
    "Docs",
  );
}

export function railsPack(rails: SemanticIndex): ToolPack {
  const tools: Tool[] = createRailsTools(rails);
  return packOf("rails", "Rails semantic index queries.", "code-intelligence", tools, "Rails");
}

/** Kernel-facing agent affordances: escalation, delegation, clarification. */
export function agentCorePack(opts: {
  localWorker?: LocalWorker;
  requester?: ClarificationRequester;
}): ToolPack {
  const entries: ToolPackEntry[] = [{ tool: new EscalateTaskTool(), category: "Agent" }];
  if (opts.localWorker) {
    entries.push({ tool: new DelegateToLocalTool(opts.localWorker), category: "Agent" });
  }
  if (opts.requester) {
    entries.push({ tool: new AskUserTool(opts.requester), category: "Agent" });
  }
  return defineAgentCorePack(entries);
}

function defineAgentCorePack(entries: ToolPackEntry[]): ToolPack {
  return {
    id: "agent-core",
    description: "Agent affordances: escalate, delegate, ask user.",
    capability: "agent",
    entries,
  };
}

// ── Crypto domain pack ──────────────────────────────────────────────────────

/**
 * CryptoToolPack — the entire crypto/trading domain as one mountable pack.
 * Nothing above this file needs to know Binance exists. Market-data tools
 * are read-only; execution tools (paper trading) declare financial side
 * effects so the PolicyEngine demands confirmation before any trade.
 */
export function cryptoPack(stream: BinanceStreamManager): ToolPack {
  const marketTools: Tool[] = [
    new BinancePublicApiTool(),
    new BinanceTechnicalIndicatorsTool(),
    new BinanceOrderBookTool(),
    new BinanceFuturesStatsTool(),
    new BinanceScreenerTool(),
    new BinanceOhlcvTool(),
    new BinanceMultiTimeframeTool(),
    new BinanceVolumeTool(),
    new BinanceFundingHistoryTool(),
    new BinanceOpenInterestHistoryTool(),
    new BinanceFuturesBasisTool(),
  ];
  const analysisTools: Tool[] = [
    new BinanceBacktestTool(),
    new BinanceWalkForwardTool(),
    new BinanceMonteCarloTool(),
    new BinanceParamSweepTool(),
  ];
  const streamTools: Tool[] = [
    new BinanceWatchPriceTool(stream),
    new BinanceUnwatchPriceTool(stream),
    new BinancePriceAlertTool(stream),
    new BinanceLiquidationsTool(stream),
  ];
  const paper = new PaperTradingManager(stream);

  const readMeta: Meta = { risk: "read", sideEffects: { network: true } };
  const entries: ToolPackEntry[] = [
    ...marketTools.map((tool) => ({ tool, category: "Market", metadata: readMeta })),
    ...analysisTools.map((tool) => ({ tool, category: "Market", metadata: readMeta })),
    ...streamTools.map((tool) => ({ tool, category: "Market", metadata: { risk: "low" as ToolRisk, sideEffects: { network: true } } })),
    {
      tool: new BinancePaperTradeTool(paper),
      category: "Market",
      metadata: {
        risk: "critical",
        sideEffects: { network: true, financial: true, externalMutation: true },
        policy: { confirmation: "required" },
        execution: { concurrency: 1, idempotent: false, reversible: false, timeoutMs: 30_000 },
      },
    },
  ];

  return {
    id: "crypto-trading",
    description: "Crypto market data, technical analysis, backtesting, and paper trading (Binance).",
    capability: "market",
    entries,
  };
}
