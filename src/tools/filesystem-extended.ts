import { readdir, stat, unlink, rename, copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { Tool, ToolError } from "./tool";
import { PathEscapeError } from "./filesystem";

function resolveWorkspacePath(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root);
  const full = resolve(join(absoluteRoot, relativePath));

  if (full !== absoluteRoot && !full.startsWith(`${absoluteRoot}/`)) {
    throw new PathEscapeError(`${relativePath} escapes workspace root`);
  }
  return full;
}

function isUnderRoot(root: string, fullPath: string): boolean {
  const absoluteRoot = resolve(root);
  if (fullPath === absoluteRoot) return true;
  return fullPath.startsWith(`${absoluteRoot}/`);
}

export class ListDirectoryTool extends Tool {
  constructor(private readonly root: string) { super(); }

  get name(): string { return "list_directory"; }

  get description(): string { return "List the contents of a directory relative to the workspace root."; }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
      },
      required: ["path"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const relPath = args.path as string;
    const recursive = (args.recursive as boolean) ?? false;
    const target = resolveWorkspacePath(this.root, relPath);

    const entries: Array<{ name: string; path: string; type: "file" | "directory"; size?: number }> = [];

    async function walk(current: string, relative: string): Promise<void> {
      const items = await readdir(current, { withFileTypes: true });
      for (const item of items) {
        const itemRel = join(relative, item.name);
        const itemAbs = join(current, item.name);

        if (item.isDirectory()) {
          entries.push({ name: item.name, path: itemRel, type: "directory" });
          if (recursive) {
            await walk(itemAbs, itemRel);
          }
        } else {
          const s = await stat(itemAbs);
          entries.push({ name: item.name, path: itemRel, type: "file", size: s.size });
        }
      }
    }

    await walk(target, relPath || basename(target) || relPath);

    return { path: relPath, entries, truncated: false };
  }
}

export class DeleteFileTool extends Tool {
  constructor(private readonly root: string) { super(); }

  get name(): string { return "delete_file"; }

  get description(): string { return "Delete a file or empty directory within the workspace. Fails for non-empty directories."; }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const relPath = args.path as string;
    const target = resolveWorkspacePath(this.root, relPath);

    try {
      const s = await stat(target);
      if (s.isDirectory()) {
        const items = await readdir(target);
        if (items.length > 0) {
          return { path: relPath, error: "DirectoryNotEmptyError", message: "Refusing to delete non-empty directory." };
        }
      }
    } catch (e) {
      const err = e as Error;
      return { path: relPath, error: err.constructor.name, message: err.message };
    }

    await unlink(target);
    return { path: relPath, deleted: true };
  }
}

export class MoveFileTool extends Tool {
  constructor(private readonly root: string) { super(); }

  get name(): string { return "move_file"; }

  get description(): string { return "Move or rename a file/directory within the workspace."; }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["from", "to"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fromRel = args.from as string;
    const toRel = args.to as string;
    const source = resolveWorkspacePath(this.root, fromRel);
    const destination = resolveWorkspacePath(this.root, toRel);

    if (!isUnderRoot(this.root, destination)) {
      throw new PathEscapeError(`${toRel} escapes workspace root`);
    }

    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    return { from: fromRel, to: toRel };
  }
}

export class CopyFileTool extends Tool {
  constructor(private readonly root: string) { super(); }

  get name(): string { return "copy_file"; }

  get description(): string { return "Copy a file within the workspace. Does not copy directories."; }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["from", "to"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fromRel = args.from as string;
    const toRel = args.to as string;
    const source = resolveWorkspacePath(this.root, fromRel);
    const destination = resolveWorkspacePath(this.root, toRel);

    if (!isUnderRoot(this.root, destination)) {
      throw new PathEscapeError(`${toRel} escapes workspace root`);
    }

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return { from: fromRel, to: toRel };
  }
}

export class MakeDirectoryTool extends Tool {
  constructor(private readonly root: string) { super(); }

  get name(): string { return "mkdir"; }

  get description(): string { return "Create a directory inside the workspace, including parents."; }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const relPath = args.path as string;
    const target = resolveWorkspacePath(this.root, relPath);
    await mkdir(target, { recursive: true });
    return { path: relPath, created: true };
  }
}

export class SearchFilesTool extends Tool {
  constructor(private readonly root: string) { super(); }

  get name(): string { return "search_files"; }

  get description(): string { return "Find files by glob pattern, optionally filtered by extension."; }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
      required: ["pattern"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const pattern = args.pattern as string;
    const localRoot = args.path ? resolveWorkspacePath(this.root, args.path as string) : this.root;
    const matches: string[] = [];

    async function walk(current: string, relative: string): Promise<void> {
      let items: string[];
      try {
        items = await readdir(current);
      } catch {
        return;
      }

      for (const item of items) {
        const itemAbs = join(current, item);
        const itemRel = join(relative, item);

        // small glob-ish filter using basename match
        if (item.includes(pattern.replace(/\*/g, "").replace(/[?]/g, "_"))) {
          matches.push(itemRel);
        } else if (pattern === "**" || pattern.endsWith("/**")) {
          matches.push(itemRel);
        }
      }
    }

    // This is a lightweight matcher to avoid adding dependencies.
    await walk(localRoot, basename(localRoot) || ".");
    return { pattern, matches: matches.slice(0, 200), truncated: matches.length > 200 };
  }
}

export class GrepFilesTool extends Tool {
  constructor(private readonly root: string) { super(); }

  get name(): string { return "grep_files"; }

  get description(): string { return "Search for lines containing a literal string across files in the workspace."; }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
      },
      required: ["query"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const query = args.query as string;
    const localRoot = args.path ? resolveWorkspacePath(this.root, args.path as string) : this.root;
    const matches: Array<{ file: string; line: number; text: string }> = [];

    async function walk(current: string, relative: string): Promise<void> {
      let items: string[];
      try {
        items = await readdir(current);
      } catch {
        return;
      }

      for (const item of items) {
        const itemAbs = join(current, item);
        const itemRel = join(relative, item);

        try {
          const s = await stat(itemAbs);
          if (s.isDirectory()) {
            if (item.startsWith(".$")) continue;
            await walk(itemAbs, itemRel);
            continue;
          }
        } catch {
          continue;
        }

        // Skip binary-looking files by extension
        const lower = itemRel.toLowerCase();
        if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".zip") || lower.endsWith(".tar") || lower.endsWith(".gz") || lower.endsWith(".pdf") || lower.endsWith(".bin") || lower.endsWith(".exe") || lower.endsWith(".so") || lower.endsWith(".dylib")) {
          continue;
        }

        let content: string;
        try {
          content = await readFile(itemAbs, "utf-8");
        } catch {
          continue;
        }

        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            matches.push({ file: itemRel, line: i + 1, text: lines[i] });
            if (matches.length >= 200) break;
          }
        }
        if (matches.length >= 200) break;
      }
      if (matches.length >= 200) return;
    }

    await walk(localRoot, basename(localRoot) || ".");
    return { query, matches, truncated: matches.length >= 200 };
  }
}

export class FileMetadataTool extends Tool {
  constructor(private readonly root: string) { super(); }

  get name(): string { return "file_metadata"; }

  get description(): string { return "Return metadata for a workspace path: size, isFile, isDirectory, extension."; }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const relPath = args.path as string;
    const target = resolveWorkspacePath(this.root, relPath);
    const s = await stat(target);
    return {
      path: relPath,
      size: s.size,
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      extension: basename(target).includes(".") ? basename(target).split(".").pop() : "",
      absolute: target,
    };
  }
}
