import { resolve, join, relative } from "node:path";
import { ToolError } from "./tool";

export function resolveWorkspacePath(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root);
  const full = resolve(join(absoluteRoot, relativePath));
  const rel = relative(absoluteRoot, full);
  if (rel.startsWith("..")) {
    throw new ToolError(`${relativePath} escapes workspace root`);
  }
  return full;
}
