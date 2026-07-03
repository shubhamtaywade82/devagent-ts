import React from "react";
import { render } from "ink-testing-library";
import { ChatPlan } from "../../../src/tui/panes/ChatPlan";
import { PlanStep } from "../../../src/orchestrator/types";

describe("ChatPlan", () => {
  it("renders chat transcript when there is no active plan", () => {
    const { lastFrame } = render(
      <ChatPlan chat={[{ role: "user", text: "hello" }, { role: "assistant", text: "hi there" }]} planSteps={null} focused />,
    );

    expect(lastFrame()).toContain("hello");
    expect(lastFrame()).toContain("hi there");
  });

  it("renders a checklist with completed steps marked when a plan is active", () => {
    const steps: PlanStep[] = [
      { id: "s1", description: "create types.ts", status: "completed", dependencies: [], retryCount: 0 },
      { id: "s2", description: "create registry", status: "running", dependencies: ["s1"], retryCount: 0 },
    ];

    const { lastFrame } = render(<ChatPlan chat={[]} planSteps={steps} focused />);

    expect(lastFrame()).toContain("[x]");
    expect(lastFrame()).toContain("create types.ts");
    expect(lastFrame()).toContain("[ ]");
    expect(lastFrame()).toContain("create registry");
  });
});
