/**
 * One-time static project sniff (package.json / Gemfile) at TUI bootstrap.
 * Deliberately not a file watcher or a live-detection service — the
 * Context panel's Language/Framework/Test Framework rows only need to be
 * right at session start (see RailsIndexState for the precedent of
 * scanning-once-and-caching for a similar purpose).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectInfo } from "./types.js";

function detectFromPackageJson(workspaceRoot: string): ProjectInfo | null {
  const pkgPath = join(workspaceRoot, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
    const language = existsSync(join(workspaceRoot, "tsconfig.json")) ? "TypeScript" : "JavaScript";
    const framework = deps.next
      ? "Next.js"
      : deps.react
        ? "React"
        : deps.vue
          ? "Vue"
          : deps.express
            ? "Express"
            : deps.fastify
              ? "Fastify"
              : undefined;
    const testFramework = deps.jest ? "Jest" : deps.vitest ? "Vitest" : deps.mocha ? "Mocha" : deps.ava ? "Ava" : undefined;
    return { language, framework, testFramework };
  } catch {
    return {};
  }
}

function detectFromGemfile(workspaceRoot: string): ProjectInfo | null {
  const gemfilePath = join(workspaceRoot, "Gemfile");
  if (!existsSync(gemfilePath)) return null;
  try {
    const gemfile = readFileSync(gemfilePath, "utf-8");
    const framework = /gem\s+["']rails["']/.test(gemfile) ? "Rails" : undefined;
    const testFramework = /gem\s+["']rspec/.test(gemfile) ? "RSpec" : /gem\s+["']minitest/.test(gemfile) ? "Minitest" : undefined;
    return { language: "Ruby", framework, testFramework };
  } catch {
    return { language: "Ruby" };
  }
}

export function detectProjectInfo(workspaceRoot: string): ProjectInfo {
  return detectFromPackageJson(workspaceRoot) ?? detectFromGemfile(workspaceRoot) ?? {};
}
