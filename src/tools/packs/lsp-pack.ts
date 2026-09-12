/**
 * LspPack (review item 21) — code intelligence via the language server plane.
 */

import { Tool } from "../tool.js";
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
} from "../lsp-tools.js";
import type { LspManager } from "../../lsp/manager.js";
import { ToolPack, packOf } from "../gateway/tool-pack.js";
import type { ToolRisk } from "../../core/tools/tool-contract.js";

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
