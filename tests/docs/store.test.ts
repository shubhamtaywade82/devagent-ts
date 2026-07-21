import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocsStore } from "../../src/docs/store.js";

describe("DocsStore", () => {
  let store: DocsStore;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "docs-store-"));
    store = new DocsStore(join(dir, "docs.db"));
  });

  afterEach(() => {
    store.close();
  });

  it("upserts source metadata and lists it with a zero section count before ingest", () => {
    store.upsertSource({ slug: "node", name: "Node.js", ingestedAt: 1000 });
    expect(store.listSources()).toEqual([expect.objectContaining({ slug: "node", name: "Node.js", sectionCount: 0 })]);
    expect(store.hasSource("node")).toBe(true);
    expect(store.hasSource("missing")).toBe(false);
  });

  it("replaceSections stores rows searchable by full-text query", () => {
    store.upsertSource({ slug: "node", name: "Node.js", ingestedAt: 1000 });
    store.replaceSections("node", [
      { path: "fs", title: "File system", body: "readFile reads a file asynchronously" },
      { path: "http", title: "HTTP", body: "createServer starts an HTTP server" },
    ]);

    const results = store.search("readFile");
    expect(results).toEqual([expect.objectContaining({ source: "node", path: "fs", title: "File system" })]);
    expect(store.listSources()[0].sectionCount).toBe(2);
  });

  it("replaceSections atomically replaces prior rows for the same slug on re-ingest", () => {
    store.upsertSource({ slug: "node", name: "Node.js", ingestedAt: 1000 });
    store.replaceSections("node", [{ path: "old", title: "Old", body: "stale content" }]);
    store.replaceSections("node", [{ path: "new", title: "New", body: "fresh content" }]);

    expect(store.search("stale")).toEqual([]);
    expect(store.search("fresh")).toHaveLength(1);
    expect(store.getSection("node", "old")).toBeUndefined();
  });

  it("search filters by slug when scoped", () => {
    store.upsertSource({ slug: "node", name: "Node.js", ingestedAt: 1000 });
    store.upsertSource({ slug: "ruby", name: "Ruby", ingestedAt: 1000 });
    store.replaceSections("node", [{ path: "fs", title: "fs", body: "async file read write" }]);
    store.replaceSections("ruby", [{ path: "io", title: "io", body: "async file read write" }]);

    const scoped = store.search("read", { slugs: ["ruby"] });
    expect(scoped).toEqual([expect.objectContaining({ source: "ruby" })]);

    const all = store.search("read");
    expect(all).toHaveLength(2);
  });

  it("getSection returns the full body for a known path, undefined otherwise", () => {
    store.upsertSource({ slug: "node", name: "Node.js", ingestedAt: 1000 });
    store.replaceSections("node", [{ path: "fs#readfile", title: "fs.readFile", body: "full body text" }]);

    expect(store.getSection("node", "fs#readfile")).toEqual({
      path: "fs#readfile",
      title: "fs.readFile",
      body: "full body text",
    });
    expect(store.getSection("node", "missing")).toBeUndefined();
  });

  it("finds a match for a natural-language multi-word query with filler words (regression)", () => {
    // Real bug: buildMatchQuery used to join tokens with plain space, which
    // FTS5 treats as AND — "flatMap vs flat in TypeScript" required "vs" AND
    // "in" to literally appear in the same section as "flatMap"/"flat",
    // which real doc prose never does, so the search returned zero results
    // despite the docs being ingested and topically relevant.
    store.upsertSource({ slug: "javascript", name: "JavaScript", ingestedAt: 1000 });
    store.replaceSections("javascript", [
      {
        path: "array#flatmap",
        title: "Array.prototype.flatMap()",
        body: "flatMap maps each element and flattens the result into a new array, unlike flat which only flattens.",
      },
      { path: "array#push", title: "Array.prototype.push()", body: "push adds elements to the end of an array" },
    ]);

    const results = store.search("flatMap vs flat in TypeScript");
    expect(results).toEqual([expect.objectContaining({ source: "javascript", path: "array#flatmap" })]);
  });

  it("does not throw on FTS5-special characters in the query", () => {
    store.upsertSource({ slug: "node", name: "Node.js", ingestedAt: 1000 });
    store.replaceSections("node", [{ path: "cli", title: "cli", body: "the --allow-fs-read flag" }]);

    expect(() => store.search('"unterminated OR near* -syntax:')).not.toThrow();
  });
});
