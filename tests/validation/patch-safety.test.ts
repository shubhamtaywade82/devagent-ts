import { applyPatchHunks } from "../../src/validation/apply-hunks.js";
import { validatePatchSafety, validateWriteSafety } from "../../src/validation/patch-safety.js";
import { validateSyntax } from "../../src/validation/syntax.js";

describe("Validation - Patch Safety & Apply Hunks", () => {
  it("applies patch hunks correctly when old_str is unique", () => {
    const original = "function foo() {\n  return 1;\n}";
    const hunks = [{ path: "test.ts", old_str: "return 1;", new_str: "return 2;" }];
    const res = applyPatchHunks(original, hunks);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain("return 2;");
    }
  });

  it("fails loud when old_str is missing or ambiguous", () => {
    const original = "const x = 1;\nconst x = 1;";
    const hunks = [{ path: "test.ts", old_str: "const x = 1;", new_str: "const x = 2;" }];
    const res = applyPatchHunks(original, hunks);
    expect(res.ok).toBe(false);
  });

  it("validates syntax for JSON and TS", () => {
    expect(validateSyntax("test.json", '{"valid": true}').ok).toBe(true);
    expect(validateSyntax("test.json", "{invalid: true}").ok).toBe(false);
    expect(validateSyntax("test.ts", "function a() { return (1 + 2); }").ok).toBe(true);
    expect(validateSyntax("test.ts", "function a() { return (1 + 2; }").ok).toBe(false);
  });

  it("blocks writing to sensitive paths", () => {
    const res = validateWriteSafety(".env", "SECRET=123");
    expect(res.ok).toBe(false);
    expect(res.rejected).toBe(true);
    expect(res.issues[0]?.code).toBe("sensitive_path");
  });

  it("blocks patches that attempt path escaping", () => {
    const res = validatePatchSafety([
      { path: "../outside.ts", old_str: "a", new_str: "b" }
    ], { projectRoot: "/home/project" });
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.code).toBe("path_escape");
  });
});
