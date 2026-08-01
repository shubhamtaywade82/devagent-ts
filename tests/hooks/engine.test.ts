import { HookEngine } from "../../src/hooks/engine.js";

describe("Hooks - Engine", () => {
  it("allows tool calls when no pre-hooks block execution", async () => {
    const engine = new HookEngine();
    const res = await engine.runPreToolUse({ toolName: "read_file", input: { path: "src/main.ts" } });

    expect(res.allow).toBe(true);
  });

  it("blocks tool calls when a pre-hook returns allow: false", async () => {
    const engine = new HookEngine();
    engine.onPreToolUse((ctx) => {
      if (ctx.toolName === "delete_file") {
        return { allow: false, reason: "Deleting files is blocked" };
      }
      return { allow: true };
    });

    const blocked = await engine.runPreToolUse({ toolName: "delete_file", input: {} });
    expect(blocked.allow).toBe(false);
    if (!blocked.allow) {
      expect(blocked.reason).toBe("Deleting files is blocked");
    }
  });

  it("transforms prompts via user prompt submit hooks", async () => {
    const engine = new HookEngine();
    engine.onUserPromptSubmit((p) => ({ allow: true, updatedPrompt: p.trim() }));

    const res = await engine.runUserPromptSubmit("  hello world  ");
    expect(res.allow).toBe(true);
    if (res.allow) {
      expect(res.updatedPrompt).toBe("hello world");
    }
  });
});
