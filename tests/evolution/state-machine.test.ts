import {
  EvolutionStateMachine,
  InvalidTransitionError,
  PROGRESS_STATES,
  isTerminalFailure,
  isActive,
  stateFromLegacyStatus,
} from "../../src/evolution/state-machine.js";

describe("EvolutionStateMachine", () => {
  it("traverses the full happy path from OBSERVED to ACTIVE", () => {
    const m = new EvolutionStateMachine("OBSERVED");
    for (const next of PROGRESS_STATES.slice(1)) {
      expect(m.canTransition(next)).toBe(true);
      const res = m.transition(next, `advancing to ${next}`);
      expect(res.ok).toBe(true);
    }
    expect(m.current()).toBe("ACTIVE");
    expect(m.isAccepted()).toBe(true);
    expect(m.transitions()).toHaveLength(PROGRESS_STATES.length - 1);
  });

  it("enforces the explicit failure path EVALUATING → REJECTED", () => {
    const m = new EvolutionStateMachine("EVALUATING");
    expect(m.canTransition("REJECTED")).toBe(true);
    m.transition("REJECTED");
    expect(m.current()).toBe("REJECTED");
    expect(isTerminalFailure("REJECTED")).toBe(true);
    // REJECTED is terminal: no transitions out.
    expect(m.nextStates()).toEqual([]);
    expect(m.canTransition("CANDIDATE")).toBe(false);
  });

  it("enforces the explicit failure path GENERALIZED → REJECTED", () => {
    const m = new EvolutionStateMachine("GENERALIZED");
    expect(m.canTransition("REJECTED")).toBe(true);
    expect(m.canTransition("ELIGIBLE")).toBe(true);
  });

  it("enforces DELIVERED → CI_FAILED and its recovery path back to CANDIDATE", () => {
    const m = new EvolutionStateMachine("DELIVERED");
    m.transition("CI_FAILED", "ci red");
    expect(m.current()).toBe("CI_FAILED");
    // CI_FAILED is not terminal — the loop repairs and re-enters.
    expect(isTerminalFailure("CI_FAILED")).toBe(false);
    m.transition("CANDIDATE", "rework");
    expect(m.current()).toBe("CANDIDATE");
  });

  it("enforces REVIEWED → CHANGES_REQUESTED with recovery to CANDIDATE", () => {
    const m = new EvolutionStateMachine("REVIEWED");
    m.transition("CHANGES_REQUESTED");
    expect(m.current()).toBe("CHANGES_REQUESTED");
    m.transition("CANDIDATE");
    expect(m.current()).toBe("CANDIDATE");
  });

  it("enforces ACTIVE → REGRESSED → ROLLBACK → ACTIVE (prior)", () => {
    const m = new EvolutionStateMachine("ACTIVE");
    m.transition("REGRESSED", "post-deployment regression detected");
    expect(m.current()).toBe("REGRESSED");
    m.transition("ROLLBACK", "rolling back to prior harness");
    expect(m.current()).toBe("ROLLBACK");
    m.transition("ACTIVE", "rollback completed onto prior harness");
    expect(isActive(m.current())).toBe(true);
  });

  it("rejects skipping stages (no declared promotion)", () => {
    const m = new EvolutionStateMachine("CANDIDATE");
    expect(m.canTransition("ACTIVE")).toBe(false);
    expect(m.canTransition("ELIGIBLE")).toBe(false);
    // The v1 "promote in one call" path is structurally impossible now.
    expect(() => m.transition("ACTIVE")).toThrow(InvalidTransitionError);
  });

  it("lax mode records failed transitions instead of throwing", () => {
    const m = new EvolutionStateMachine("OBSERVED", { strict: false });
    const res = m.transition("ACTIVE");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("not legal");
    expect(m.current()).toBe("OBSERVED");
    expect(m.transitions()).toHaveLength(0);
  });

  it("serializes the audit timeline for provenance", () => {
    const m = new EvolutionStateMachine("OBSERVED");
    m.transition("DIAGNOSED", "d1");
    m.transition("TARGETED", "t1");
    const timeline = m.toTimeline();
    expect(timeline.map((t) => t.state)).toEqual(["DIAGNOSED", "TARGETED"]);
    expect(timeline[0].note).toBe("d1");
  });

  it("maps legacy version statuses onto v2 states", () => {
    expect(stateFromLegacyStatus("candidate")).toBe("CANDIDATE");
    expect(stateFromLegacyStatus("validated")).toBe("VALIDATED");
    expect(stateFromLegacyStatus("promoted")).toBe("ACTIVE");
    expect(stateFromLegacyStatus("rejected")).toBe("REJECTED");
    expect(stateFromLegacyStatus("rolled_back")).toBe("ROLLBACK");
  });
});
