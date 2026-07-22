import { PlanStep } from "../../src/orchestrator/types.js";
import { createMissionState, deriveMissionPhases } from "../../src/runtime/mission-derive.js";

function step(overrides: Partial<PlanStep>): PlanStep {
  return { id: "s1", description: "step", status: "pending", dependencies: [], retryCount: 0, ...overrides };
}

describe("createMissionState", () => {
  it("starts every phase pending with no steps", () => {
    const mission = createMissionState("build auth");
    expect(mission.goal).toBe("build auth");
    expect(mission.steps).toEqual([]);
    expect(mission.phases.every((p) => p.status === "pending")).toBe(true);
    expect(mission.phases.map((p) => p.id)).toEqual([
      "understand",
      "inspect",
      "plan",
      "execute",
      "validate",
      "repair",
      "review",
      "complete",
    ]);
  });
});

describe("deriveMissionPhases", () => {
  it("marks validate/review/repair pending while execute has not started", () => {
    const mission = createMissionState("x");
    const phases = deriveMissionPhases(mission.phases, []);
    expect(phases.find((p) => p.id === "validate")!.status).toBe("pending");
    expect(phases.find((p) => p.id === "review")!.status).toBe("pending");
    expect(phases.find((p) => p.id === "repair")!.status).toBe("pending");
  });

  it("marks validate running while any step is testing", () => {
    const mission = createMissionState("x");
    const phases = deriveMissionPhases(mission.phases, [step({ status: "testing" })]);
    expect(phases.find((p) => p.id === "validate")!.status).toBe("running");
  });

  it("marks review running while any step is reviewing", () => {
    const mission = createMissionState("x");
    const phases = deriveMissionPhases(mission.phases, [step({ status: "reviewing" })]);
    expect(phases.find((p) => p.id === "review")!.status).toBe("running");
  });

  it("marks repair running while a retried step is back in flight", () => {
    const mission = createMissionState("x");
    const phases = deriveMissionPhases(mission.phases, [step({ status: "implementing", retryCount: 1 })]);
    expect(phases.find((p) => p.id === "repair")!.status).toBe("running");
  });

  it("marks validate/review completed once execute finishes", () => {
    let mission = createMissionState("x");
    mission = { ...mission, phases: mission.phases.map((p) => (p.id === "execute" ? { ...p, status: "completed" } : p)) };
    const phases = deriveMissionPhases(mission.phases, [step({ status: "completed" })]);
    expect(phases.find((p) => p.id === "validate")!.status).toBe("completed");
    expect(phases.find((p) => p.id === "review")!.status).toBe("completed");
  });

  it("marks repair completed once execute finishes after a retry occurred", () => {
    let mission = createMissionState("x");
    mission = { ...mission, phases: mission.phases.map((p) => (p.id === "execute" ? { ...p, status: "completed" } : p)) };
    const phases = deriveMissionPhases(mission.phases, [step({ status: "completed", retryCount: 2 })]);
    expect(phases.find((p) => p.id === "repair")!.status).toBe("completed");
  });

  it("leaves plan/execute/complete untouched — those are event-driven, not derived", () => {
    const mission = createMissionState("x");
    const phases = deriveMissionPhases(mission.phases, [step({ status: "testing" })]);
    expect(phases.find((p) => p.id === "plan")!.status).toBe("pending");
    expect(phases.find((p) => p.id === "execute")!.status).toBe("pending");
    expect(phases.find((p) => p.id === "complete")!.status).toBe("pending");
  });
});
