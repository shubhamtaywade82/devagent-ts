import { buildExecutionCases } from "../../src/benchmark/cases-execution.js";
import { AgenticTrajectory } from "../../src/benchmark/types.js";

function trajectory(overrides: Partial<AgenticTrajectory> = {}): AgenticTrajectory {
  return { finalContent: "", toolCallsMade: [], turns: 1, hitMaxTurns: false, ...overrides };
}

describe("buildExecutionCases", () => {
  it("execution-real-read-file's resolveTool reads the real seeded file via the real ReadFileTool", async () => {
    const [readCase] = await buildExecutionCases();
    expect(readCase.id).toBe("execution-real-read-file");

    const result = await readCase.resolveTool("read_file", { path: "notes.txt" });

    expect(String(result.content)).toContain("4471");
  });

  it("execution-real-search-code's resolveTool finds the real seeded TODO via ripgrep", async () => {
    const [, searchCase] = await buildExecutionCases();
    expect(searchCase.id).toBe("execution-real-search-code");

    const result = await searchCase.resolveTool("search_code", { query: "TODO" });

    const matches = result.matches as Array<{ text: string }>;
    expect(matches.some((m) => /auth/i.test(m.text))).toBe(true);
  });

  it("each call gets its own independent temp workspace", async () => {
    const [readCaseA] = await buildExecutionCases();
    const [readCaseB] = await buildExecutionCases();

    const a = await readCaseA.resolveTool("read_file", { path: "notes.txt" });
    const b = await readCaseB.resolveTool("read_file", { path: "notes.txt" });

    // Both point at the seeded content, but at genuinely different roots.
    expect(a.content).toEqual(b.content);
  });

  describe("execution-real-read-file validate", () => {
    it("passes when read_file was called and the secret code is in the final answer", async () => {
      const [readCase] = await buildExecutionCases();
      const result = readCase.validate(
        trajectory({
          toolCallsMade: [{ name: "read_file", args: { path: "notes.txt" }, result: {} }],
          finalContent: "The secret code is 4471.",
        }),
      );
      expect(result.pass).toBe(true);
    });

    it("fails when read_file was never called", async () => {
      const [readCase] = await buildExecutionCases();
      const result = readCase.validate(trajectory({ finalContent: "4471" }));
      expect(result.pass).toBe(false);
      expect(result.reason).toMatch(/never called read_file/);
    });
  });

  describe("execution-real-search-code validate", () => {
    it("passes when search_code was called and the answer mentions auth", async () => {
      const [, searchCase] = await buildExecutionCases();
      const result = searchCase.validate(
        trajectory({
          toolCallsMade: [{ name: "search_code", args: { query: "TODO" }, result: {} }],
          finalContent: "The first TODO is about the auth token refresh race condition.",
        }),
      );
      expect(result.pass).toBe(true);
    });

    it("fails when the answer doesn't mention what the TODO is about", async () => {
      const [, searchCase] = await buildExecutionCases();
      const result = searchCase.validate(
        trajectory({
          toolCallsMade: [{ name: "search_code", args: { query: "TODO" }, result: {} }],
          finalContent: "I found a TODO comment.",
        }),
      );
      expect(result.pass).toBe(false);
    });
  });
});
