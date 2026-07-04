import { Provider, ProviderError } from "../../src/provider/provider";

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
    // A real Response (not a plain object stand-in): ollama-js's internal error
    // parsing reads response.headers.get("content-type"), which a bare object
    // mock doesn't have.
    const fakeFetch = jest.fn().mockResolvedValue(
      new Response("upstream failed, saw header Authorization: Bearer sk-secret-abc123", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    (globalThis as any).fetch = fakeFetch;

    const provider = new Provider({ tier: "cloud", model: "m", apiKey: "sk-secret-abc123", host: "https://x" });

    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/\[REDACTED\]/);
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.not.toThrow(/sk-secret-abc123/);
  });
});
