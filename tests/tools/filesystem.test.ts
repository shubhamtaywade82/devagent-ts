import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadFileTool, WriteFileTool, PathEscapeError } from "../../src/tools/filesystem";

describe("ReadFileTool", () => {
  it("reads a file inside the workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    await writeFile(join(dir, "a.txt"), "hello");
    const tool = new ReadFileTool(dir);

    const result = await tool.call({ path: "a.txt" });

    expect(result.content).toBe("hello");
  });

  it("rejects a path that escapes the workspace root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    const tool = new ReadFileTool(dir);

    await expect(tool.call({ path: "../../etc/passwd" })).rejects.toBeInstanceOf(PathEscapeError);
  });
});

describe("WriteFileTool", () => {
  it("writes atomically, creating parent directories as needed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    const tool = new WriteFileTool(dir);

    await tool.call({ path: "out/b.txt", content: "data" });

    expect(await readFile(join(dir, "out/b.txt"), "utf-8")).toBe("data");
  });

  it("leaves no temp file behind after a successful write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    const tool = new WriteFileTool(dir);

    await tool.call({ path: "c.txt", content: "data" });

    const files = await readdir(dir);
    expect(files.some((f) => f.includes(".tmp."))).toBe(false);
  });

  it("rejects a path that escapes the workspace root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    const tool = new WriteFileTool(dir);

    await expect(tool.call({ path: "../outside.txt", content: "x" })).rejects.toBeInstanceOf(PathEscapeError);
  });
});
