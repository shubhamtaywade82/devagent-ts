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
