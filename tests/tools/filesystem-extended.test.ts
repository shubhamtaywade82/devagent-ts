import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListDirectoryTool, DeleteFileTool, MoveFileTool, CopyFileTool, MakeDirectoryTool, SearchFilesTool, GrepFilesTool, FileMetadataTool } from "../../src/tools/filesystem-extended";

describe("Extended filesystem tools", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fs-ext-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("ListDirectoryTool", () => {
    it("lists files in a directory", async () => {
      await writeFile(join(dir, "a.ts"), "x");
      await writeFile(join(dir, "b.ts"), "y");
      const tool = new ListDirectoryTool(dir);
      const result = await tool.call({ path: "." });

      expect(result.path).toBe(".");
      const names = (result as any).entries.map((e: any) => e.name).sort();
      expect(names).toEqual(["a.ts", "b.ts"]);
    });
  });

  describe("MakeDirectoryTool", () => {
    it("creates nested directories", async () => {
      const tool = new MakeDirectoryTool(dir);
      const result = await tool.call({ path: "nested/deep" });

      expect((result as any).created).toBe(true);
      expect((await readFile(join(dir, "nested/deep/tmp"), "utf-8"))).toBe("");
    });
  });

  describe("DeleteFileTool", () => {
    it("deletes a file", async () => {
      await writeFile(join(dir, "dead.ts"), "z");
      const tool = new DeleteFileTool(dir);
      const result = await tool.call({ path: "dead.ts" });

      expect((result as any).deleted).toBe(true);
    });
  });

  describe("MoveFileTool", () => {
    it("renames a file within the workspace", async () => {
      await writeFile(join(dir, "old.ts"), "v");
      const tool = new MoveFileTool(dir);
      const result = await tool.call({ from: "old.ts", to: "new.ts" });

      expect((result as any).to).toBe("new.ts");
      expect(readFile(join(dir, "new.ts"), "utf-8")).resolves.toBe("v");
    });
  });

  describe("CopyFileTool", () => {
    it("copies a file without removing the source", async () => {
      await writeFile(join(dir, "src.ts"), "copy-me");
      const tool = new CopyFileTool(dir);
      const result = await tool.call({ from: "src.ts", to: "dst.ts" });

      expect((result as any).to).toBe("dst.ts");
      expect(readFile(join(dir, "src.ts"), "utf-8")).resolves.toBe("copy-me");
      expect(readFile(join(dir, "dst.ts"), "utf-8")).resolves.toBe("copy-me");
    });
  });

  describe("GrepFilesTool", () => {
    it("matches literal text in source files", async () => {
      await writeFile(join(dir, "hello.ts"), "console.log('hello world');");
      await writeFile(join(dir, "README.md"), "Gate command: world");
      const tool = new GrepFilesTool(dir);
      const result = await tool.call({ query: "world" });

      const files = (result as any).matches.map((m: any) => m.file);
      expect(files).toContain("hello.ts");
      expect(files.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("FileMetadataTool", () => {
    it("returns file metadata", async () => {
      await writeFile(join(dir, "meta.json"), "{}");
      const tool = new FileMetadataTool(dir);
      const result = await tool.call({ path: "meta.json" });

      expect((result as any).isFile).toBe(true);
      expect((result as any).isDirectory).toBe(false);
      expect((result as any).extension).toBe("json");
    });
  });
});
