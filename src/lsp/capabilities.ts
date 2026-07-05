import type { ServerCapabilities } from "vscode-languageserver-protocol";

export interface LspCapabilities {
  hover: boolean;
  completion: boolean;
  rename: boolean;
  definition: boolean;
  references: boolean;
  diagnostics: boolean;
  semanticTokens: boolean;
  formatting: boolean;
  codeAction: boolean;
  signatureHelp: boolean;
  documentSymbol: boolean;
  workspaceSymbol: boolean;
}

export function deriveCapabilities(serverCaps: ServerCapabilities): LspCapabilities {
  const textDocument = serverCaps.textDocumentSync !== undefined;
  return {
    hover: !!serverCaps.hoverProvider,
    completion: !!serverCaps.completionProvider,
    rename: !!serverCaps.renameProvider,
    definition: !!(
      serverCaps.definitionProvider ||
      serverCaps.typeDefinitionProvider ||
      serverCaps.implementationProvider
    ),
    references: !!serverCaps.referencesProvider,
    diagnostics: textDocument && !!serverCaps.codeActionProvider,
    semanticTokens:
      !!serverCaps.semanticTokensProvider &&
      typeof serverCaps.semanticTokensProvider !== "boolean",
    formatting: !!serverCaps.documentFormattingProvider,
    codeAction: !!serverCaps.codeActionProvider,
    signatureHelp: !!serverCaps.signatureHelpProvider,
    documentSymbol: !!serverCaps.documentSymbolProvider,
    workspaceSymbol: !!serverCaps.workspaceSymbolProvider,
  };
}

export const NO_CAPABILITIES: LspCapabilities = {
  hover: false,
  completion: false,
  rename: false,
  definition: false,
  references: false,
  diagnostics: false,
  semanticTokens: false,
  formatting: false,
  codeAction: false,
  signatureHelp: false,
  documentSymbol: false,
  workspaceSymbol: false,
};
