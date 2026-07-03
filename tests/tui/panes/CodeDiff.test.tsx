import React from "react";
import { render } from "ink-testing-library";
import { CodeDiff } from "../../../src/tui/panes/CodeDiff";

describe("CodeDiff", () => {
  it("renders plain file content when there is no diff", () => {
    const { lastFrame } = render(
      <CodeDiff path="a.ts" content={"const x = 1;"} diffLines={null} focused />,
    );

    expect(lastFrame()).toContain("a.ts");
    expect(lastFrame()).toContain("const x = 1;");
  });

  it("renders a +N -M header and prefixed lines in diff mode", () => {
    const { lastFrame } = render(
      <CodeDiff
        path="a.ts"
        content=""
        diffLines={[
          { type: "context", text: "const x = 1;\n" },
          { type: "remove", text: "const y = 2;\n" },
          { type: "add", text: "const y = 3;\n" },
        ]}
        focused
      />,
    );

    expect(lastFrame()).toContain("+1");
    expect(lastFrame()).toContain("-1");
    expect(lastFrame()).toContain("const y = 2;");
    expect(lastFrame()).toContain("const y = 3;");
  });

  it("shows a placeholder when no file is selected", () => {
    const { lastFrame } = render(<CodeDiff path={null} content="" diffLines={null} focused={false} />);

    expect(lastFrame()).toContain("No file selected");
  });
});
