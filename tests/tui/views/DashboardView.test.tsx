import React from "react";
import { App, ShellAgent } from "../../../src/tui/App.js";
import { EventBus } from "../../../src/runtime/events.js";
import { initialRuntimeState, Store } from "../../../src/runtime/store.js";
import { renderWide } from "../wide-render.js";

const NOW = new Date(2026, 0, 1, 10, 42, 11).getTime();

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function makeWorld() {
  const bus = new EventBus();
  const store = new Store(initialRuntimeState({ workspace: "ollama-agent", branch: "main", model: "qwen3:30b" }));
  store.attach(bus);
  const agent: ShellAgent = {
    runUserMessage: jest.fn(async () => "ok"),
  };
  return { bus, store, agent };
}

// ink-testing-library hardcodes its mock stdout.columns to 100, which
// silently corrupts any render wider than that (see tests/tui/wide-render.ts's
// doc comment) — the Dashboard view only activates its real 3-column layout
// at >=130 cols, so it must be rendered through renderWide to get a frame
// that faithfully represents what a real terminal shows.
//
// `seed` runs against the bus/store BEFORE mount — App's store subscription
// is throttled to a real 50ms window (RENDER_THROTTLE_MS), so publishing
// after mount and reading lastFrame() synchronously would race it. Seeding
// pre-mount sidesteps that entirely (matches snapshots.test.tsx's pattern).
function renderApp(columns: number, rows: number, seed?: (world: ReturnType<typeof makeWorld>) => void) {
  const world = makeWorld();
  seed?.(world);
  const r = renderWide(<App bus={world.bus} store={world.store} agent={world.agent} columns={columns} rows={rows} now={NOW} />, columns);
  return { ...world, ...r };
}

let mockTime = NOW;

describe("DashboardView", () => {
  beforeEach(() => {
    mockTime = NOW;
    jest.spyOn(Date, "now").mockImplementation(() => mockTime);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is the default view", () => {
    const { lastFrame, unmount } = renderApp(140, 40);
    const frame = stripAnsi(lastFrame() ?? "");
    // No "─ 15 Dashboard ─" title row anymore — the branded header + panel
    // titles identify the view.
    expect(frame).toContain("MISSION");
    expect(frame).toContain("ACTIVITY FEED");
    unmount();
  });

  it("collapses the Diff Preview section while no diff exists", () => {
    const { lastFrame, unmount } = renderApp(140, 40);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("No changes yet");
    // Collapsed form: title + one content row, sitting at the very bottom of
    // the dashboard (the next frame line is the full-width activity-strip
    // divider, no column dividers on it).
    const lines = frame.split("\n");
    const titleIdx = lines.findIndex((l) => l.includes("DIFF PREVIEW"));
    expect(titleIdx).toBeGreaterThan(-1);
    expect(lines[titleIdx + 1]).toContain("No changes yet");
    expect(lines[titleIdx + 2]).toMatch(/^─+$/);
    unmount();
  });

  it("renders all three columns with inner dividers at >=130 cols", () => {
    const { lastFrame, unmount } = renderApp(140, 40);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("MISSION");
    expect(frame).toContain("TOOLS");
    expect(frame).toContain("ACTIVITY FEED");
    expect(frame).toContain("DIFF PREVIEW");
    expect(frame).toContain("CONTEXT");
    expect(frame).toContain("FILES");
    expect(frame).toContain("DIAGNOSTICS");
    // Inner dividers only — no box borders. Every dashboard content row has
    // exactly the two column dividers.
    expect(frame).not.toContain("╭");
    expect(frame).not.toContain("╰");
    const lines = frame.split("\n");
    const missionIdx = lines.findIndex((l) => l.includes("MISSION"));
    expect((lines[missionIdx].match(/│/g) ?? []).length).toBe(2);
    unmount();
  });

  it("falls back to the plain conversation view below 130 cols", () => {
    const { lastFrame, unmount } = renderApp(100, 30);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Resize to");
    expect(frame).not.toContain("DIFF PREVIEW");
    unmount();
  });

  it("groups tool calls by name with a live count", () => {
    const { lastFrame, unmount } = renderApp(140, 40, ({ bus }) => {
      bus.publish({ type: "tool.started", id: "tc1", name: "read_file", args: {} });
      bus.publish({ type: "tool.completed", id: "tc1", result: {} });
      bus.publish({ type: "tool.started", id: "tc2", name: "read_file", args: {} });
      bus.publish({ type: "tool.completed", id: "tc2", result: {} });
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("read_file");
    expect(frame).toContain("(2)");
    unmount();
  });

  it("pins the most recent diff_preview entry", () => {
    const { lastFrame, unmount } = renderApp(140, 40, ({ bus }) => {
      bus.publish({ type: "conversation.diff", filePath: "Gemfile", diff: "+gem 'devise'", status: "pending_review" });
      bus.publish({
        type: "conversation.diff",
        filePath: "db/migrate/x.rb",
        diff: "+create_table :users",
        status: "pending_review",
      });
    });
    const frame = stripAnsi(lastFrame() ?? "");
    // Both diffs legitimately appear in the Activity Feed's history — only
    // the pinned panel should single out the latest one as its header.
    const diffPreviewLine = frame.split("\n").find((l) => l.includes("db/migrate/x.rb") && !l.includes("Execute"));
    expect(diffPreviewLine).toBeDefined();
    expect(frame).not.toMatch(/DIFF PREVIEW[\s\S]{0,5}Gemfile/);
    unmount();
  });

  it("shows real mission phase progress driven by orchestrator events", () => {
    const { lastFrame, unmount } = renderApp(140, 40, ({ bus }) => {
      bus.publish({ type: "mission.started", goal: "add authentication" });
      bus.publish({ type: "mission.phase", id: "understand", status: "completed" });
      bus.publish({ type: "mission.phase", id: "inspect", status: "completed" });
      bus.publish({ type: "mission.phase", id: "plan", status: "completed" });
      bus.publish({ type: "mission.phase", id: "execute", status: "running" });
      bus.publish({
        type: "mission.step",
        step: { id: "s1", description: "Create User model", status: "completed", dependencies: [], retryCount: 0 },
      });
      bus.publish({
        type: "mission.step",
        step: { id: "s2", description: "Add Devise gem", status: "implementing", dependencies: [], retryCount: 0 },
      });
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("add authentication");
    expect(frame).toContain("Create User model");
    expect(frame).toContain("Add Devise gem");
    unmount();
  });
});
