/**
 * Public exports for the Nexum Harness Evolution Subsystem.
 *
 * v1 (HarnessDev foundation): taxonomy → diagnoser → hypothesis → planner →
 * evaluator → comparator → registry → delivery → engine.
 *
 * v2 (closed-loop self-development): target formation (Aspire), experience
 * learning (S³Gym), two-stage selection, fixed-executor generalization,
 * explicit acceptance state machine, persistent experiment provenance, and
 * first-class loop health metrics.
 */

// ── v1 foundation ──
export * from "./types.js";
export * from "./taxonomy.js";
export * from "./diagnoser.js";
export * from "./hypothesis.js";
export * from "./planner.js";
export * from "./registry.js";
export * from "./comparator.js";
export * from "./evaluator.js";
export * from "./delivery.js";
export * from "./engine.js";
export * from "./benchmarks.js";
export * from "./cli.js";

// ── v2 closed-loop layers ──
export * from "./state-machine.js";
export * from "./metrics.js";

export * from "./targets/target-engine.js";

export * from "./experience/types.js";
export * from "./experience/experience-store.js";
export * from "./experience/trajectory-analyzer.js";
export * from "./experience/evidence-aggregator.js";
export * from "./experience/transfer-analyzer.js";

export * from "./comparison/two-stage-selector.js";
export * from "./evaluation/fixed-executor.js";
export * from "./generalization/generalization-gate.js";
export * from "./mutation/mutation-scope.js";
export * from "./mutation/mutation-executor.js";
export * from "./mutation/agent-mutation.js";
export * from "./mutation/nexum-agent-runtime.js";
export * from "./mutation/path-scope.js";
export * from "./mutation/verification-profile.js";
export * from "./delivery/github-adapter.js";
export * from "./monitoring/activation-monitor.js";
export * from "./monitoring/runtime-activation.js";

export * from "./experiments/experiment-schema.js";
export * from "./experiments/experiment-store.js";
export * from "./experiments/experiment-controller.js";
export * from "./experiments/provenance.js";

export * from "./acceptance/acceptance-controller.js";
export * from "./engine-v2.js";
