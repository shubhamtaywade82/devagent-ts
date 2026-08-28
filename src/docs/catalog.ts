import { DocCatalogEntry } from "./types.js";

/**
 * Logical doc ids the agent/tools reason about, mapped to their DevDocs slug.
 * Some slugs are version-suffixed upstream (e.g. "rails~8.1") with no bare
 * alias — `resolveSlug` in ingest.ts handles picking the latest version.
 */
export const DOC_CATALOG: DocCatalogEntry[] = [
  { id: "javascript", label: "JavaScript", slug: "javascript" },
  { id: "node", label: "Node.js", slug: "node" },
  { id: "typescript", label: "TypeScript", slug: "typescript" },
  { id: "react", label: "React", slug: "react" },
  { id: "html", label: "HTML", slug: "html" },
  { id: "css", label: "CSS", slug: "css" },
  { id: "express", label: "Express", slug: "express" },
  { id: "vue", label: "Vue.js", slug: "vue" },
  { id: "angular", label: "Angular", slug: "angular" },
  { id: "nextjs", label: "Next.js", slug: "nextjs" },
  { id: "rails", label: "Ruby on Rails", slug: "rails" },
  { id: "ruby", label: "Ruby", slug: "ruby" },
  { id: "python", label: "Python", slug: "python" },
  { id: "django", label: "Django", slug: "django" },
  { id: "go", label: "Go", slug: "go" },
  { id: "rust", label: "Rust", slug: "rust" },
];

export function findCatalogEntry(id: string): DocCatalogEntry | undefined {
  const key = id.toLowerCase();
  return DOC_CATALOG.find((e) => e.id === key || e.slug === key);
}

/** Workspace kind -> ordered list of logical doc ids relevant to it. */
export const WORKSPACE_DOC_SOURCES: Record<string, string[]> = {
  rails: ["rails", "ruby"],
  ruby: ["ruby"],
  react: ["react", "javascript", "html", "css"],
  vue: ["vue", "javascript", "html", "css"],
  angular: ["angular", "typescript", "html", "css"],
  nextjs: ["nextjs", "react", "javascript"],
  express: ["express", "node", "javascript"],
  typescript: ["typescript", "javascript", "node"],
  node: ["node", "javascript"],
  python: ["python"],
  django: ["django", "python"],
  go: ["go"],
  rust: ["rust"],
};
