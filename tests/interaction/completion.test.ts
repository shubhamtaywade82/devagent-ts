import { acceptWord, completions, ghostSuffix } from "../../src/interaction/completion.js";
import { builtinCommands } from "../../src/interaction/slash-commands.js";

describe("ghostSuffix", () => {
  const history = ["create filesystem tool", "create tests", "fix docker"];

  it("suggests the newest matching continuation", () => {
    expect(ghostSuffix("create", history)).toBe(" tests");
    expect(ghostSuffix("create f", history)).toBe("ilesystem tool");
    expect(ghostSuffix("zzz", history)).toBe("");
    expect(ghostSuffix("", history)).toBe("");
  });

  it("never suggests the input itself", () => {
    expect(ghostSuffix("fix docker", history)).toBe("");
  });
});

describe("acceptWord", () => {
  it("accepts one word including leading whitespace", () => {
    expect(acceptWord(" filesystem tool")).toEqual({ accepted: " filesystem", rest: " tool" });
    expect(acceptWord("tool")).toEqual({ accepted: "tool", rest: "" });
  });
});

describe("completions", () => {
  const registry = builtinCommands();

  it("offers slash commands for a / prefix", () => {
    const items = completions("/mo", registry);
    expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(["/model", "/models"]));
    expect(items[0].insert.startsWith("/")).toBe(true);
  });

  it("offers nothing for plain text, or after a space for free-form commands", () => {
    expect(completions("model", registry)).toEqual([]);
    expect(completions("/model qwen", registry)).toEqual([]);
  });

  it("offers subcommand values for commands that declare argValues", () => {
    const modeItems = completions("/mode a", registry);
    expect(modeItems.map((i) => i.label)).toEqual(["ask", "architect", "autonomous"]);
    expect(modeItems[0].insert).toBe("/mode ask");

    expect(completions("/theme mid", registry).map((i) => i.label)).toEqual(["midnight"]);
    expect(completions("/tier c", registry).map((i) => i.label)).toEqual(["cloud"]);
  });

  it("stops completing once a second argument token starts", () => {
    expect(completions("/mode ask ", registry)).toEqual([]);
  });

  it("populates kind and group on command completions", () => {
    const items = completions("/mo", registry);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.kind).toBe("command");
      expect(item.group).toBeDefined();
    }
  });

  it("populates kind on argument completions", () => {
    const items = completions("/mode a", registry);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.kind).toBe("argument");
    }
  });

  it("command completions have meaningful group labels", () => {
    const modelItems = completions("/model", registry);
    const modelItem = modelItems.find((i) => i.label === "/model");
    expect(modelItem?.group).toBe("Model");

    const helpItems = completions("/help", registry);
    const helpItem = helpItems.find((i) => i.label === "/help");
    expect(helpItem?.group).toBe("General");
  });
});

