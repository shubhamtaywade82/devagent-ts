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

describe("Provider dynamic key resolution", () => {
  const fakeFetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ message: { role: "assistant", content: "ok" }, done: true }),
  });

  beforeEach(() => {
    (globalThis as any).fetch = fakeFetch;
    fakeFetch.mockClear();
  });

  it("selects key matching model pattern", async () => {
    const apiKeys = {
      openai: "openai_key",
      anthropic: "anthropic_key",
      deepseek: "deepseek_key",
      ollama: "ollama_key",
    };

    const provider = new Provider({
      tier: "cloud",
      model: "gpt-4o",
      apiKeys,
      apiKey: "fallback_key",
      host: "https://x",
    });

    await provider.chat([{ role: "user", content: "hi" }]);

    expect(fakeFetch).toHaveBeenCalled();
    const [, options] = fakeFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer openai_key");
  });

  it("selects anthropic key for claude models", async () => {
    const apiKeys = {
      openai: "openai_key",
      anthropic: "anthropic_key",
    };

    const provider = new Provider({
      tier: "cloud",
      model: "claude-3-opus",
      apiKeys,
      apiKey: "fallback_key",
      host: "https://x",
    });

    await provider.chat([{ role: "user", content: "hi" }]);

    expect(fakeFetch).toHaveBeenCalled();
    const [, options] = fakeFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer anthropic_key");
  });

  it("falls back to primary apiKey if no specific key exists", async () => {
    const apiKeys = {
      openai: "openai_key",
    };

    const provider = new Provider({
      tier: "cloud",
      model: "claude-3-opus",
      apiKeys,
      apiKey: "fallback_key",
      host: "https://x",
    });

    await provider.chat([{ role: "user", content: "hi" }]);

    expect(fakeFetch).toHaveBeenCalled();
    const [, options] = fakeFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer fallback_key");
  });
});
