import { layoutPhase, railsForPhase, LayoutPhase } from "../../src/layout/rails.js";
import { initialRuntimeState, reduce } from "../../src/runtime/store.js";
import { MissionPhaseId, RuntimeState } from "../../src/runtime/types.js";

function fresh(): RuntimeState {
  return initialRuntimeState({ workspace: "devagent", branch: "main", model: "qwen3:30b" });
}

function withPhase(id: MissionPhaseId): RuntimeState {
  let s = fresh();
  s = reduce(s, { type: "mission.started", goal: "Add auth" });
  s = reduce(s, { type: "mission.phase", id, status: "running" });
  return s;
}

describe("layoutPhase", () => {
  it("is idle without a running mission phase", () => {
    expect(layoutPhase(fresh())).toBe("idle");
  });

  it.each<[MissionPhaseId, LayoutPhase]>([
    ["understand", "planning"],
    ["inspect", "planning"],
    ["plan", "planning"],
    ["execute", "coding"],
    ["validate", "validating"],
    ["review", "reviewing"],
    ["repair", "repairing"],
    ["complete", "idle"],
  ])("maps running mission phase %s to %s", (id, expected) => {
    expect(layoutPhase(withPhase(id))).toBe(expected);
  });

  it("falls back to agent mode when no mission is running", () => {
    let s = fresh();
    s = reduce(s, { type: "mode.agent", mode: "debug" });
    expect(layoutPhase(s)).toBe("repairing");
    s = reduce(s, { type: "mode.agent", mode: "review" });
    expect(layoutPhase(s)).toBe("reviewing");
  });

  it("lets a live mission win over agent mode", () => {
    let s = withPhase("execute");
    s = reduce(s, { type: "mode.agent", mode: "debug" });
    expect(layoutPhase(s)).toBe("coding");
  });
});

describe("railsForPhase", () => {
  it.each<[LayoutPhase, ReturnType<typeof railsForPhase>]>([
    ["idle", { left: null, right: null }],
    ["planning", { left: "mission", right: null }],
    ["coding", { left: "mission", right: "files" }],
    ["validating", { left: "mission", right: "diagnostics" }],
    ["reviewing", { left: null, right: "diff" }],
    ["repairing", { left: null, right: "diagnostics" }],
  ])("%s rails", (phase, expected) => {
    expect(railsForPhase(phase)).toEqual(expected);
  });
});

describe("mission walkthrough", () => {
  it("produces the expected rail sequence across a full mission", () => {
    let s = fresh();
    const seen: LayoutPhase[] = [];
    const record = () => seen.push(layoutPhase(s));

    s = reduce(s, { type: "mission.started", goal: "Add auth" });
    record(); // idle — nothing running yet
    for (const id of ["understand", "inspect", "plan", "execute"] as const) {
      s = reduce(s, { type: "mission.phase", id, status: "running" });
      record();
      s = reduce(s, { type: "mission.phase", id, status: "completed" });
    }
    s = reduce(s, { type: "mission.phase", id: "complete", status: "completed" });
    record(); // done — back to idle

    expect(seen).toEqual(["idle", "planning", "planning", "planning", "coding", "idle"]);
  });
});
