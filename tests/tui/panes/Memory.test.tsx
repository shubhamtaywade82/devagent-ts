import React from "react";
import { render } from "ink-testing-library";
import { Memory } from "../../../src/tui/panes/Memory";

describe("Memory", () => {
  it("renders the summary and files-touched list", () => {
    const { lastFrame } = render(<Memory summary={"- Added CommandRegistry"} filesTouched={["src/core/CommandRegistry.ts"]} />);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Added CommandRegistry");
    expect(frame).toContain("src/core/CommandRegistry.ts");
  });

  it("shows a placeholder when there is no summary yet", () => {
    const { lastFrame } = render(<Memory summary={""} filesTouched={[]} />);

    expect(lastFrame()).toContain("No summary yet");
  });
});
