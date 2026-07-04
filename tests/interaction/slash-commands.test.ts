import { builtinCommands, parseSlashInput, SlashCommandRegistry } from "../../src/interaction/slash-commands";

describe("parseSlashInput", () => {
  it("parses name and args", () => {
    expect(parseSlashInput("/model qwen3:30b")).toEqual({ name: "model", args: "qwen3:30b" });
    expect(parseSlashInput("/help")).toEqual({ name: "help", args: "" });
    expect(parseSlashInput("not a command")).toBeNull();
    expect(parseSlashInput("/")).toBeNull();
  });
});

describe("SlashCommandRegistry", () => {
  it("finds commands by name or alias", () => {
    const registry = builtinCommands();
    expect(registry.find("help")?.name).toBe("help");
    expect(registry.find("h")?.name).toBe("help");
    expect(registry.find("compact")?.name).toBe("reset");
    expect(registry.find("nope")).toBeUndefined();
  });

  it("completes by prefix", () => {
    const registry = builtinCommands();
    const names = registry.complete("m").map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["mcp", "memory", "model", "models"]));
    expect(names).not.toContain("git");
  });

  it("registering the same name replaces the command", () => {
    const registry = new SlashCommandRegistry();
    registry.register({ name: "x", aliases: [], description: "one", execute: () => ({ kind: "quit" }) });
    registry.register({
      name: "x",
      aliases: [],
      description: "two",
      execute: () => ({ kind: "message", text: "hi" }),
    });
    expect(registry.all()).toHaveLength(1);
    expect(registry.find("x")?.description).toBe("two");
  });

  it("built-in effects map to the expected kinds", () => {
    const registry = builtinCommands();
    expect(registry.find("clear")!.execute("")).toEqual({ kind: "clear-conversation" });
    expect(registry.find("model")!.execute("qwen3:8b")).toEqual({ kind: "set-model", model: "qwen3:8b" });
    expect(registry.find("model")!.execute("")).toEqual({ kind: "open-overlay", overlay: "model" });
    expect(registry.find("git")!.execute("")).toEqual({ kind: "focus-view", view: "git" });
    expect(registry.find("quit")!.execute("")).toEqual({ kind: "quit" });
  });
});
