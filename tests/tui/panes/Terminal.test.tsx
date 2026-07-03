import React from "react";
import { render } from "ink-testing-library";
import { Terminal } from "../../../src/tui/panes/Terminal";

describe("Terminal", () => {
  it("renders accumulated stdout/stderr chunks in order", () => {
    const { lastFrame } = render(
      <Terminal
        output={[
          { stream: "stdout", chunk: "$ npm test\n" },
          { stream: "stdout", chunk: "PASS tests/a.test.ts\n" },
          { stream: "stderr", chunk: "warning: deprecated flag\n" },
        ]}
        focused
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("$ npm test");
    expect(frame).toContain("PASS tests/a.test.ts");
    expect(frame).toContain("warning: deprecated flag");
    expect(frame.indexOf("npm test")).toBeLessThan(frame.indexOf("warning: deprecated"));
  });
});
