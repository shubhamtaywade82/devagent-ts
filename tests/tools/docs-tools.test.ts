import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocsStore } from "../../src/docs/store.js";
import { SearchDocsTool, GetDocTool, ListDocSourcesTool } from "../../src/tools/docs-tools.js";

async function seededStore(dir: string): Promise<DocsStore> {
  const store = new DocsStore(join(dir, "docs.db"));
  store.upsertSource({ slug: "react", name: "React", ingestedAt: 1 });
  store.replaceSections("react", [
    { path: "hooks#useeffect", title: "useEffect", body: "useEffect runs a side effect after render" },
  ]);
  store.upsertSource({ slug: "node", name: "Node.js", ingestedAt: 1 });
  store.replaceSections("node", [
    { path: "fs#readfile", title: "fs.readFile", body: "readFile reads a file asynchronously" },
  ]);
  return store;
}

describe("SearchDocsTool", () => {
  it("auto-scopes to the workspace's detected doc sources when no source is given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docs-tool-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }),
    );
    const store = await seededStore(dir);
    const tool = new SearchDocsTool(store, dir);

    const result = await tool.call({ query: "runs a side effect" });
    expect(result.scope).toBe("workspace");
    expect((result.results as unknown[]).length).toBe(1);
    expect(result.results).toEqual([expect.objectContaining({ source: "react" })]);

    store.close();
  });

  it("searches all ingested sources when the workspace has no detectable kind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docs-tool-"));
    const store = await seededStore(dir);
    const tool = new SearchDocsTool(store, dir);

    const result = await tool.call({ query: "reads a file" });
    expect(result.scope).toBe("all");
    expect(result.results).toEqual([expect.objectContaining({ source: "node" })]);

    store.close();
  });

  it("restricts to an explicit source and errors on an unknown one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docs-tool-"));
    const store = await seededStore(dir);
    const tool = new SearchDocsTool(store, dir);

    const scoped = await tool.call({ query: "asynchronously", source: "node" });
    expect(scoped.scope).toBe("explicit");
    expect(scoped.results).toEqual([expect.objectContaining({ source: "node" })]);

    const unknown = await tool.call({ query: "anything", source: "not-ingested" });
    expect(unknown.error).toBe("UnknownSourceError");

    store.close();
  });

  it("rejects an empty query", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docs-tool-"));
    const store = await seededStore(dir);
    const tool = new SearchDocsTool(store, dir);

    const result = await tool.call({ query: "  " });
    expect(result.error).toBe("ArgumentError");

    store.close();
  });
});

describe("GetDocTool", () => {
  it("returns a section's full body by source + path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docs-tool-"));
    const store = await seededStore(dir);
    const tool = new GetDocTool(store);

    const result = await tool.call({ source: "react", path: "hooks#useeffect" });
    expect(result).toMatchObject({
      source: "react",
      path: "hooks#useeffect",
      title: "useEffect",
      truncated: false,
    });

    store.close();
  });

  it("truncates bodies over the size cap and flags it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docs-tool-"));
    const store = new DocsStore(join(dir, "docs.db"));
    store.upsertSource({ slug: "node", name: "Node.js", ingestedAt: 1 });
    store.replaceSections("node", [{ path: "cli", title: "CLI", body: "x".repeat(7000) }]);
    const tool = new GetDocTool(store);

    const result = await tool.call({ source: "node", path: "cli" });
    expect(result.truncated).toBe(true);
    expect((result.body as string).length).toBe(6000);

    store.close();
  });

  it("errors when the section doesn't exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docs-tool-"));
    const store = await seededStore(dir);
    const tool = new GetDocTool(store);

    const result = await tool.call({ source: "react", path: "missing" });
    expect(result.error).toBe("NotFoundError");

    store.close();
  });
});

describe("ListDocSourcesTool", () => {
  it("lists ingested sources and the workspace's default scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docs-tool-"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    const store = await seededStore(dir);
    const tool = new ListDocSourcesTool(store, dir);

    const result = await tool.call({});
    expect(result.ingested).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "react" }), expect.objectContaining({ slug: "node" })]),
    );
    expect(result.workspaceDefaultSources).toEqual(["react", "node"]);

    store.close();
  });
});
