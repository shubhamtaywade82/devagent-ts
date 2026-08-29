import { filterPickerItems, visibleWindow } from "../../src/interaction/picker.js";

const items = [
  { id: "1", label: "Filesystem", detail: "MCP server" },
  { id: "2", label: "Docker", detail: "MCP server" },
  { id: "3", label: "Docker Compose", detail: "tool" },
  { id: "4", label: "Git", detail: "vcs" },
];

describe("filterPickerItems", () => {
  it("returns everything for an empty query", () => {
    expect(filterPickerItems(items, "")).toHaveLength(4);
  });

  it("matches case-insensitively on label and detail", () => {
    expect(filterPickerItems(items, "docker").map((i) => i.id)).toEqual(["2", "3"]);
    expect(filterPickerItems(items, "MCP").map((i) => i.id)).toEqual(["1", "2"]);
  });

  it("requires every term to match", () => {
    expect(filterPickerItems(items, "docker tool").map((i) => i.id)).toEqual(["3"]);
    expect(filterPickerItems(items, "docker zzz")).toEqual([]);
  });
});

describe("visibleWindow", () => {
  const list = ["a", "b", "c", "d", "e"];

  it("shows from the start when the index fits", () => {
    expect(visibleWindow(list, 0, 3)).toEqual({ start: 0, items: ["a", "b", "c"] });
    expect(visibleWindow(list, 2, 3)).toEqual({ start: 0, items: ["a", "b", "c"] });
  });

  it("scrolls to keep the highlighted item visible", () => {
    expect(visibleWindow(list, 4, 3)).toEqual({ start: 2, items: ["c", "d", "e"] });
    expect(visibleWindow(list, 3, 3)).toEqual({ start: 1, items: ["b", "c", "d"] });
  });

  it("handles empty lists and zero sizes", () => {
    expect(visibleWindow([], 0, 3)).toEqual({ start: 0, items: [] });
    expect(visibleWindow(list, 1, 0)).toEqual({ start: 0, items: [] });
  });
});

// The model switcher's `detail` carries live availability text that updates as
// background checks land. Letting that drive the filter meant the visible list
// could shrink between render and keypress while the picker held a fixed
// numeric index -- so Enter selected a different row than the highlighted one.
describe("filterPickerItems filterText override", () => {
  it("matches filterText instead of label + detail when provided", () => {
    const items = [
      { id: "a", label: "qwen3:8b", detail: "current · code/tools", filterText: "qwen3:8b" },
      { id: "b", label: "llama3:70b", detail: "🔒 Subscription · code", filterText: "llama3:70b" },
    ];

    // "code" appears in both details but neither name.
    expect(filterPickerItems(items, "code")).toEqual([]);
    expect(filterPickerItems(items, "llama").map((i) => i.id)).toEqual(["b"]);
  });

  it("still falls back to label + detail when filterText is absent", () => {
    const items = [{ id: "a", label: "run tests", detail: "execute the suite" }];
    expect(filterPickerItems(items, "execute").map((i) => i.id)).toEqual(["a"]);
  });
});
