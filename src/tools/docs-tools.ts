import { Tool } from "./tool.js";
import { DocsStore } from "../docs/store.js";
import { DOC_CATALOG, findCatalogEntry } from "../docs/catalog.js";
import { detectWorkspaceDocSources } from "../docs/workspace-detect.js";
import { ingestDocSource } from "../docs/ingest.js";

const MAX_BODY_CHARS = 6000;

function resolveSlugs(ids: string[], store: DocsStore): string[] {
  const ingested = new Set(store.listSources().map((s) => s.slug));
  const slugs: string[] = [];
  for (const id of ids) {
    const slug = findCatalogEntry(id)?.slug ?? id;
    if (ingested.has(slug) && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

/** Lazy-auto-fetch: ingest whichever of `ids` aren't in the store yet, so a
 * doc lookup works on first use instead of requiring `npm run docs:ingest`
 * ahead of time. Best-effort — a bad id or network failure is swallowed
 * here and just leaves that source unavailable; the caller falls back to
 * whatever it does have. */
async function ensureIngested(ids: string[], store: DocsStore): Promise<void> {
  const missing = ids.filter((id) => resolveSlugs([id], store).length === 0);
  for (const id of missing) {
    try {
      await ingestDocSource(store, id);
    } catch {
      // unknown doc id or offline — leave it out of the resolved set
    }
  }
}

export class SearchDocsTool extends Tool {
  constructor(
    private readonly store: DocsStore,
    private readonly workspaceRoot: string,
  ) {
    super();
  }

  get name(): string {
    return "search_docs";
  }

  get description(): string {
    return (
      "Full-text search over library/framework documentation (DevDocs), fetched on first use if not already " +
      "cached locally. By default scopes to sources relevant to this workspace (auto-detected from package.json/" +
      "Gemfile/etc); pass `source` to search a specific doc set instead. Use `list_doc_sources` to see what's ingested."
    );
  }

  get tags(): string[] {
    return ["docs", "documentation", "reference", "search"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms" },
        source: {
          type: "string",
          description: 'Restrict to one doc id/slug (e.g. "react", "rails"). Omit to auto-scope to the workspace.',
        },
        limit: { type: "number", description: "Max results (default 8)" },
      },
      required: ["query"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const query = args.query as string;
    if (!query || !query.trim()) {
      return { error: "ArgumentError", message: "query is required" };
    }

    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 50) : 8;

    let slugs: string[] | undefined;
    let scope: "explicit" | "workspace" | "all" = "all";

    if (typeof args.source === "string" && args.source.trim()) {
      const source = args.source.trim();
      await ensureIngested([source], this.store);
      slugs = resolveSlugs([source], this.store);
      scope = "explicit";
      if (slugs.length === 0) {
        return {
          error: "UnknownSourceError",
          message: `"${source}" isn't a recognized DevDocs source and couldn't be fetched. Check list_doc_sources for available ids.`,
        };
      }
    } else {
      const workspaceIds = detectWorkspaceDocSources(this.workspaceRoot);
      if (workspaceIds.length > 0) await ensureIngested(workspaceIds, this.store);
      const workspaceSlugs = resolveSlugs(workspaceIds, this.store);
      if (workspaceSlugs.length > 0) {
        slugs = workspaceSlugs;
        scope = "workspace";
      }
    }

    const results = this.store.search(query, { slugs, limit });
    return { scope, sources: slugs ?? "all", results };
  }
}

export class GetDocTool extends Tool {
  constructor(private readonly store: DocsStore) {
    super();
  }

  get name(): string {
    return "get_doc";
  }

  get description(): string {
    return "Fetch the full content of one documentation section by source + path, as returned by search_docs.";
  }

  get tags(): string[] {
    return ["docs", "documentation", "reference"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        source: { type: "string", description: 'Doc id/slug (e.g. "react", "rails")' },
        path: { type: "string", description: "Section path, as returned by search_docs (may include a #anchor)" },
      },
      required: ["source", "path"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const source = args.source as string;
    const path = args.path as string;
    if (!source || !path) {
      return { error: "ArgumentError", message: "source and path are required" };
    }

    const slug = findCatalogEntry(source)?.slug ?? source;
    const section = this.store.getSection(slug, path);
    if (!section) {
      return { error: "NotFoundError", message: `no section "${path}" found in doc source "${source}"` };
    }

    const truncated = section.body.length > MAX_BODY_CHARS;
    return {
      source: slug,
      path: section.path,
      title: section.title,
      body: truncated ? section.body.slice(0, MAX_BODY_CHARS) : section.body,
      truncated,
    };
  }
}

export class ListDocSourcesTool extends Tool {
  constructor(
    private readonly store: DocsStore,
    private readonly workspaceRoot: string,
  ) {
    super();
  }

  get name(): string {
    return "list_doc_sources";
  }

  get description(): string {
    return "List documentation sources currently ingested and searchable, plus which ones this workspace uses by default.";
  }

  get tags(): string[] {
    return ["docs", "documentation", "reference"];
  }

  async call(): Promise<Record<string, unknown>> {
    const ingested = this.store.listSources();
    const workspaceIds = detectWorkspaceDocSources(this.workspaceRoot);
    const workspaceSlugs = resolveSlugs(workspaceIds, this.store);
    return {
      ingested,
      workspaceDefaultSources: workspaceSlugs,
      catalog: DOC_CATALOG,
    };
  }
}
