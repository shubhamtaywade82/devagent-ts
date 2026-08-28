import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverWorkspace } from "../intelligence/rails/index.js";
import { WORKSPACE_DOC_SOURCES } from "./catalog.js";

function readJsonIfExists(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function hasAnyDependency(pkg: Record<string, unknown>, names: string[]): boolean {
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  return names.some((n) => n in deps);
}

/**
 * Cheap, synchronous filesystem probes that classify a workspace by the
 * frameworks/languages it actually uses, so `search_docs` can auto-scope to
 * relevant DevDocs sources instead of searching everything ingested.
 * Order matters: more specific kinds (react/vue/nextjs) are pushed before
 * their general runtime (node) so search results favor the framework docs.
 */
export function detectWorkspaceKinds(root: string): string[] {
  const kinds: string[] = [];

  const workspace = discoverWorkspace(root);
  if (workspace.isRails) kinds.push("rails");
  else if (workspace.isRuby) kinds.push("ruby");

  const pkg = readJsonIfExists(join(root, "package.json"));
  if (pkg) {
    if (hasAnyDependency(pkg, ["next"])) kinds.push("nextjs");
    if (hasAnyDependency(pkg, ["react", "react-dom"])) kinds.push("react");
    if (hasAnyDependency(pkg, ["vue"])) kinds.push("vue");
    if (hasAnyDependency(pkg, ["@angular/core"])) kinds.push("angular");
    if (hasAnyDependency(pkg, ["express"])) kinds.push("express");

    const hasTsConfig = existsSync(join(root, "tsconfig.json"));
    const hasTsDependency = hasAnyDependency(pkg, ["typescript"]);
    if (hasTsConfig || hasTsDependency) kinds.push("typescript");
    kinds.push("node");
  }

  if (
    existsSync(join(root, "requirements.txt")) ||
    existsSync(join(root, "pyproject.toml")) ||
    existsSync(join(root, "setup.py")) ||
    existsSync(join(root, "Pipfile"))
  ) {
    if (existsSync(join(root, "manage.py"))) kinds.push("django");
    kinds.push("python");
  }

  if (existsSync(join(root, "go.mod"))) kinds.push("go");
  if (existsSync(join(root, "Cargo.toml"))) kinds.push("rust");

  return [...new Set(kinds)];
}

/** Resolve the detected workspace kinds down to an ordered, deduped list of logical doc ids. */
export function detectWorkspaceDocSources(root: string): string[] {
  const kinds = detectWorkspaceKinds(root);
  const ids: string[] = [];
  for (const kind of kinds) {
    for (const id of WORKSPACE_DOC_SOURCES[kind] ?? []) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}
