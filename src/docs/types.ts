export interface DocSourceMeta {
  slug: string;
  name: string;
  release?: string;
  attribution?: string;
  homeUrl?: string;
  ingestedAt: number;
  sectionCount: number;
}

export interface DocSection {
  path: string;
  title: string;
  body: string;
}

export interface DocSearchResult {
  source: string;
  path: string;
  title: string;
  snippet: string;
}

export interface DocManifestEntry {
  name: string;
  slug: string;
  type: string;
  version: string;
  release: string;
  mtime: number;
  attribution?: string;
  links?: { home?: string; code?: string };
}

/** Logical, stack-facing doc identifier (e.g. "react", "rails") mapped to a DevDocs slug. */
export interface DocCatalogEntry {
  id: string;
  label: string;
  slug: string;
}
