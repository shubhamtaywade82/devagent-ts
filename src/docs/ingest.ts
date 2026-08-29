import * as cheerio from "cheerio";
import { findCatalogEntry } from "./catalog.js";
import { DocsStore } from "./store.js";
import { DocManifestEntry, DocSection } from "./types.js";

const DEFAULT_MANIFEST_URL = "https://devdocs.io/docs.json";
const DEFAULT_DOCS_BASE = "https://documents.devdocs.io";

export interface IngestOptions {
  fetchImpl?: typeof fetch;
  manifestUrl?: string;
  docsBase?: string;
}

export class DocsIngestError extends Error {}

export async function fetchDocManifest(opts: IngestOptions = {}): Promise<DocManifestEntry[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.manifestUrl ?? DEFAULT_MANIFEST_URL;
  const res = await fetchImpl(url);
  if (!res.ok) throw new DocsIngestError(`failed to fetch DevDocs manifest: HTTP ${res.status}`);
  return (await res.json()) as DocManifestEntry[];
}

/**
 * Resolves a logical/bare slug (e.g. "rails") to the concrete DevDocs slug.
 * Some docs only ship version-suffixed slugs upstream (e.g. "rails~8.1", no
 * bare "rails" alias) — in that case the highest numeric version is picked.
 */
export function resolveManifestEntry(manifest: DocManifestEntry[], slugOrId: string): DocManifestEntry | undefined {
  const catalogEntry = findCatalogEntry(slugOrId);
  const targetSlug = catalogEntry?.slug ?? slugOrId;

  const exact = manifest.find((e) => e.slug === targetSlug);
  if (exact) return exact;

  const versioned = manifest.filter((e) => e.slug.startsWith(`${targetSlug}~`));
  if (versioned.length === 0) return undefined;

  return versioned.reduce((best, entry) => {
    const bestVersion = parseFloat(best.version) || 0;
    const entryVersion = parseFloat(entry.version) || 0;
    return entryVersion > bestVersion ? entry : best;
  });
}

/** Splits a DevDocs page's HTML into its top-level `<section>` blocks, one row per anchor. */
export function splitIntoSections(basePath: string, html: string, titleByAnchor: Map<string, string>): DocSection[] {
  const $ = cheerio.load(html);
  const topLevel = $("section").filter((_, el) => $(el).parents("section").length === 0);

  if (topLevel.length === 0) {
    const text = $.root()
      .text()
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text ? [{ path: basePath, title: titleByAnchor.get(basePath) ?? basePath, body: text }] : [];
  }

  const sections: DocSection[] = [];
  topLevel.each((i, el) => {
    const $el = $(el);
    const heading = $el.find("h1, h2, h3, h4, h5, h6").first();
    const anchor = heading.attr("id");
    const path = anchor ? (anchor === basePath ? basePath : `${basePath}#${anchor}`) : `${basePath}#section-${i}`;
    const title = heading.text().trim() || titleByAnchor.get(path) || titleByAnchor.get(basePath) || basePath;
    const body = $el
      .text()
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (body) sections.push({ path, title, body });
  });
  return sections;
}

export interface IngestResult {
  slug: string;
  name: string;
  sectionCount: number;
}

export async function ingestDocSource(
  store: DocsStore,
  slugOrId: string,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const manifest = await fetchDocManifest(opts);
  const entry = resolveManifestEntry(manifest, slugOrId);
  if (!entry) throw new DocsIngestError(`no DevDocs source found for "${slugOrId}"`);

  const base = opts.docsBase ?? DEFAULT_DOCS_BASE;
  const [indexRes, dbRes] = await Promise.all([
    fetchImpl(`${base}/${entry.slug}/index.json`),
    fetchImpl(`${base}/${entry.slug}/db.json`),
  ]);
  if (!indexRes.ok) throw new DocsIngestError(`failed to fetch index for "${entry.slug}": HTTP ${indexRes.status}`);
  if (!dbRes.ok) throw new DocsIngestError(`failed to fetch content for "${entry.slug}": HTTP ${dbRes.status}`);

  const index = (await indexRes.json()) as { entries: { name: string; path: string; type: string }[] };
  const db = (await dbRes.json()) as Record<string, string>;

  const titleByAnchor = new Map<string, string>();
  for (const e of index.entries) {
    if (!titleByAnchor.has(e.path)) titleByAnchor.set(e.path, e.name);
  }

  const sections: DocSection[] = [];
  for (const [basePath, html] of Object.entries(db)) {
    sections.push(...splitIntoSections(basePath, html, titleByAnchor));
  }

  store.upsertSource({
    slug: entry.slug,
    name: entry.name,
    release: entry.release,
    attribution: entry.attribution,
    homeUrl: entry.links?.home,
    ingestedAt: Date.now(),
  });
  store.replaceSections(entry.slug, sections);

  return { slug: entry.slug, name: entry.name, sectionCount: sections.length };
}
