import { Provider, ProviderError } from "../../src/provider/provider.js";

// The SDK's internal HttpClient calls globalThis.fetch, so mocking
// globalThis.fetch gives us full control without needing to mock the
// ESM module boundary (which is fragile under ts-jest ESM mode).

describe("Provider cloud auth", () => {
  it("throws ProviderError before making a request when apiKey is missing", async () => {
    const provider = new Provider({ tier: "cloud", model: "test-model", host: "https://example.invalid" });

    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(ProviderError);
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/missing apiKey/);
  });

  it("does not throw the apiKey error for local tier", async () => {
    const provider = new Provider({ tier: "local", model: "test-model", host: "http://127.0.0.1:1" });

    // Local will fail with a connection error (ProviderError from mapError), not "missing apiKey"
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.not.toThrow(/missing apiKey/);
  });
});

describe("Provider error redaction", () => {
  it("redacts bearer tokens from upstream error bodies", async () => {
    // SDK's HttpClient reads error bodies via response.json() then falls
    // back to response.text() — the body is consumed after json() fails,
    // so we must give it valid JSON.  The SDK extracts the "error" field.
    const fakeFetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "upstream failed, saw header Authorization: Bearer sk-secret-abc123" }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );
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
    const body = JSON.stringify({ model: "m", message: { role: "assistant", content: "ok" }, done: true });
    const fakeFetch = jest.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKey: "solo_key", host: "https://x" });
    await provider.chat([{ role: "user", content: "hi" }]);

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const reqUrl = new URL(fakeFetch.mock.calls[0][0] as string);
    expect(reqUrl.pathname).toBe("/api/chat");
  });

  it("uses the first key in the pool by default", async () => {
    const body = JSON.stringify({ model: "m", message: { role: "assistant", content: "ok" }, done: true });
    const fakeFetch = jest.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKeys: ["key_a", "key_b"], host: "https://x" });
    await provider.chat([{ role: "user", content: "hi" }]);

    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("rotates to the next key and retries on a 429, succeeding without throwing", async () => {
    const fakeFetch = jest.fn().mockImplementation(async () => {
      // SDK may read the body multiple times (clone + read); create a factory
      // that returns a fresh Response each time it's called.
      if (fakeFetch.mock.calls.length === 1) {
        return new Response(
          JSON.stringify({ error: "rate limited" }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ model: "m", message: { role: "assistant", content: "ok" }, done: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKeys: ["key_a", "key_b"], host: "https://x" });
    const result = await provider.chat([{ role: "user", content: "hi" }]);

    expect(result.message.content).toBe("ok");
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("throws RateLimitError once every key in the pool is rate-limited", async () => {
    const fakeFetch = jest.fn().mockImplementation(() => {
      return new Response(
        JSON.stringify({ error: "rate limited" }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    });
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKeys: ["key_a", "key_b"], host: "https://x" });

    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/rate limited on all 2 key/);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps rotation state across calls — a later call starts from the last successful key", async () => {
    const fakeFetch = jest.fn().mockImplementation(async () => {
      const n = fakeFetch.mock.calls.length;
      if (n === 1) {
        return new Response(
          JSON.stringify({ error: "rate limited" }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }
      if (n === 2) {
        return new Response(
          JSON.stringify({ model: "m", message: { role: "assistant", content: "first" }, done: true }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ model: "m", message: { role: "assistant", content: "second" }, done: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKeys: ["key_a", "key_b"], host: "https://x" });
    await provider.chat([{ role: "user", content: "hi" }]);
    await provider.chat([{ role: "user", content: "hi again" }]);

    expect(fakeFetch).toHaveBeenCalledTimes(3);
  });
});
