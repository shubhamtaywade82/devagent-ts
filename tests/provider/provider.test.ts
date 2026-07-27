import { Provider, ProviderError } from "../../src/provider/provider.js";

describe("Provider cloud auth", () => {
  it("throws ProviderError before making a request when apiKey is missing", async () => {
    const provider = new Provider({ tier: "cloud", model: "test-model", host: "https://example.invalid" });

    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(ProviderError);
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/missing apiKey/);
  });

  it("does not throw the apiKey error for local tier", async () => {
    const provider = new Provider({ tier: "local", model: "test-model", host: "http://127.0.0.1:1" });

    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.not.toThrow(/missing apiKey/);
  });
});

describe("Provider error redaction", () => {
  it("redacts bearer tokens from upstream error bodies", async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "upstream failed, saw header Authorization: Bearer sk-secret-abc123",
    });
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKey: "sk-secret-abc123", host: "https://x" });

    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/\[REDACTED\]/);
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.not.toThrow(/sk-secret-abc123/);
  });
});

describe("Provider apiKeys pool (Ollama Cloud only)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the single apiKey when no pool is given", async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { role: "assistant", content: "ok" }, done: true }),
    });
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKey: "solo_key", host: "https://x" });
    await provider.chat([{ role: "user", content: "hi" }]);

    expect(fakeFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer solo_key");
  });

  it("uses the first key in the pool by default", async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { role: "assistant", content: "ok" }, done: true }),
    });
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKeys: ["key_a", "key_b"], host: "https://x" });
    await provider.chat([{ role: "user", content: "hi" }]);

    expect(fakeFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer key_a");
  });

  it("rotates to the next key and retries on a 429, succeeding without throwing", async () => {
    const fakeFetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: { role: "assistant", content: "ok" }, done: true }),
      });
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKeys: ["key_a", "key_b"], host: "https://x" });
    const result = await provider.chat([{ role: "user", content: "hi" }]);

    expect(result.message.content).toBe("ok");
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(fakeFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer key_a");
    expect(fakeFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer key_b");
  });

  it("throws RateLimitError once every key in the pool is rate-limited", async () => {
    const fakeFetch = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKeys: ["key_a", "key_b"], host: "https://x" });

    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/rate limited on all 2 key/);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps rotation state across calls — a later call starts from the last successful key", async () => {
    const fakeFetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" }) // key_a fails
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: { role: "assistant", content: "first" }, done: true }),
      }) // key_b succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: { role: "assistant", content: "second" }, done: true }),
      }); // second call should go straight to key_b
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKeys: ["key_a", "key_b"], host: "https://x" });
    await provider.chat([{ role: "user", content: "hi" }]);
    await provider.chat([{ role: "user", content: "hi again" }]);

    expect(fakeFetch).toHaveBeenCalledTimes(3);
    expect(fakeFetch.mock.calls[2][1].headers.Authorization).toBe("Bearer key_b");
  });
});

// A non-JSON line mid-stream (proxy error page, keep-alive, truncated write)
// used to throw a SyntaxError straight out of chat(), killing the turn. The
// trailing-buffer parse already tolerated this, so the two paths disagreed.
describe("Provider streaming resilience", () => {
  function streamOf(lines: string[]): Response {
    const encoder = new TextEncoder();
    let i = 0;
    const body = {
      getReader: () => ({
        read: async () =>
          i < lines.length ? { value: encoder.encode(lines[i++]), done: false } : { value: undefined, done: true },
        releaseLock: () => {},
      }),
      cancel: async () => {},
    };
    return { ok: true, status: 200, body } as unknown as Response;
  }

  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  it("skips a malformed line and still returns the accumulated response", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue(
      streamOf([
        JSON.stringify({ message: { role: "assistant", content: "he" }, done: false }) + "\n",
        "<html>502 Bad Gateway</html>\n",
        JSON.stringify({ message: { role: "assistant", content: "llo" }, done: true }) + "\n",
      ]),
    );
    const provider = new Provider({ tier: "local", model: "m", host: "http://127.0.0.1:1" });

    const res = await provider.chat([{ role: "user", content: "hi" }], { stream: true });

    expect(res.message.content).toBe("hello");
    expect(res.done).toBe(true);
  });

  it("releases the reader and cancels the body once the stream is consumed", async () => {
    const releaseLock = jest.fn();
    const cancel = jest.fn().mockResolvedValue(undefined);
    const encoder = new TextEncoder();
    let i = 0;
    const lines = [JSON.stringify({ message: { role: "assistant", content: "x" }, done: true }) + "\n"];
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () =>
            i < lines.length ? { value: encoder.encode(lines[i++]), done: false } : { value: undefined, done: true },
          releaseLock,
        }),
        cancel,
      },
    } as unknown as Response);
    const provider = new Provider({ tier: "local", model: "m", host: "http://127.0.0.1:1" });

    await provider.chat([{ role: "user", content: "hi" }], { stream: true });

    expect(releaseLock).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });
});
