import { readFile, writeFile, rename, unlink, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Tool } from "./tool.js";
import { resolveWorkspacePath, PathEscapeError } from "./path-utils.js";

export { PathEscapeError };

export class ReadFileTool extends Tool {
  // The result is fed straight back into the model as a tool message, so this
  // is a context-window ceiling, not a storage limit — matched to
  // ShellTool.MAX_OUTPUT_BYTES for the same reason. Without it a single
  // read_file on a lockfile or a log could blow the whole context, even though
  // the system prompt already promises callers a `truncated` flag.
  static readonly MAX_CONTENT_BYTES = 32 * 1024;

  constructor(private readonly root: string) {
    super();
  }

  get name(): string {
    return "read_file";
  }

  get description(): string {
    return "Read a UTF-8 text file relative to the workspace root. Long files are truncated; the result reports `truncated`, `bytesRead` and `totalBytes`.";
  }

  override get capabilities(): string[] {
    return ["File System"];
  }

  override get tags(): string[] {
    return ["read", "file", "view", "cat", "open", "show", "inspect"];
  }

  get parameters(): Record<string, unknown> {
    return { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const relPath = args.path as string;
    const path = resolveWorkspacePath(this.root, relPath);

    // Read as bytes and cut on a byte boundary, then decode — slicing the
    // decoded string would count UTF-16 code units against a byte budget and
    // could split a multi-byte character.
    const raw = await readFile(path);
    const totalBytes = raw.byteLength;
    const truncated = totalBytes > ReadFileTool.MAX_CONTENT_BYTES;
    const slice = truncated ? raw.subarray(0, ReadFileTool.MAX_CONTENT_BYTES) : raw;
    // `fatal: false` (the default) replaces a trailing partial character with
    // U+FFFD rather than throwing.
    const content = new TextDecoder("utf-8").decode(slice);

    return { path: relPath, content, truncated, bytesRead: slice.byteLength, totalBytes };
  }
}

export class WriteFileTool extends Tool {
  constructor(private readonly root: string) {
    super();
  }

  get name(): string {
    return "write_file";
  }

  get description(): string {
    return "Write a UTF-8 text file relative to the workspace root. Overwrites atomically.";
  }

  override get capabilities(): string[] {
    return ["File System"];
  }

  override get tags(): string[] {
    return ["write", "file", "create", "save", "update", "new"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const relPath = args.path as string;
    const content = args.content as string;
    const path = resolveWorkspacePath(this.root, relPath);
    await mkdir(dirname(path), { recursive: true });

    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    try {
      await writeFile(tmp, content, "utf-8");
      await rename(tmp, path);
      return { path: relPath, bytesWritten: Buffer.byteLength(content, "utf-8") };
    } finally {
      try {
        await stat(tmp);
        await unlink(tmp);
      } catch {
        // tmp already gone (rename succeeded) — nothing to clean up
      }
    }
  }
}
