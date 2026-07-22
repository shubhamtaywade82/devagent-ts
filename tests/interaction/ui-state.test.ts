import { initialUiState, uiReduce } from "../../src/interaction/ui-state.js";

describe("uiReduce", () => {
  it("starts on the dashboard view with no overlay", () => {
    expect(initialUiState()).toEqual({
      activeView: "dashboard",
      overlay: null,
      zoom: false,
      sidebarVisible: true,
    });
  });

  it("cycles views forward and backward with wrap-around", () => {
    // Anchored to "conversation" via focus-view rather than relying on
    // initialUiState()'s default, so this test doesn't need to change every
    // time the default view does.
    let s = uiReduce(initialUiState(), { type: "focus-view", view: "conversation" });
    s = uiReduce(s, { type: "next-view" });
    expect(s.activeView).toBe("execution");
    s = uiReduce(s, { type: "prev-view" });
    s = uiReduce(s, { type: "prev-view" });
    expect(s.activeView).toBe("dashboard"); // wraps to the last view in VIEW_ORDER
    s = uiReduce(s, { type: "next-view" });
    expect(s.activeView).toBe("conversation");
  });

  it("opens and closes overlays without touching the active view", () => {
    let s = uiReduce(initialUiState(), { type: "focus-view", view: "git" });
    s = uiReduce(s, { type: "open-overlay", overlay: "palette" });
    expect(s).toMatchObject({ activeView: "git", overlay: "palette" });
    s = uiReduce(s, { type: "close-overlay" });
    expect(s.overlay).toBeNull();
    expect(s.activeView).toBe("git");
  });

  it("toggles zoom", () => {
    let s = uiReduce(initialUiState(), { type: "toggle-zoom" });
    expect(s.zoom).toBe(true);
    s = uiReduce(s, { type: "toggle-zoom" });
    expect(s.zoom).toBe(false);
  });

  it("view-diff opens the diff overlay", () => {
    expect(uiReduce(initialUiState(), { type: "view-diff" }).overlay).toBe("diff");
  });

  it("open-overlay accepts skills and close-overlay clears it", () => {
    let s = uiReduce(initialUiState(), { type: "open-overlay", overlay: "skills" });
    expect(s.overlay).toBe("skills");
    s = uiReduce(s, { type: "close-overlay" });
    expect(s.overlay).toBeNull();
  });
});
