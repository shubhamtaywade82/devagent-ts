import { readFileSync } from "node:fs";
import { LanguageRegistry, LanguageProviderConfig } from "./registry";
import { LspPool } from "./pool";
import { LspServerSession } from "./session";
import { LspServerState, pathToUri } from "./protocol";
import { LspGlobalConfig, mergeLspConfig } from "./config";
import type {
  Location,
  Diagnostic,
  SymbolInformation,
  Hover,
  CompletionItem,
  SignatureHelp,
  TextEdit,
  WorkspaceEdit,
  CodeAction,
} from "vscode-languageserver-protocol";

export type SemanticOperation =
  | "definition"
  | "references"
  | "documentSymbols"
  | "workspaceSymbols"
  | "hover"
  | "diagnostics"
  | "codeActions"
  | "rename"
  | "completion"
  | "signatureHelp"
  | "formatting"
  | "semanticTokens";

export interface LspManagerEvents {
  onDiagnostics?: (filePath: string, diagnostics: Diagnostic[]) => void;
  onServerStateChange?: (servers: LspServerState[]) => void;
  onError?: (error: Error) => void;
}

export class LspManager {
  readonly workspaceRoot: string;
  readonly registry: LanguageRegistry;
  private pool: LspPool;
  private events: LspManagerEvents;

  constructor(opts: {
    workspaceRoot: string;
    registry?: LanguageRegistry;
    lspConfig?: Partial<LspGlobalConfig>;
    events?: LspManagerEvents;
  }) {
    this.workspaceRoot = opts.workspaceRoot;
    this.registry = opts.registry ?? new LanguageRegistry();
    const config = mergeLspConfig(opts.lspConfig);
    this.pool = new LspPool(config);
    this.pool.onStateChange = () => {
      this.events.onServerStateChange?.(this.getServerStates());
    };
    this.events = opts.events ?? {};
    this.pool.startIdleCheck();
  }

  supports(filePath: string, operation: SemanticOperation): boolean {
    const provider = this.registry.getProviderForFile(filePath);
    if (!provider) return false;

    const session = this.pool.getSession(this.workspaceRoot, provider.id);
    if (!session || session.status !== "running") return false;

    const caps = session.capabilities;
    switch (operation) {
      case "definition":
        return caps.definition;
      case "references":
        return caps.references;
      case "documentSymbols":
        return caps.documentSymbol;
      case "workspaceSymbols":
        return caps.workspaceSymbol;
      case "hover":
        return caps.hover;
      case "diagnostics":
        return true; // we cache diagnostics from didChange notifications
      case "codeActions":
        return caps.codeAction;
      case "rename":
        return caps.rename;
      case "completion":
        return caps.completion;
      case "signatureHelp":
        return caps.signatureHelp;
      case "formatting":
        return caps.formatting;
      case "semanticTokens":
        return caps.semanticTokens;
      default:
        return false;
    }
  }

  getProviderForFile(filePath: string): LanguageProviderConfig | undefined {
    return this.registry.getProviderForFile(filePath);
  }

  private async ensureSession(filePath: string): Promise<LspServerSession | null> {
    const provider = this.registry.getProviderForFile(filePath);
    if (!provider) return null;

    try {
      const session = await this.pool.acquire(this.workspaceRoot, provider);
      return session;
    } catch {
      return null;
    }
  }

  private async getSession(
    filePath: string,
  ): Promise<LspServerSession | null> {
    const provider = this.registry.getProviderForFile(filePath);
    if (!provider) return null;

    const session = this.pool.getSession(this.workspaceRoot, provider.id);
    if (session && session.status === "running") {
      session.lastActivity = Date.now();
      return session;
    }

    return this.ensureSession(filePath);
  }

  async ensureOpen(filePath: string, content?: string): Promise<boolean> {
    const provider = this.registry.getProviderForFile(filePath);
    if (!provider) return false;

    const session = await this.ensureSession(filePath);
    if (!session) return false;

    const uri = pathToUri(this.workspaceRoot, filePath);
    if (!session.openDocuments.has(uri)) {
      const text = content ?? this.readFile(filePath);
      await session.openDocument(filePath, text);

      session.onDiagnostics = (diagUri, diagnostics) => {
        const diagFilePath = filePath; // capture
        this.events.onDiagnostics?.(diagFilePath, diagnostics);
      };
    }
    return true;
  }

  async notifyChange(filePath: string, content: string): Promise<void> {
    const session = await this.getSession(filePath);
    if (!session) return;

    const uri = pathToUri(this.workspaceRoot, filePath);
    if (session.openDocuments.has(uri)) {
      await session.changeDocument(filePath, content);
    }
  }

  async notifyClose(filePath: string): Promise<void> {
    const provider = this.registry.getProviderForFile(filePath);
    if (!provider) return;
    const session = this.pool.getSession(this.workspaceRoot, provider.id);
    if (session) {
      await session.closeDocument(filePath);
    }
  }

  private getFileProviderAndSession(filePath: string) {
    const provider = this.registry.getProviderForFile(filePath);
    if (!provider) return null;
    return this.pool.getSession(this.workspaceRoot, provider.id) ?? null;
  }

  // --- Semantic Operations ---

  async getDefinition(
    filePath: string,
    line: number,
    character: number,
  ): Promise<Location[]> {
    const session = await this.getSession(filePath);
    if (!session?.client) return [];

    const uri = pathToUri(this.workspaceRoot, filePath);
    const result = await session.client.sendRequest("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });

    return this.toLocationArray(result);
  }

  async getReferences(
    filePath: string,
    line: number,
    character: number,
    includeDeclaration = false,
  ): Promise<Location[]> {
    const session = await this.getSession(filePath);
    if (!session?.client) return [];

    const uri = pathToUri(this.workspaceRoot, filePath);
    const result = await session.client.sendRequest("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration },
    });

    return this.toLocationArray(result);
  }

  async renameSymbol(
    filePath: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<WorkspaceEdit | null> {
    const session = await this.getSession(filePath);
    if (!session?.client) return null;

    const uri = pathToUri(this.workspaceRoot, filePath);
    const result = (await session.client.sendRequest("textDocument/rename", {
      textDocument: { uri },
      position: { line, character },
      newName,
    })) as WorkspaceEdit | null;

    return result;
  }

  async getWorkspaceSymbols(query: string): Promise<SymbolInformation[]> {
    for (const session of this.pool.runningSessions()) {
      if (session.client && session.capabilities.workspaceSymbol) {
        try {
          const result = (await session.client.sendRequest("workspace/symbol", {
            query,
          })) as SymbolInformation[];
          return result ?? [];
        } catch {
          continue;
        }
      }
    }
    return [];
  }

  async getDocumentSymbols(filePath: string): Promise<SymbolInformation[]> {
    const session = await this.getSession(filePath);
    if (!session?.client || !session.capabilities.documentSymbol) return [];

    const uri = pathToUri(this.workspaceRoot, filePath);
    const result = (await session.client.sendRequest(
      "textDocument/documentSymbol",
      { textDocument: { uri } },
    )) as SymbolInformation[] | { name: string; kind: number; range: unknown; children?: unknown[] }[];

    if (!result) return [];

    if (Array.isArray(result) && result.length > 0 && "name" in result[0] && "children" in result[0]) {
      return this.flattenDocumentSymbols(result as any[]);
    }

    return result as SymbolInformation[];
  }

  async getHover(
    filePath: string,
    line: number,
    character: number,
  ): Promise<Hover | null> {
    const session = await this.getSession(filePath);
    if (!session?.client) return null;

    const uri = pathToUri(this.workspaceRoot, filePath);
    const result = (await session.client.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    })) as Hover | null;

    return result;
  }

  async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
    const session = await this.getSession(filePath);
    if (!session) return [];

    const uri = pathToUri(this.workspaceRoot, filePath);
    return session.cachedDiagnostics.get(uri) ?? [];
  }

  getAllDiagnostics(): Map<string, Diagnostic[]> {
    const all = new Map<string, Diagnostic[]>();
    for (const session of this.pool.runningSessions()) {
      for (const [uri, diags] of session.cachedDiagnostics) {
        all.set(uri, diags);
      }
    }
    return all;
  }

  async getCodeActions(
    filePath: string,
    line: number,
    character: number,
  ): Promise<CodeAction[]> {
    const session = await this.getSession(filePath);
    if (!session?.client) return [];

    const uri = pathToUri(this.workspaceRoot, filePath);
    const result = (await session.client.sendRequest("textDocument/codeAction", {
      textDocument: { uri },
      range: {
        start: { line, character },
        end: { line, character },
      },
      context: { diagnostics: [] },
    })) as (CodeAction | { command: string; title: string })[] | null;

    return (result ?? []) as CodeAction[];
  }

  async getCompletion(
    filePath: string,
    line: number,
    character: number,
  ): Promise<CompletionItem[]> {
    const session = await this.getSession(filePath);
    if (!session?.client) return [];

    const uri = pathToUri(this.workspaceRoot, filePath);
    const result = (await session.client.sendRequest("textDocument/completion", {
      textDocument: { uri },
      position: { line, character },
      context: { triggerKind: 1 },
    })) as CompletionItem[] | { items: CompletionItem[] } | null;

    if (!result) return [];
    if (Array.isArray(result)) return result;
    return (result as { items: CompletionItem[] }).items ?? [];
  }

  async getSignatureHelp(
    filePath: string,
    line: number,
    character: number,
  ): Promise<SignatureHelp | null> {
    const session = await this.getSession(filePath);
    if (!session?.client) return null;

    const uri = pathToUri(this.workspaceRoot, filePath);
    const result = (await session.client.sendRequest(
      "textDocument/signatureHelp",
      { textDocument: { uri }, position: { line, character } },
    )) as SignatureHelp | null;

    return result;
  }

  async formatDocument(filePath: string): Promise<TextEdit[]> {
    const session = await this.getSession(filePath);
    if (!session?.client) return [];

    const uri = pathToUri(this.workspaceRoot, filePath);
    const result = (await session.client.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    })) as TextEdit[] | null;

    return result ?? [];
  }

  async getSemanticTokens(filePath: string): Promise<number[] | null> {
    const session = await this.getSession(filePath);
    if (!session?.client) return null;

    const uri = pathToUri(this.workspaceRoot, filePath);
    try {
      const result = (await session.client.sendRequest(
        "textDocument/semanticTokens/full",
        { textDocument: { uri } },
      )) as { data: number[] } | null;

      return result?.data ?? null;
    } catch {
      return null;
    }
  }

  async prewarm(extensions: string[]): Promise<void> {
    const extensionsToWarm = extensions
      .map((ext) => {
        const provider = this.registry.getProviderForExtension(ext);
        return provider;
      })
      .filter(Boolean) as LanguageProviderConfig[];

    const warmed = new Set<string>();
    for (const provider of extensionsToWarm) {
      if (warmed.has(provider.id)) continue;
      warmed.add(provider.id);
      try {
        await this.pool.acquire(this.workspaceRoot, provider);
      } catch {
        // prewarm failures are non-fatal
      }
    }
  }

  async shutdown(): Promise<void> {
    this.pool.stopIdleCheck();
    await this.pool.stopAll();
  }

  getServerStates(): LspServerState[] {
    return this.pool.allSessions().map((s) => ({
      language: s.provider.language,
      status: s.status,
      documentsCount: s.openDocuments.size,
      errorCount: s.errorCount,
    }));
  }

  private readFile(filePath: string): string {
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }

  private toLocationArray(result: unknown): Location[] {
    if (!result) return [];

    if (Array.isArray(result)) {
      return result as Location[];
    }

    const single = result as Location;
    if (single.uri && single.range) {
      return [single];
    }

    const asLinks = result as Array<Record<string, unknown>>;
    if (Array.isArray(asLinks) && asLinks.length > 0 && "targetUri" in asLinks[0]) {
      return asLinks.map((r) => ({
        uri: (r.targetUri ?? r.uri) as string,
        range: (r.targetRange ?? r.targetSelectionRange ?? r.range) as any,
      }));
    }

    return [];
  }

  private flattenDocumentSymbols(
    symbols: { name: string; kind: number; range: unknown; children?: unknown[] }[],
  ): SymbolInformation[] {
    const result: SymbolInformation[] = [];
    const walk = (
      symbols: { name: string; kind: number; range: unknown; children?: unknown[] }[],
      containerName?: string,
    ) => {
      for (const sym of symbols) {
        result.push({
          name: sym.name,
          kind: sym.kind,
          location: { uri: "", range: sym.range as any },
          containerName: containerName ?? "",
        } as SymbolInformation);
        if (sym.children) {
          walk(sym.children as any[], sym.name);
        }
      }
    };
    walk(symbols);
    return result;
  }
}
