import { Provider, RateLimitError, ProviderError, ChatResponse } from "../../src/provider/provider.js";
import { ModelCatalog } from "../../src/provider/catalog.js";
import { Router } from "../../src/provider/router.js";

const okResponse = (content: string): ChatResponse => ({
  message: { role: "assistant", content },
  done: true,
});

describe("Router.route", () => {
  it("picks a local candidate for the requested capability", async () => {
    const local = new Provider({ tier: "local", model: "x" });
    const cloud = new Provider({ tier: "cloud", model: "x", apiKey: "k" });
    const catalog = new ModelCatalog(local, cloud);

    jest.spyOn(local, "availableModels").mockResolvedValue({ models: [{ name: "qwen3:8b" }] });
    jest.spyOn(cloud, "availableModels").mockResolvedValue({ data: [{ id: "qwen3.5:8b" }] });
    await catalog.refresh();

    const localChat = jest.spyOn(local, "chat").mockResolvedValue(okResponse("hi"));
    const cloudChat = jest.spyOn(cloud, "chat");

    const router = new Router({ local, cloud, catalog, logger: { warn: jest.fn() } });
    const result = await router.route("coding", [{ role: "user", content: "hi" }]);

    expect(result.message.content).toBe("hi");
    expect(localChat).toHaveBeenCalled();
    expect(cloudChat).not.toHaveBeenCalled();
    expect(local.currentModel).toBe("qwen3:8b");
  });

  it("falls back to the next candidate on a recoverable error", async () => {
    const local = new Provider({ tier: "local", model: "x" });
    const cloud = new Provider({ tier: "cloud", model: "x", apiKey: "k" });
    const catalog = new ModelCatalog(local, cloud);

    jest.spyOn(local, "availableModels").mockResolvedValue({ models: [{ name: "qwen3:8b" }] });
    jest.spyOn(cloud, "availableModels").mockResolvedValue({ data: [{ id: "qwen3.5:8b" }] });
    await catalog.refresh();

    jest.spyOn(local, "chat").mockRejectedValue(new RateLimitError("busy"));
    jest.spyOn(cloud, "chat").mockResolvedValue(okResponse("from cloud"));

    const router = new Router({ local, cloud, catalog, logger: { warn: jest.fn() } });
    const result = await router.route("coding", [{ role: "user", content: "hi" }]);

    expect(result.message.content).toBe("from cloud");
  });

  it("rethrows non-recoverable errors without trying other candidates", async () => {
    const local = new Provider({ tier: "local", model: "x" });
    const cloud = new Provider({ tier: "cloud", model: "x", apiKey: "k" });
    const catalog = new ModelCatalog(local, cloud);

    jest.spyOn(local, "availableModels").mockResolvedValue({ models: [{ name: "qwen3:8b" }] });
    jest.spyOn(cloud, "availableModels").mockResolvedValue({ data: [{ id: "qwen3.5:8b" }] });
    await catalog.refresh();

    jest.spyOn(local, "chat").mockRejectedValue(new ProviderError("bad request"));
    const cloudChat = jest.spyOn(cloud, "chat");

    const router = new Router({ local, cloud, catalog, logger: { warn: jest.fn() } });

    await expect(router.route("coding", [{ role: "user", content: "hi" }])).rejects.toThrow(ProviderError);
    expect(cloudChat).not.toHaveBeenCalled();
  });

  it("throws when no model in the catalog has the requested capability", async () => {
    const local = new Provider({ tier: "local", model: "x" });
    const catalog = new ModelCatalog(local);
    jest.spyOn(local, "availableModels").mockResolvedValue({ models: [] });
    await catalog.refresh();

    const router = new Router({ local, catalog, logger: { warn: jest.fn() } });

    await expect(router.route("vision", [{ role: "user", content: "hi" }])).rejects.toThrow(/no model available/);
  });
});
