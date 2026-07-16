import Database from "better-sqlite3";
import { DocSearchResult, DocSection, DocSourceMeta } from "./types.js";

export interface SearchOptions {
  slugs?: string[];
  limit?: number;
}

/** Wraps each whitespace-delimited token in an FTS5 phrase so user input can never break MATCH syntax. */
function buildMatchQuery(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

export class DocsStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        release TEXT,
        attribution TEXT,
        home_url TEXT,
        ingested_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS sections USING fts5(
        slug UNINDEXED,
        path UNINDEXED,
        title,
        body
      );
    `);
  }

  upsertSource(meta: Omit<DocSourceMeta, "sectionCount">): void {
    this.db
      .prepare(
        `INSERT INTO sources (slug, name, release, attribution, home_url, ingested_at)
         VALUES (@slug, @name, @release, @attribution, @homeUrl, @ingestedAt)
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name,
           release = excluded.release,
           attribution = excluded.attribution,
           home_url = excluded.home_url,
           ingested_at = excluded.ingested_at`,
      )
      .run({
        slug: meta.slug,
        name: meta.name,
        release: meta.release ?? null,
        attribution: meta.attribution ?? null,
        homeUrl: meta.homeUrl ?? null,
        ingestedAt: meta.ingestedAt,
      });
  }

  /** Atomically replaces all sections for a source — re-ingesting a slug never leaves stale rows behind. */
  replaceSections(slug: string, sections: DocSection[]): void {
    const del = this.db.prepare("DELETE FROM sections WHERE slug = ?");
    const insert = this.db.prepare("INSERT INTO sections (slug, path, title, body) VALUES (?, ?, ?, ?)");
    const tx = this.db.transaction((rows: DocSection[]) => {
      del.run(slug);
      for (const row of rows) insert.run(slug, row.path, row.title, row.body);
    });
    tx(sections);
  }

  listSources(): DocSourceMeta[] {
    const rows = this.db.prepare("SELECT * FROM sources ORDER BY slug").all() as Array<{
      slug: string;
      name: string;
      release: string | null;
      attribution: string | null;
      home_url: string | null;
      ingested_at: number;
    }>;
    const counts = this.db.prepare("SELECT slug, COUNT(*) as n FROM sections GROUP BY slug").all() as Array<{
      slug: string;
      n: number;
    }>;
    const countBySlug = new Map(counts.map((c) => [c.slug, c.n]));
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      release: r.release ?? undefined,
      attribution: r.attribution ?? undefined,
      homeUrl: r.home_url ?? undefined,
      ingestedAt: r.ingested_at,
      sectionCount: countBySlug.get(r.slug) ?? 0,
    }));
  }

  hasSource(slug: string): boolean {
    return this.db.prepare("SELECT 1 FROM sources WHERE slug = ?").get(slug) !== undefined;
  }

  search(query: string, opts: SearchOptions = {}): DocSearchResult[] {
    const limit = opts.limit ?? 8;
    const match = buildMatchQuery(query);
    const params: unknown[] = [match];
    let slugFilter = "";
    if (opts.slugs && opts.slugs.length > 0) {
      slugFilter = `AND slug IN (${opts.slugs.map(() => "?").join(",")})`;
      params.push(...opts.slugs);
    }
    params.push(limit);

    const rows = this.db
      .prepare(
        `SELECT slug, path, title, snippet(sections, 3, '**', '**', '…', 24) as snippet
         FROM sections
         WHERE sections MATCH ? ${slugFilter}
         ORDER BY bm25(sections)
         LIMIT ?`,
      )
      .all(...params) as Array<{ slug: string; path: string; title: string; snippet: string }>;

    return rows.map((r) => ({ source: r.slug, path: r.path, title: r.title, snippet: r.snippet }));
  }

  getSection(slug: string, path: string): DocSection | undefined {
    const row = this.db
      .prepare("SELECT slug, path, title, body FROM sections WHERE slug = ? AND path = ?")
      .get(slug, path) as { slug: string; path: string; title: string; body: string } | undefined;
    return row ? { path: row.path, title: row.title, body: row.body } : undefined;
  }

  close(): void {
    this.db.close();
  }
}
