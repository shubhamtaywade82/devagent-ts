import { DocCatalogEntry } from "./types.js";

/**
 * Logical doc ids the agent/tools reason about, mapped to their DevDocs slug.
 * Some slugs are version-suffixed upstream (e.g. "rails~8.1") with no bare
 * alias — `resolveSlug` in ingest.ts handles picking the latest version.
 */
export const DOC_CATALOG: DocCatalogEntry[] = [
  // Languages & Core Runtimes
  { id: "javascript", label: "JavaScript", slug: "javascript" },
  { id: "node", label: "Node.js", slug: "node" },
  { id: "typescript", label: "TypeScript", slug: "typescript" },
  { id: "python", label: "Python", slug: "python" },
  { id: "ruby", label: "Ruby", slug: "ruby" },
  { id: "go", label: "Go", slug: "go" },
  { id: "rust", label: "Rust", slug: "rust" },
  { id: "c", label: "C", slug: "c" },
  { id: "cpp", label: "C++", slug: "cpp" },
  { id: "csharp", label: "C# / .NET", slug: "csharp" },
  { id: "java", label: "Java", slug: "openjdk" },
  { id: "kotlin", label: "Kotlin", slug: "kotlin" },
  { id: "scala", label: "Scala", slug: "scala" },
  { id: "clojure", label: "Clojure", slug: "clojure" },
  { id: "swift", label: "Swift", slug: "swift" },
  { id: "php", label: "PHP", slug: "php" },
  { id: "dart", label: "Dart", slug: "dart" },
  { id: "elixir", label: "Elixir", slug: "elixir" },
  { id: "erlang", label: "Erlang", slug: "erlang" },
  { id: "haskell", label: "Haskell", slug: "haskell" },
  { id: "lua", label: "Lua", slug: "lua" },
  { id: "r", label: "R", slug: "r" },
  { id: "julia", label: "Julia", slug: "julia" },
  { id: "zig", label: "Zig", slug: "zig" },
  { id: "bash", label: "Bash", slug: "bash" },
  { id: "deno", label: "Deno", slug: "deno" },

  // Web & Frontend Frameworks
  { id: "react", label: "React", slug: "react" },
  { id: "vue", label: "Vue.js", slug: "vue" },
  { id: "angular", label: "Angular", slug: "angular" },
  { id: "nextjs", label: "Next.js", slug: "nextjs" },
  { id: "svelte", label: "Svelte", slug: "svelte" },
  { id: "html", label: "HTML", slug: "html" },
  { id: "css", label: "CSS", slug: "css" },
  { id: "bootstrap", label: "Bootstrap", slug: "bootstrap" },
  { id: "tailwindcss", label: "Tailwind CSS", slug: "tailwindcss" },

  // Backend Frameworks
  { id: "express", label: "Express", slug: "express" },
  { id: "rails", label: "Ruby on Rails", slug: "rails" },
  { id: "django", label: "Django", slug: "django" },
  { id: "fastapi", label: "FastAPI", slug: "fastapi" },
  { id: "flask", label: "Flask", slug: "flask" },
  { id: "laravel", label: "Laravel", slug: "laravel" },
  { id: "symfony", label: "Symfony", slug: "symfony" },
  { id: "spring_boot", label: "Spring Boot", slug: "spring_boot" },

  // Data & Machine Learning
  { id: "pandas", label: "Pandas", slug: "pandas" },
  { id: "numpy", label: "NumPy", slug: "numpy" },
  { id: "pytorch", label: "PyTorch", slug: "pytorch" },
  { id: "tensorflow", label: "TensorFlow", slug: "tensorflow" },
  { id: "scikit_learn", label: "Scikit-learn", slug: "scikit_learn" },

  // Databases & DevOps
  { id: "postgresql", label: "PostgreSQL", slug: "postgresql" },
  { id: "mysql", label: "MySQL", slug: "mysql" },
  { id: "sqlite", label: "SQLite", slug: "sqlite" },
  { id: "redis", label: "Redis", slug: "redis" },
  { id: "docker", label: "Docker", slug: "docker" },
  { id: "kubernetes", label: "Kubernetes", slug: "kubernetes" },
  { id: "git", label: "Git", slug: "git" },
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
  svelte: ["svelte", "javascript", "html", "css"],
  express: ["express", "node", "javascript"],
  typescript: ["typescript", "javascript", "node"],
  node: ["node", "javascript"],
  deno: ["deno", "typescript", "javascript"],
  python: ["python"],
  django: ["django", "python"],
  fastapi: ["fastapi", "python"],
  flask: ["flask", "python"],
  go: ["go"],
  rust: ["rust"],
  c: ["c"],
  cpp: ["cpp", "c"],
  csharp: ["csharp"],
  java: ["java"],
  kotlin: ["kotlin", "java"],
  scala: ["scala", "java"],
  clojure: ["clojure", "java"],
  php: ["php"],
  laravel: ["laravel", "php"],
  symfony: ["symfony", "php"],
  swift: ["swift"],
  dart: ["dart"],
  elixir: ["elixir", "erlang"],
  erlang: ["erlang"],
  haskell: ["haskell"],
  lua: ["lua"],
  r: ["r"],
  julia: ["julia"],
  zig: ["zig"],
  bash: ["bash"],
  docker: ["docker"],
  kubernetes: ["kubernetes"],
};
