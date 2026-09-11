import { IntentResolver } from "@nemesis-oss/nexum-devagent/intent/intent-resolver";

describe("IntentResolver", () => {
  const resolver = new IntentResolver();

  describe("checkAmbiguity", () => {
    it("detects ambiguous 'explain oops' and provides structured options", () => {
      const result = resolver.checkAmbiguity("explain oops");
      expect(result).not.toBeNull();
      expect(result?.question).toContain("OOP");
      expect(result?.options.length).toBeGreaterThanOrEqual(4);
      expect(result?.options.some((o) => o.id === "custom")).toBe(true);
    });

    it("contextualizes with workspace language when available", () => {
      const result = resolver.checkAmbiguity("explain oops", { language: "TypeScript" });
      expect(result).not.toBeNull();
      const firstOpt = result?.options[0];
      expect(firstOpt?.id).toBe("workspace_typescript");
      expect(firstOpt?.label).toContain("In TypeScript");
    });

    it("detects authentication ambiguity", () => {
      const result = resolver.checkAmbiguity("add authentication");
      expect(result).not.toBeNull();
      expect(result?.question).toContain("authentication");
      expect(result?.options.some((o) => o.id === "jwt")).toBe(true);
    });

    it("returns null when language is explicitly specified in prompt", () => {
      const result = resolver.checkAmbiguity("explain oops in java");
      expect(result).toBeNull();
    });

    it("returns null when prompt targets specific code file", () => {
      const result = resolver.checkAmbiguity("fix auth in src/auth.ts");
      expect(result).toBeNull();
    });

    it("returns null for sufficiently descriptive long prompts", () => {
      const result = resolver.checkAmbiguity(
        "explain how the distributed redis caching layer handles invalidation across multiple cluster nodes",
      );
      expect(result).toBeNull();
    });

    it("returns null for empty prompts", () => {
      expect(resolver.checkAmbiguity("")).toBeNull();
      expect(resolver.checkAmbiguity("   ")).toBeNull();
    });
  });

  describe("refinePrompt", () => {
    it("refines prompt when user selects a structured option", () => {
      const req = resolver.checkAmbiguity("explain oops")!;
      const refined = resolver.refinePrompt("explain oops", { id: req.id, selectedId: "general" }, req.options);
      expect(refined).toContain("explain oops — specifically General OOP concepts");
    });

    it("appends custom user instructions when custom option is selected", () => {
      const req = resolver.checkAmbiguity("explain oops")!;
      const refined = resolver.refinePrompt(
        "explain oops",
        { id: req.id, selectedId: "custom", customText: "compare prototypes with class syntax" },
        req.options,
      );
      expect(refined).toBe("explain oops (Custom instructions: compare prototypes with class syntax)");
    });
  });
});
