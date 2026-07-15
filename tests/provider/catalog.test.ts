import { Provider } from "../../src/provider/provider";
import { ModelCatalog, inferCapabilities } from "../../src/provider/catalog";

describe("inferCapabilities", () => {
  it("tags vision models", () => {
    expect(inferCapabilities("qwen3-vl:4b")).toEqual(expect.arrayContaining(["vision", "tools"]));
  });

  it("tags reasoning models", () => {
    expect(inferCapabilities("deepseek-r1:8b")).toEqual(expect.arrayContaining(["reasoning", "tools"]));
  });

  it("tags small models as quick", () => {
    expect(inferCapabilities("nemotron-3-nano:4b")).toEqual(expect.arrayContaining(["quick", "tools"]));
  });

  it("defaults to coding for plain instruct models", () => {
    expect(inferCapabilities("qwen3:8b")).toEqual(expect.arrayContaining(["coding", "tools"]));
  });
});

describe("ModelCatalog.refresh", () => {
  it("merges local and cloud model lists, tagged by tier", async () => {
    const local = new Provider({ tier: "local", model: "x" });
    const cloud = new Provider({ tier: "cloud", model: "x", apiKey: "k" });

    jest.spyOn(local, "availableModels").mockResolvedValue({ models: [{ name: "qwen3:8b" }] });
    jest.spyOn(cloud, "availableModels").mockResolvedValue({ data: [{ id: "qwen3-vl:4b" }] });

    const catalog = new ModelCatalog(local, cloud);
    const models = await catalog.refresh();

    expect(models).toEqual([
      { name: "qwen3:8b", tier: "local", capabilities: expect.arrayContaining(["coding"]) },
      { name: "qwen3-vl:4b", tier: "cloud", capabilities: expect.arrayContaining(["vision"]) },
    ]);
  });

  it("tolerates an unreachable local Ollama and keeps cloud models", async () => {
    const local = new Provider({ tier: "local", model: "x" });
    const cloud = new Provider({ tier: "cloud", model: "x", apiKey: "k" });

    jest.spyOn(local, "availableModels").mockRejectedValue(new Error("ECONNREFUSED"));
    jest.spyOn(cloud, "availableModels").mockResolvedValue({ data: [{ id: "qwen3:8b" }] });

    const catalog = new ModelCatalog(local, cloud);
    const models = await catalog.refresh();

    expect(models).toHaveLength(1);
    expect(models[0].tier).toBe("cloud");
  });

  it("modelsFor sorts local candidates before cloud", async () => {
    const local = new Provider({ tier: "local", model: "x" });
    const cloud = new Provider({ tier: "cloud", model: "x", apiKey: "k" });

    jest.spyOn(local, "availableModels").mockResolvedValue({ models: [{ name: "qwen3:8b" }] });
    jest.spyOn(cloud, "availableModels").mockResolvedValue({ data: [{ id: "qwen3.5:8b" }] });

    const catalog = new ModelCatalog(local, cloud);
    await catalog.refresh();

    const candidates = catalog.modelsFor("coding");
    expect(candidates[0].tier).toBe("local");
  });
});
