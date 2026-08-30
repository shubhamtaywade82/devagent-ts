import { mkdir, copyFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Tool } from "./tool.js";
import { resolveWorkspacePath } from "./path-utils.js";
import { workspaceStateDir } from "../platform/paths.js";

// Backups live under the canonical workspace state dir — resolved via the
// platform layer, never a hardcoded brand path (docs/REBRANDING.md §2).

export class SnapshotBackupTool extends Tool {
  constructor(private readonly root: string) {
    super();
  }
  get name(): string {
    return "snapshot_backup";
  }
  get description(): string {
    return "Create a timestamped backup of a file before modifying it.";
  }
  get parameters(): Record<string, unknown> {
    return { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
  }
  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const path = args.path as string;
    if (!path) return { error: "ArgumentError", message: "missing path" };
    const target = resolveWorkspacePath(this.root, path);
    const backupRoot = join(workspaceStateDir(this.root), "backups");
    await mkdir(backupRoot, { recursive: true });
    const timestamp = Date.now();
    const backupPath = join(backupRoot, `${path.replace(/\//g, "_")}.${timestamp}.bak`);
    try {
      await copyFile(target, backupPath);
    } catch (e) {
      return { error: e instanceof Error ? e.name : "Error", message: e instanceof Error ? e.message : String(e) };
    }
    return { path, backupPath: relative(this.root, backupPath), timestamp };
  }
}
