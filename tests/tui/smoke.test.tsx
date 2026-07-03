import React from "react";
import { render } from "ink-testing-library";
import { Smoke } from "../../src/tui/Smoke";

describe("Smoke", () => {
  it("renders the OK marker", () => {
    const { lastFrame } = render(<Smoke />);
    expect(lastFrame()).toContain("DevAgent TUI OK");
  });
});
