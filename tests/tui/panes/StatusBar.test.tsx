import React from "react";
import { render } from "ink-testing-library";
import { StatusBar } from "../../../src/tui/panes/StatusBar";

describe("StatusBar", () => {
  it("renders focused pane, model, files-changed count, and status", () => {
    const { lastFrame } = render(
      <StatusBar focusedPane="chat" model="llama3.1:70b" filesTouchedCount={3} status="turn 2" />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("chat");
    expect(frame).toContain("llama3.1:70b");
    expect(frame).toContain("3");
    expect(frame).toContain("turn 2");
  });
});
