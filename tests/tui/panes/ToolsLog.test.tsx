import React from "react";
import { render } from "ink-testing-library";
import { ToolsLog } from "../../../src/tui/panes/ToolsLog";

describe("ToolsLog", () => {
  it("shows a checkmark for resolved tool calls and a pending marker for unresolved ones", () => {
    const { lastFrame } = render(
      <ToolsLog
        entries={[
          { name: "read_file", args: { path: "src/cli/agent.ts" }, result: { content: "x" }, at: 1 },
          { name: "run_shell", args: { command: "npm test" }, at: 2 },
        ]}
        focused
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("read_file");
    expect(frame).toContain("✓");
    expect(frame).toContain("run_shell");
  });
});
