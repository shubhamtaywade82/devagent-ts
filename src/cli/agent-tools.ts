import { Registry } from "../tools/registry";
import { ReadFileTool, WriteFileTool } from "../tools/filesystem";
import { ShellTool } from "../tools/shell";
import {
  ListDirectoryTool, DeleteFileTool, MakeDirectoryTool, CopyFileTool, MoveFileTool,
} from "../tools/directory-tools";
import { PatchTool, AppendTool } from "../tools/edit-tools";
import { SnapshotBackupTool } from "../tools/backup-tools";
import { WatchTool } from "../tools/watch-tool";
import { SearchCodeTool } from "../tools/search-tools";
import { GitTool } from "../tools/git-tools";
import { DockerTool } from "../tools/docker-tools";
import { GitHubTool } from "../tools/github-tools";
import { SqliteQueryTool } from "../tools/database-tools";
import { RunTestsTool, RunLintTool, RunFormatTool, RunBuildTool } from "../tools/project-tools";
import { RunRubocopTool } from "../tools/rubocop-tool";
import { RunRSpecTool } from "../tools/rspec-tool";
import {
  GetDefinitionTool, FindReferencesTool, RenameSymbolTool,
  WorkspaceSymbolsTool, DocumentSymbolsTool, HoverTool,
  DiagnosticsTool, CodeActionsTool, FormatDocumentTool,
  SignatureHelpTool, CompletionTool, SemanticTokensTool,
} from "../tools/lsp-tools";
import { LspManager } from "../lsp/manager";
import { SemanticIndex, createRailsTools } from "../intelligence/rails";
import { connectMcpServer } from "../mcp/client";
import { Tool } from "../tools/tool";

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
      .register(new ReadFileTool(root))
      .register(new WriteFileTool(root))
      .register(new ShellTool(shellOpts))
      .register(new ListDirectoryTool(root))
      .register(new DeleteFileTool(root))
      .register(new MakeDirectoryTool(root))
      .register(new CopyFileTool(root))
      .register(new MoveFileTool(root))
      .register(new PatchTool(root))
      .register(new AppendTool(root))
      .register(new SnapshotBackupTool(root))
      .register(new WatchTool(root))
      .register(new SearchCodeTool(root))
      .register(new GitTool(root))
      .register(new DockerTool(root))
      .register(new GitHubTool(root))
      .register(new SqliteQueryTool(root))
      .register(new RunTestsTool(root))
      .register(new RunLintTool(root))
      .register(new RunFormatTool(root))
      .register(new RunBuildTool(root))
      .register(new RunRubocopTool(root))
      .register(new RunRSpecTool(root));
  }

  registerLspTools(lsp: LspManager): void {
    this.registry
      .register(new GetDefinitionTool(lsp))
      .register(new FindReferencesTool(lsp))
      .register(new RenameSymbolTool(lsp))
      .register(new WorkspaceSymbolsTool(lsp))
      .register(new DocumentSymbolsTool(lsp))
      .register(new HoverTool(lsp))
      .register(new DiagnosticsTool(lsp))
      .register(new CodeActionsTool(lsp))
      .register(new FormatDocumentTool(lsp))
      .register(new SignatureHelpTool(lsp))
      .register(new CompletionTool(lsp))
      .register(new SemanticTokensTool(lsp));
  }

  registerRailsTools(rails: SemanticIndex): void {
    for (const tool of createRailsTools(rails)) {
      this.registry.register(tool);
    }
  }

  registerTool(tool: Tool): void {
    this.registry.register(tool);
  }

  async registerMcpServer(command: string, args: string[] = []): Promise<void> {
    const tools = await connectMcpServer(command, args);
    for (const tool of tools) this.registry.register(tool);
  }
}
