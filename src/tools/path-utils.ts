import { resolve, join, relative } from "node:path";
import { ToolError } from "./tool";

export class PathEscapeError extends ToolError {}

export function resolveWorkspacePath(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root);
  const full = resolve(join(absoluteRoot, relativePath));
  const rel = relative(absoluteRoot, full);
  if (rel.startsWith("..")) {
    throw new PathEscapeError(`${relativePath} escapes workspace root`);
  }
  return full;
}
