import React from "react";
import { render } from "ink-testing-library";
import { ExecutionDagOverlay } from "../../../src/tui/overlays/ExecutionDagOverlay.js";

describe("ExecutionDagOverlay", () => {
  it("renders execution DAG node titles and statuses", () => {
    const nodes = [
      {
        id: "n1",
        kind: "intent" as const,
        title: "Intent Analysis",
        status: "completed" as const,
        startTime: Date.now(),
        durationMs: 50,
      },
    ];

    const { lastFrame, unmount } = render(
      <ExecutionDagOverlay nodes={nodes} width={80} rows={20} active={true} onClose={() => {}} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Execution DAG Trace");
    expect(frame).toContain("Intent Analysis");
    expect(frame).toContain("50ms");
    unmount();
  });
});
