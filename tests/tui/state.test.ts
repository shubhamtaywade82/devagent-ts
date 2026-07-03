import { reducer, initialState } from "../../src/tui/state";
import { PlanStep } from "../../src/orchestrator/types";

function step(id: string, status: PlanStep["status"] = "pending"): PlanStep {
  return { id, description: `do ${id}`, status, dependencies: [], retryCount: 0 };
}

describe("reducer", () => {
  it("appends assistant text chunks by accumulating into the last assistant entry", () => {
    let state = initialState();
    state = reducer(state, { type: "ASSISTANT_TEXT_CHUNK", chunk: "Hel" });
    state = reducer(state, { type: "ASSISTANT_TEXT_CHUNK", chunk: "lo" });

    expect(state.chat).toEqual([{ role: "assistant", text: "Hello" }]);
  });

  it("starts a new assistant entry after a user message", () => {
    let state = initialState();
    state = reducer(state, { type: "ASSISTANT_TEXT_CHUNK", chunk: "first" });
    state = reducer(state, { type: "USER_MESSAGE", text: "next question" });
    state = reducer(state, { type: "ASSISTANT_TEXT_CHUNK", chunk: "second" });

    expect(state.chat).toEqual([
      { role: "assistant", text: "first" },
      { role: "user", text: "next question" },
      { role: "assistant", text: "second" },
    ]);
  });

  it("records a tool call and later merges its result by matching the most recent unresolved call with that name", () => {
    let state = initialState();
    state = reducer(state, { type: "TOOL_CALLED", name: "read_file", args: { path: "a.ts" } });
    state = reducer(state, { type: "TOOL_RESULT", name: "read_file", result: { content: "x" } });

    expect(state.toolLog).toHaveLength(1);
    expect(state.toolLog[0].result).toEqual({ content: "x" });
  });

  it("tracks files touched by write/patch/delete/move tool calls", () => {
    let state = initialState();
    state = reducer(state, { type: "TOOL_CALLED", name: "write_file", args: { path: "a.ts", content: "x" } });
    state = reducer(state, { type: "TOOL_CALLED", name: "patch_file", args: { path: "b.ts", find: "x", replace: "y" } });
    state = reducer(state, { type: "TOOL_CALLED", name: "read_file", args: { path: "c.ts" } });

    expect(state.filesTouched).toEqual(["a.ts", "b.ts"]);
  });

  it("starts a plan and updates individual step status without disturbing others", () => {
    let state = initialState();
    state = reducer(state, { type: "PLAN_STARTED", steps: [step("s1"), step("s2")] });
    state = reducer(state, { type: "PLAN_STEP_CHANGED", step: step("s1", "completed") });

    expect(state.planSteps).toEqual([step("s1", "completed"), step("s2")]);
  });

  it("appends shell output chunks in order", () => {
    let state = initialState();
    state = reducer(state, { type: "SHELL_OUTPUT_CHUNK", stream: "stdout", chunk: "line1\n" });
    state = reducer(state, { type: "SHELL_OUTPUT_CHUNK", stream: "stdout", chunk: "line2\n" });

    expect(state.shellOutput).toEqual([
      { stream: "stdout", chunk: "line1\n" },
      { stream: "stdout", chunk: "line2\n" },
    ]);
  });

  it("strips ANSI/control escape sequences from shell output chunks while preserving printable text", () => {
    let state = initialState();
    state = reducer(state, {
      type: "SHELL_OUTPUT_CHUNK",
      stream: "stdout",
      chunk: "\x1b[2J\x1b[Hnormal output\n",
    });

    expect(state.shellOutput).toEqual([{ stream: "stdout", chunk: "normal output\n" }]);
  });

  it("updates memory summary and focused pane", () => {
    let state = initialState();
    state = reducer(state, { type: "MEMORY_SUMMARY_UPDATED", summary: "- did X" });
    state = reducer(state, { type: "FOCUS_PANE", pane: "terminal" });

    expect(state.memorySummary).toBe("- did X");
    expect(state.focusedPane).toBe("terminal");
  });

  it("records errors", () => {
    let state = initialState();
    state = reducer(state, { type: "ERROR", message: "boom" });

    expect(state.lastError).toBe("boom");
  });
});
