/**
 * Evolution Lifecycle State Machine for Nexum Harness Self-Development.
 *
 * Replaces the old "declared promotion" model (evaluate → promote in one call)
 * with an explicit scientific lifecycle. A candidate mutation must traverse
 * every stage before it becomes the active harness:
 *
 *   OBSERVED → DIAGNOSED → TARGETED → HYPOTHESIS → CANDIDATE → EVALUATING →
 *   VALIDATED → GENERALIZED → ELIGIBLE → DELIVERED → CI_PENDING → CI_PASSED →
 *   REVIEW_PENDING → APPROVED → ACCEPTED → ACTIVE
 *
 * CI and review are FIRST-CLASS lifecycle states, not overloads of DELIVERED
 * / REVIEWED: a passing CI run has its own explicit transition (CI_PASSED),
 * and so does an approval (APPROVED). External feedback can no longer be
 * silently dropped by the lifecycle.
 *
 * Failure paths:
 *   EVALUATING     ──→ REJECTED
 *   GENERALIZED    ──→ REJECTED
 *   CI_PENDING     ──→ CI_FAILED
 *   REVIEW_PENDING ──→ CHANGES_REQUESTED
 *   ACTIVE         ──→ REGRESSED ──→ ROLLBACK
 *
 * The state machine is pure: it validates transitions and records an audit
 * trail; persistence lives in the registry / experiment controller.
 */

/** Progressive lifecycle states a mutation traverses on the happy path. */
export type EvolutionProgressState =
  | "OBSERVED"
  | "DIAGNOSED"
  | "TARGETED"
  | "HYPOTHESIS"
  | "CANDIDATE"
  | "EVALUATING"
  | "VALIDATED"
  | "GENERALIZED"
  | "ELIGIBLE"
  | "DELIVERED"
  | "CI_PENDING"
  | "CI_PASSED"
  | "REVIEW_PENDING"
  | "APPROVED"
  | "ACCEPTED"
  | "ACTIVE";

/**
 * Legacy v2.0 state name kept ONLY for deserializing persisted records and
 * provenance produced before CI/review became explicit states.
 * `normalizeLegacyState` maps it onto the v2.1 lifecycle.
 */
export type EvolutionLegacyState = "REVIEWED";

/** Terminal failure states. A REJECTED/CI_FAILED/CHANGES_REQUESTED candidate is dead. */
export type EvolutionFailureState = "REJECTED" | "CI_FAILED" | "CHANGES_REQUESTED" | "REGRESSED" | "ROLLBACK";

export type EvolutionState = EvolutionProgressState | EvolutionFailureState;

export const PROGRESS_STATES: readonly EvolutionProgressState[] = [
  "OBSERVED",
  "DIAGNOSED",
  "TARGETED",
  "HYPOTHESIS",
  "CANDIDATE",
  "EVALUATING",
  "VALIDATED",
  "GENERALIZED",
  "ELIGIBLE",
  "DELIVERED",
  "CI_PENDING",
  "CI_PASSED",
  "REVIEW_PENDING",
  "APPROVED",
  "ACCEPTED",
  "ACTIVE",
] as const;

/** Maps pre-v2.1 persisted state names onto the current lifecycle. */
export function normalizeLegacyState(state: string): EvolutionState | null {
  if (state === "REVIEWED") return "REVIEW_PENDING";
  return (PROGRESS_STATES as readonly string[]).includes(state) || (FAILURE_STATES as readonly string[]).includes(state)
    ? (state as EvolutionState)
    : null;
}

export const FAILURE_STATES: readonly EvolutionFailureState[] = [
  "REJECTED",
  "CI_FAILED",
  "CHANGES_REQUESTED",
  "REGRESSED",
  "ROLLBACK",
] as const;

/** Ordered index of happy-path states used for forward transition validation. */
const PROGRESS_INDEX: ReadonlyMap<EvolutionProgressState, number> = new Map(PROGRESS_STATES.map((s, i) => [s, i]));

/**
 * Legal transitions, including the explicit failure paths from the
 * closed-loop RSI methodology:
 *
 *   EVALUATING  → REJECTED            (statistical / execution validity failed)
 *   GENERALIZED → REJECTED            (held-out / transfer generalization failed)
 *   DELIVERED   → CI_FAILED           (GitHub CI on the evolution branch failed)
 *   REVIEWED    → CHANGES_REQUESTED   (human review asked for changes)
 *   ACTIVE      → REGRESSED           (post-deployment regression monitoring)
 *   REGRESSED   → ROLLBACK            (rollback to prior active harness)
 *
 * RECOVERY paths (resilience of the loop):
 *   CI_FAILED / CHANGES_REQUESTED → CANDIDATE  (re-enter the loop after rework)
 *   ROLLBACK → ACTIVE                          (rollback completes onto prior harness)
 */
const LEGAL_TRANSITIONS: Readonly<Record<EvolutionState, readonly EvolutionState[]>> = {
  OBSERVED: ["DIAGNOSED"],
  DIAGNOSED: ["TARGETED"],
  TARGETED: ["HYPOTHESIS"],
  HYPOTHESIS: ["CANDIDATE"],
  CANDIDATE: ["EVALUATING"],
  EVALUATING: ["VALIDATED", "REJECTED"],
  VALIDATED: ["GENERALIZED"],
  GENERALIZED: ["ELIGIBLE", "REJECTED"],
  ELIGIBLE: ["DELIVERED"],
  DELIVERED: ["CI_PENDING"],
  CI_PENDING: ["CI_PASSED", "CI_FAILED"],
  CI_PASSED: ["REVIEW_PENDING"],
  REVIEW_PENDING: ["APPROVED", "CHANGES_REQUESTED"],
  APPROVED: ["ACCEPTED"],
  ACCEPTED: ["ACTIVE"],
  ACTIVE: ["REGRESSED"],
  REJECTED: [],
  CI_FAILED: ["CANDIDATE"],
  CHANGES_REQUESTED: ["CANDIDATE"],
  REGRESSED: ["ROLLBACK"],
  ROLLBACK: ["ACTIVE"],
};

/** States from which no further transitions are possible. */
export function isTerminalFailure(state: EvolutionState): boolean {
  return state === "REJECTED";
}

/** True when the candidate has fully landed as the running harness. */
export function isActive(state: EvolutionState): boolean {
  return state === "ACTIVE";
}

/** True once the delivered branch has passed CI (explicit CI_PASSED state). */
export function isCiPassed(state: EvolutionState): boolean {
  return (
    state === "CI_PASSED" ||
    state === "REVIEW_PENDING" ||
    state === "APPROVED" ||
    state === "ACCEPTED" ||
    state === "ACTIVE"
  );
}

/** True once a reviewer has approved (explicit APPROVED state). */
export function isApproved(state: EvolutionState): boolean {
  return state === "APPROVED" || state === "ACCEPTED" || state === "ACTIVE";
}

/** True when the state sits on the happy path (not a failure state). */
export function isProgressState(state: EvolutionState): state is EvolutionProgressState {
  return PROGRESS_INDEX.has(state as EvolutionProgressState);
}

export interface StateTransition {
  from: EvolutionState;
  to: EvolutionState;
  at: number;
  /** Free-form rationale, actor, or evidence pointer recorded with the transition. */
  note?: string;
}

export interface StateTransitionResult {
  ok: boolean;
  from: EvolutionState;
  to: EvolutionState;
  reason?: string;
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: EvolutionState,
    public readonly to: EvolutionState,
  ) {
    super(`Illegal evolution state transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * Tracks the lifecycle of a single candidate mutation.
 * Strict mode throws on illegal transitions; lax mode records the failure.
 */
export class EvolutionStateMachine {
  private state: EvolutionState;
  private readonly history: StateTransition[] = [];
  private readonly strict: boolean;

  constructor(initial: EvolutionState = "OBSERVED", opts: { strict?: boolean } = {}) {
    this.state = initial;
    this.strict = opts.strict ?? true;
  }

  current(): EvolutionState {
    return this.state;
  }

  /** Full ordered audit trail of the candidate's lifecycle. */
  transitions(): readonly StateTransition[] {
    return this.history;
  }

  /** Returns the legal next states from the current state. */
  nextStates(): readonly EvolutionState[] {
    return LEGAL_TRANSITIONS[this.state];
  }

  canTransition(to: EvolutionState): boolean {
    return this.nextStates().includes(to);
  }

  /**
   * Attempts a transition. Returns `{ ok: true }` and records it on success.
   * In strict mode throws `InvalidTransitionError` on illegal moves; in lax
   * mode returns `{ ok: false, reason }` so callers can decide policy.
   */
  transition(to: EvolutionState, note?: string): StateTransitionResult {
    if (!this.canTransition(to)) {
      const reason = `Transition ${this.state} → ${to} is not legal. Legal next: [${this.nextStates().join(", ")}]`;
      if (this.strict) throw new InvalidTransitionError(this.state, to);
      return { ok: false, from: this.state, to, reason };
    }
    const from = this.state;
    this.state = to;
    this.history.push({ from, to, at: Date.now(), note });
    return { ok: true, from, to };
  }

  /** Convenience guards used by the engine / controller wiring. */
  isFailed(): boolean {
    return FAILURE_STATES.includes(this.state as EvolutionFailureState);
  }

  isAccepted(): boolean {
    return isActive(this.state);
  }

  /**
   * Serializes the lifecycle for persistence in experiment provenance and
   * GitHub PR bodies.
   */
  toTimeline(): Array<{ state: EvolutionState; at: number; note?: string }> {
    const timeline: Array<{ state: EvolutionState; at: number; note?: string }> = [];
    // The initial state has no incoming recorded transition; synthesize it.
    if (this.history.length === 0 || this.history[0].from !== PROGRESS_STATES[0]) {
      // Only include the synthesized origin when the machine started at OBSERVED.
    }
    for (const t of this.history) {
      timeline.push({ state: t.to, at: t.at, note: t.note });
    }
    if (timeline.length === 0) {
      timeline.push({ state: this.state, at: Date.now() });
    }
    return timeline;
  }
}

/** Maps a legacy `VersionStatus` onto the v2 state machine for migration paths. */
export function stateFromLegacyStatus(
  status: "candidate" | "validated" | "promoted" | "rejected" | "rolled_back",
): EvolutionState {
  switch (status) {
    case "candidate":
      return "CANDIDATE";
    case "validated":
      return "VALIDATED";
    case "promoted":
      return "ACTIVE";
    case "rejected":
      return "REJECTED";
    case "rolled_back":
      return "ROLLBACK";
  }
}
