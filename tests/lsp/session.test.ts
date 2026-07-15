import { LspServerSession } from "../../src/lsp/session";

function makeSession(): LspServerSession {
  return new LspServerSession("/workspace", {
    id: "ruby",
    language: "Ruby",
    serverCommand: "ruby-lsp",
    serverArgs: [],
  } as any);
}

describe("LspServerSession.handleNotification — $/progress indexing tracking", () => {
  it("is not indexing before any progress notification arrives", () => {
    const session = makeSession();
    expect(session.indexing).toBe(false);
  });

  it("becomes indexing on a begin and clears on the matching end", () => {
    const session = makeSession();

    session.handleNotification("$/progress", { token: "t1", value: { kind: "begin", title: "Indexing" } });
    expect(session.indexing).toBe(true);

    session.handleNotification("$/progress", { token: "t1", value: { kind: "report", percentage: 50 } });
    expect(session.indexing).toBe(true);

    session.handleNotification("$/progress", { token: "t1", value: { kind: "end" } });
    expect(session.indexing).toBe(false);
  });

  it("stays indexing while any of several concurrent tokens is still open", () => {
    const session = makeSession();

    session.handleNotification("$/progress", { token: "a", value: { kind: "begin" } });
    session.handleNotification("$/progress", { token: "b", value: { kind: "begin" } });
    expect(session.indexing).toBe(true);

    session.handleNotification("$/progress", { token: "a", value: { kind: "end" } });
    expect(session.indexing).toBe(true); // "b" still open

    session.handleNotification("$/progress", { token: "b", value: { kind: "end" } });
    expect(session.indexing).toBe(false);
  });

  it("clears all in-flight progress tokens on stop", async () => {
    const session = makeSession();
    session.handleNotification("$/progress", { token: "a", value: { kind: "begin" } });
    expect(session.indexing).toBe(true);

    await session.stop();

    expect(session.indexing).toBe(false);
  });

  it("still caches diagnostics from publishDiagnostics alongside progress handling", () => {
    const session = makeSession();
    session.handleNotification("textDocument/publishDiagnostics", {
      uri: "file:///workspace/foo.rb",
      diagnostics: [{ message: "boom" }],
    });
    expect(session.cachedDiagnostics.get("file:///workspace/foo.rb")).toEqual([{ message: "boom" }]);
  });

  it("ignores unrelated notification methods without throwing", () => {
    const session = makeSession();
    expect(() => session.handleNotification("window/logMessage", { message: "hi" })).not.toThrow();
    expect(session.indexing).toBe(false);
  });
});

describe("LspServerSession.state", () => {
  it("includes the indexing flag", () => {
    const session = makeSession();
    expect(session.state).toMatchObject({ language: "Ruby", indexing: false });

    session.handleNotification("$/progress", { token: "a", value: { kind: "begin" } });
    expect(session.state.indexing).toBe(true);
  });
});
