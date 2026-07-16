import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchDocManifest,
  resolveManifestEntry,
  splitIntoSections,
  ingestDocSource,
  DocsIngestError,
} from "../../src/docs/ingest.js";
import { DocsStore } from "../../src/docs/store.js";
import { DocManifestEntry } from "../../src/docs/types.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

const MANIFEST: DocManifestEntry[] = [
  {
    name: "Node.js",
    slug: "node",
    type: "node",
    version: "",
    release: "24.0.0",
    mtime: 1,
    attribution: "attr",
    links: { home: "https://nodejs.org" },
  },
  { name: "Rails", slug: "rails~7.2", type: "rails", version: "7.2", release: "7.2.0", mtime: 2 },
  { name: "Rails", slug: "rails~8.0", type: "rails", version: "8.0", release: "8.0.0", mtime: 3 },
  { name: "Rails", slug: "rails~6.1", type: "rails", version: "6.1", release: "6.1.0", mtime: 4 },
];

describe("fetchDocManifest", () => {
  it("fetches and parses the manifest JSON", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(MANIFEST));
    const manifest = await fetchDocManifest({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(manifest).toEqual(MANIFEST);
  });

  it("throws DocsIngestError on a non-ok response", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({}, false, 500));
    await expect(fetchDocManifest({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      DocsIngestError,
    );
  });
});

describe("resolveManifestEntry", () => {
  it("resolves an exact bare slug", () => {
    expect(resolveManifestEntry(MANIFEST, "node")?.slug).toBe("node");
  });

  it("resolves a logical catalog id to its slug", () => {
    expect(resolveManifestEntry(MANIFEST, "node")?.name).toBe("Node.js");
  });

  it("picks the highest numeric version when only versioned slugs exist", () => {
    expect(resolveManifestEntry(MANIFEST, "rails")?.slug).toBe("rails~8.0");
  });

  it("returns undefined for an unknown source", () => {
    expect(resolveManifestEntry(MANIFEST, "not-a-real-doc")).toBeUndefined();
  });
});

describe("splitIntoSections", () => {
  it("splits top-level <section> blocks into one row per heading id", () => {
    const html =
      '<section><h1 id="assert">Assert</h1><p>The assert module.</p></section>' +
      '<section><h3 id="strict-mode">Strict mode</h3><p>Strict assertion mode details.</p></section>';
    const sections = splitIntoSections("assert", html, new Map());

    expect(sections).toEqual([
      { path: "assert", title: "Assert", body: expect.stringContaining("The assert module.") },
      {
        path: "assert#strict-mode",
        title: "Strict mode",
        body: expect.stringContaining("Strict assertion mode details."),
      },
    ]);
  });

  it("falls back to a single section keyed by basePath when there are no <section> tags", () => {
    const sections = splitIntoSections("overview", "<p>Just plain content, no sections.</p>", new Map());
    expect(sections).toEqual([
      { path: "overview", title: "overview", body: expect.stringContaining("Just plain content") },
    ]);
  });

  it("drops sections with empty text content", () => {
    const html = '<section><h2 id="empty"></h2></section>';
    expect(splitIntoSections("page", html, new Map())).toEqual([]);
  });
});

describe("ingestDocSource", () => {
  it("fetches manifest + index + db, splits sections, and stores them", async () => {
    const index = {
      entries: [
        { name: "assert()", path: "assert", type: "Assert" },
        { name: "strict mode", path: "assert#strict-mode", type: "Assert" },
      ],
    };
    const db = {
      assert:
        '<section><h1 id="assert">Assert</h1><p>The assert module.</p></section>' +
        '<section><h3 id="strict-mode">Strict mode</h3><p>Strict assertion mode details.</p></section>',
    };

    const fetchImpl = jest.fn(async (url: string) => {
      if (url.endsWith("docs.json")) return jsonResponse(MANIFEST);
      if (url.endsWith("index.json")) return jsonResponse(index);
      if (url.endsWith("db.json")) return jsonResponse(db);
      throw new Error(`unexpected url: ${url}`);
    });

    const dir = await mkdtemp(join(tmpdir(), "docs-ingest-"));
    const store = new DocsStore(join(dir, "docs.db"));

    const result = await ingestDocSource(store, "node", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toEqual({ slug: "node", name: "Node.js", sectionCount: 2 });
    expect(store.listSources()).toEqual([expect.objectContaining({ slug: "node", name: "Node.js", sectionCount: 2 })]);
    expect(store.search("strict assertion")).toEqual([
      expect.objectContaining({ source: "node", path: "assert#strict-mode" }),
    ]);
    store.close();
  });

  it("throws DocsIngestError when the source isn't in the manifest", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(MANIFEST));
    const dir = await mkdtemp(join(tmpdir(), "docs-ingest-"));
    const store = new DocsStore(join(dir, "docs.db"));

    await expect(
      ingestDocSource(store, "not-a-real-doc", { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(DocsIngestError);
    store.close();
  });
});
