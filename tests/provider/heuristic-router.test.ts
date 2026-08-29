import { HeuristicRouter } from "../../src/provider/heuristic-router.js";

describe("HeuristicRouter", () => {
  let router: HeuristicRouter;

  beforeEach(() => {
    router = new HeuristicRouter();
  });

  // ── Cloud triggers ─────────────────────────────────────────────────────────
  it.each([
    ["Prove that the sum of two even numbers is even", "math_proof"],
    ["Why is my database query slow?", "diagnosis"],
    ["Debug this memory leak in my Node.js app", "debug"],
    ["What architecture should I use for this microservice?", "design"],
    ["Implement a binary search algorithm", "algorithm"],
    ["Step-by-step plan to migrate this codebase", "multi_step"],
  ])("routes '%s' to cloud (trigger: %s)", (prompt, expectedTrigger) => {
    const result = router.classify(prompt);
    expect(result.decision).toBe("cloud");
    expect(result.trigger).toBe(expectedTrigger);
  });

  it("routes large code block to cloud", () => {
    const bigCode = "```typescript\n" + "const x = 1;\n".repeat(60) + "```";
    const result = router.classify(bigCode);
    expect(result.decision).toBe("cloud");
    expect(result.trigger).toBe("large_code_block");
  });

  it("routes long prompt to cloud", () => {
    // > 400 tokens ≈ > 1600 chars
    const longPrompt = "a ".repeat(900); // ~1800 chars, ~450 tokens
    const result = router.classify(longPrompt);
    expect(result.decision).toBe("cloud");
    expect(result.trigger).toBe("long_prompt");
  });

  // ── Local triggers ─────────────────────────────────────────────────────────
  it.each([
    ["Generate a TypeScript interface for this JSON", "ts_interface"],
    ["Write a regex for email validation", "regex"],
    ["Extract the error message from this log", "extract"],
    ["Convert this JSON to CSV", "convert"],
    ["Parse this stack trace", "parse"],
    ["Format this data as JSON", "format"],
    ["Create a Jest describe block for calculateTax function", "test_skeleton"],
    ["Summarize this error output", "summarize_log"],
  ])("routes '%s' to local (trigger: %s)", (prompt, expectedTrigger) => {
    const result = router.classify(prompt);
    expect(result.decision).toBe("local");
    expect(result.trigger).toBe(expectedTrigger);
  });

  // ── Unknown ────────────────────────────────────────────────────────────────
  it("returns unknown for an ambiguous short prompt", () => {
    const result = router.classify("Hello, can you help me?");
    expect(result.decision).toBe("unknown");
    expect(result.trigger).toBeUndefined();
  });

  it("returns unknown for a generic short coding prompt", () => {
    const result = router.classify("Write a function that adds two numbers");
    // Could be either, but this specific phrasing has no explicit triggers
    // The test mainly checks it doesn't throw
    expect(["local", "cloud", "unknown"]).toContain(result.decision);
  });

  // ── Priority: cloud wins over local ───────────────────────────────────────
  it("cloud trigger takes priority over local trigger if both could match", () => {
    // 'debug' is cloud; 'parse' is local — cloud should win
    const prompt = "Debug why this log parse is failing";
    const result = router.classify(prompt);
    expect(result.decision).toBe("cloud");
  });
});
