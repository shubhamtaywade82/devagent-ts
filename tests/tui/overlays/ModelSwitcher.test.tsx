import React from "react";
import { render } from "ink-testing-library";
import { ModelSwitcher } from "../../../src/tui/overlays/ModelSwitcher.js";

describe("ModelSwitcher", () => {
  it("tags a known subscription-gated model before selection", () => {
    const { lastFrame, unmount } = render(
      <ModelSwitcher
        current="qwen3:30b"
        models={["qwen3:30b", "minimax-m2.7"]}
        availability={{ "minimax-m2.7": false }}
        width={80}
        rows={20}
        active={true}
        onSelect={() => {}}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("minimax-m2.7");
    expect(frame).toContain("🔒 Subscription");
    unmount();
  });

  it("shows Untested for models the availability check hasn't reached yet", () => {
    const { lastFrame, unmount } = render(
      <ModelSwitcher
        current="qwen3:30b"
        models={["qwen3:30b", "qwen3:8b"]}
        availability={{ "qwen3:8b": true }}
        width={80}
        rows={20}
        active={true}
        onSelect={() => {}}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("Subscription");
    expect(frame).toContain("current");
    expect(frame).toContain("Free");
    unmount();
  });

  it("shows capability tags alongside the availability status", () => {
    const { lastFrame, unmount } = render(
      <ModelSwitcher
        current="qwen3:30b"
        models={["qwen3:30b", "qwen2.5-coder:32b"]}
        availability={{ "qwen2.5-coder:32b": true }}
        capabilities={{ "qwen2.5-coder:32b": ["coding", "tools"] }}
        width={80}
        rows={20}
        active={true}
        onSelect={() => {}}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Free · code/tools");
    unmount();
  });
});
