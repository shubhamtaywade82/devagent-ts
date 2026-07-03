import React from "react";
import { render } from "ink-testing-library";
import { App } from "../../src/tui/App";

function fakeAgent() {
  const handlers = new Map<string, ((...args: any[]) => void)[]>();
  const agent = {
    on: (event: string, handler: (...args: any[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return agent;
    },
    runUserMessage: jest.fn().mockResolvedValue("ok"),
    getRegistry: () => ({ schemas: () => [] }),
  };
  return agent;
}

describe("App", () => {
  it("renders all panes on mount", () => {
    const { lastFrame, unmount } = render(
      <App agent={fakeAgent() as any} workspaceRoot="/tmp" model="llama3.1:70b" />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("PROJECT");
    expect(frame).toContain("CHAT / PLAN");
    expect(frame).toContain("TERMINAL");
    expect(frame).toContain("TOOLS");
    expect(frame).toContain("MEMORY");
    unmount();
  });
});
