/**
 * CLI interface for the Nexum Harness Evolution System.
 *
 * Implements developer commands for diagnosing runtime weaknesses, inspecting
 * the H0 -> Hn evolutionary lineage, running benchmarks, and rolling back mutations.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../cli/config.js";
import { Episode } from "../learning/types.js";
import { findWorkspaceRoot, workspaceStateDir } from "../platform/paths.js";
import { Provider } from "../provider/provider.js";
import { runHarnessBenchmark } from "./benchmarks.js";
import { CandidateEvaluationOutcome, EvolutionEngine } from "./engine.js";
import { ClosedLoopEngine } from "./engine-v2.js";
import { ExperienceStore } from "./experience/experience-store.js";
import { ExperimentStore } from "./experiments/experiment-store.js";
import { EvolutionMetricsTracker } from "./metrics.js";
import { GitWorktreeMutationExecutor } from "./mutation/mutation-executor.js";
import { NexumEngineeringAgentRuntime, chatClientFromProvider } from "./mutation/nexum-agent-runtime.js";
import { ActivationMonitor, OperationalTelemetry } from "./monitoring/activation-monitor.js";
import { EvolutionPlan } from "./planner.js";
import { HarnessRegistry } from "./registry.js";
import { HarnessComponent, HarnessDiagnosis, HarnessVersion } from "./types.js";

const HELP_TEXT = `
Nexum Evolution — Self-Developing Harness System (closed-loop v2)

Usage:
  nexum evolve [options]

Options:
  -d, --diagnose         Diagnose recent execution failures and recommend mutations
      --target           Form the capability-level improvement target (Aspire layer)
      --experience       Show evidence-grounded experience digest (S³Gym layer)
      --experiments      List experiment records with lifecycle states
      --report           Evolution health report (promotion precision, retention, …)
      --history          Show evolutionary lineage (H0 -> Hn) and active version
      --mutate           Run the self-development actuator: target → isolated
                         worktree → planned edits → verification → candidate commit
      --agent            Wire the PRODUCTION engineering agent as the mutation
                         strategy (NexumEngineeringAgentRuntime over the
                         configured provider). Default: heuristic planner.
      --repo <path>      Harness repository to mutate (required with --mutate)
      --parent <sha>     Parent commit to mutate from (default: HEAD)
  -c, --candidate <id>   Evaluate candidate harness and check promotion criteria
  -r, --rollback <id>    Roll back active harness to a prior version
  -b, --benchmark        Run benchmark categories relevant to candidate
  -a, --autonomous       Run an autonomous diagnosis and mutation planning cycle
      --limit <n>        Limit number of episodes analyzed (default: 20)
      --component <name> Target subsystem for candidate evaluation (default: execution)
      --hypothesis <txt> Remediation hypothesis statement for candidate
      --monitor          Evaluate post-activation health against the parent envelope
      --telemetry <file> JSONL file of OperationalTelemetry samples for --monitor
      --harness <id>     Harness id to evaluate with --monitor
  -h, --help             Show this help message
`;

const CLI_OPTIONS = {
  help: { type: "boolean" as const, short: "h" },
  diagnose: { type: "boolean" as const, short: "d" },
  target: { type: "boolean" as const },
  experience: { type: "boolean" as const },
  experiments: { type: "boolean" as const },
  report: { type: "boolean" as const },
  mutate: { type: "boolean" as const },
  agent: { type: "boolean" as const },
  repo: { type: "string" as const },
  parent: { type: "string" as const },
  monitor: { type: "boolean" as const },
  telemetry: { type: "string" as const },
  harness: { type: "string" as const },
  history: { type: "boolean" as const },
  candidate: { type: "string" as const, short: "c" },
  rollback: { type: "string" as const, short: "r" },
  benchmark: { type: "boolean" as const, short: "b" },
  autonomous: { type: "boolean" as const, short: "a" },
  limit: { type: "string" as const },
  component: { type: "string" as const },
  hypothesis: { type: "string" as const },
};

/** Reads recent episodes from the workspace lesson database. */
export function loadRecentEpisodes(root: string, limit = 20): Episode[] {
  const dbPath = join(workspaceStateDir(root), "lessons.db");
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath);
  try {
    const rows = db.prepare("SELECT payload FROM episodes ORDER BY started_at DESC LIMIT ?").all(limit) as Array<{
      payload: string;
    }>;
    return rows.map((r) => JSON.parse(r.payload) as Episode);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Formats the formed improvement target (Aspire layer) for CLI display. */
export function formatTargetText(observation: ReturnType<ClosedLoopEngine["observe"]>): string {
  const lines: string[] = ["=== Target Formation (closed-loop v2) ==="];
  if (!observation.target) {
    lines.push(
      "No capability target could be operationalized from the available diagnoses.",
      "Gather more telemetry before mutating the harness (Aspire: vague targets waste the improvement budget).",
    );
    return lines.join("\n");
  }
  const t = observation.target;
  lines.push(`Capability:      ${t.capability} (confidence ${(t.confidence * 100).toFixed(0)}%)`);
  lines.push(`Desired Outcome: ${t.desiredOutcome}`);
  lines.push(`Symptoms:        ${t.observableSymptoms.length}`);
  t.observableSymptoms.slice(0, 5).forEach((s) => lines.push(`  - ${s}`));
  lines.push(`Must-Move Metrics: ${t.measurableMetrics.join(", ")}`);
  lines.push(`Affected Components: ${t.affectedComponents.join(", ")}`);
  lines.push(`Evaluation Plan: ${t.evaluationPlan.steps.map((s) => `${s.suite}(${s.split})`).join(", ")}`);
  if (observation.mutationScope) {
    lines.push(
      `Mutation Scope: ${observation.mutationScope.kind} [${observation.mutationScope.components.join(", ")} ]`,
    );
    lines.push(`Scope Rationale: ${observation.mutationScope.rationale}`);
  }
  return lines.join("\n");
}

/** Formats the experience digest (S³Gym layer) for CLI display. */
export function formatExperienceText(digests: ReturnType<ClosedLoopEngine["digestExperience"]>): string {
  if (digests.length === 0) return "No experience records stored yet. Experience accumulates from graded episodes.";
  const lines: string[] = [`=== Experience Digest (${digests.length} task class(es)) ===`];
  for (const d of digests) {
    lines.push(`\n[${d.taskClass}] records=${d.totalRecords} successRate=${(d.successRate * 100).toFixed(0)}%`);
    lines.push(`  Best representation: ${d.bestRepresentation} (S³Gym: no single representation wins everywhere)`);
    if (d.failureModes.length > 0) {
      lines.push(
        `  Top failure modes: ${d.failureModes
          .slice(0, 3)
          .map((f) => `${f.mode}(${(f.share * 100).toFixed(0)}%)`)
          .join(", ")}`,
      );
    }
    if (d.crossModelEvidence.length > 0) {
      lines.push(
        `  Cross-model deltas: ${d.crossModelEvidence.map((e) => `${e.fromModel}→${e.toModel}:${(e.outcomeDelta * 100).toFixed(0)}%`).join(", ")}`,
      );
    }
  }
  return lines.join("\n");
}

/** Formats the experiment registry (persistent provenance) for CLI display. */
export function formatExperimentsText(records: ReturnType<ExperimentStore["listAll"]>): string {
  if (records.length === 0) return "No experiments recorded yet. Experiments are created by the closed-loop engine.";
  const lines: string[] = [`=== Experiment Records (${records.length}) ===`];
  for (const r of records) {
    lines.push(
      `${r.id}  ${r.parent.harness}→${r.candidate.harness}  state=${r.lifecycle.state}  decision=${r.decision.result}  ci=${r.ci.status}  review=${r.review.state}`,
    );
    lines.push(
      `  capability: ${r.target.capability} | executors: ${r.executor.primary}${r.executor.transfer.length ? ` + ${r.executor.transfer.join(", ")}` : ""}`,
    );
  }
  return lines.join("\n");
}

/** Formats the loop health report (first-class evolution metrics). */
export function formatHealthReport(report: ReturnType<EvolutionMetricsTracker["report"]>): string {
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const lines: string[] = [
    "=== Evolution Health Report ===",
    `Versions tracked:        ${report.totalVersions}`,
    `Promoted candidates:     ${report.promotedCount}`,
    `Promotion precision:     ${pct(report.promotionPrecision)}`,
    `False promotion rate:    ${pct(report.falsePromotionRate)}`,
    `Retention rate:          ${pct(report.retentionRate)}`,
    `Regression rate:         ${pct(report.regressionRate)}`,
    `Rollback rate:           ${pct(report.rollbackRate)}`,
    `Mean visible gain:       ${(report.meanVisibleGain * 100).toFixed(1)}%`,
    `Mean held-out gain:      ${(report.meanHeldOutGain * 100).toFixed(1)}%`,
    `Mean transfer gain:      ${(report.meanTransferGain * 100).toFixed(1)}%`,
    `Executor sensitivity:    ${(report.meanExecutorSensitivity * 100).toFixed(1)}%`,
    `Experience→improvement r: ${report.experienceImprovementCorrelation?.toFixed(2) ?? "n/a"}`,
    "",
    report.promotionPrecisionVerdict,
  ];
  return lines.join("\n");
}

/** Formats a tabular list of evolutionary versions. */
export function formatHistory(versions: HarnessVersion[], active: HarnessVersion | null): string {
  if (versions.length === 0) return "No harness versions registered. System is running unversioned base.";
  const header = "ID       STATUS     COMPONENT    CREATED                   HYPOTHESIS\n" + "-".repeat(80);
  const rows = versions.map((v) => {
    const activeMark = active?.id === v.id ? "* " : "  ";
    const date = new Date(v.createdAt).toISOString();
    const hyp = v.hypothesis.length > 32 ? `${v.hypothesis.slice(0, 29)}...` : v.hypothesis;
    return `${activeMark}${v.id.padEnd(7)} ${v.status.padEnd(10)} ${v.targetComponent.padEnd(12)} ${date}  ${hyp}`;
  });
  return `${header}\n${rows.join("\n")}\n\n* = currently active harness version`;
}

/** Formats diagnoses and the recommended evolution plan into a readable report. */
export function formatDiagnosesText(diagnoses: HarnessDiagnosis[], plan: EvolutionPlan | null): string {
  if (diagnoses.length === 0) return "No harness weaknesses detected across evaluated episodes.";
  const lines: string[] = [`=== Harness Diagnoses (${diagnoses.length} issue(s) detected) ===`];
  diagnoses.forEach((d, idx) => {
    lines.push(`\n${idx + 1}. [${d.component}] ${d.failureClass} (confidence: ${(d.confidence * 100).toFixed(0)}%)`);
    lines.push(`   Root Cause: ${d.rootCause}`);
    lines.push(`   Proposed Fix: ${d.proposedFix}`);
    lines.push(
      `   Expected Impact: capability +${(d.expectedImpact.capability * 100).toFixed(0)}%, reliability +${(d.expectedImpact.reliability * 100).toFixed(0)}%`,
    );
  });
  if (plan) {
    lines.push("\n=== Recommended Evolution Plan ===");
    lines.push(`Target Subsystem: ${plan.targetComponent}`);
    lines.push(`Hypothesis: ${plan.hypothesis.statement}`);
    lines.push(`Recommended Benchmarks: ${plan.recommendedBenchmarkCategories.join(", ")}`);
    if (plan.target) {
      lines.push(`Capability Target: ${plan.target.capability} → ${plan.target.desiredOutcome}`);
      lines.push(`Affected Components: ${plan.target.affectedComponents.join(", ")}`);
    }
    if (plan.mutationScope) {
      lines.push(
        `Mutation Scope: ${plan.mutationScope.kind} [${plan.mutationScope.components.join(", ")}] — ${plan.mutationScope.rationale}`,
      );
    }
  }
  return lines.join("\n");
}

function printOutcome(outcome: CandidateEvaluationOutcome): void {
  const v = outcome.version;
  const d = outcome.comparison.scoreDeltas;
  console.log(`\n=== Evaluation Outcome for ${v.id} ===`);
  console.log(`Decision:  ${outcome.comparison.decision.toUpperCase()}`);
  console.log(`Status:    ${v.status}`);
  console.log(`Rationale: ${outcome.comparison.rationale}\n`);
  console.log("Score Deltas vs Baseline:");
  console.log(`  Capability:     ${d.capability >= 0 ? "+" : ""}${(d.capability * 100).toFixed(1)}%`);
  console.log(`  Reliability:    ${d.reliability >= 0 ? "+" : ""}${(d.reliability * 100).toFixed(1)}%`);
  console.log(`  Efficiency:     ${d.efficiency >= 0 ? "+" : ""}${(d.efficiency * 100).toFixed(1)}%`);
  console.log(`  Generalization: ${d.generalization >= 0 ? "+" : ""}${(d.generalization * 100).toFixed(1)}%`);
  if (outcome.deliveryReport) {
    console.log(`\nDelivery Branch: ${outcome.deliveryReport.branchName}`);
    console.log(`PR Title:        ${outcome.deliveryReport.prTitle}`);
  }
}

async function runCandidateEvaluation(
  engine: EvolutionEngine,
  values: Record<string, unknown>,
  candidateId: string,
): Promise<void> {
  const cfg = loadConfig();
  const provider = new Provider({
    tier: cfg.tier,
    model: cfg.model,
    apiKey: cfg.apiKey,
    host: cfg.tier === "local" ? cfg.host : undefined,
  });
  const component = (values.component as HarnessComponent) || "execution";
  const hypothesis = (values.hypothesis as string) || "Automated harness mutation evaluation";

  console.log(`[Evolution] Benchmarking candidate ${candidateId} using model ${cfg.model} (${cfg.tier})...`);
  try {
    const results = await runHarnessBenchmark(provider, [component]);
    const outcome = engine.evaluateCandidate(
      { id: candidateId, commitSha: "HEAD", targetComponent: component, hypothesis },
      results,
    );
    printOutcome(outcome);
  } catch (err) {
    console.error(`[Evolution] Evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runBenchmarkSuites(engine: EvolutionEngine, root: string): Promise<void> {
  const episodes = loadRecentEpisodes(root, 20);
  const { plan } = engine.diagnoseEpisodes(episodes);
  const suites = plan?.recommendedBenchmarkCategories ?? ["execution", "agentic-looping"];
  console.log(`[Evolution] Running harness benchmark suites: ${suites.join(", ")}...`);

  const cfg = loadConfig();
  const provider = new Provider({
    tier: cfg.tier,
    model: cfg.model,
    apiKey: cfg.apiKey,
    host: cfg.tier === "local" ? cfg.host : undefined,
  });
  try {
    const results = await runHarnessBenchmark(provider, suites);
    const passed = results.filter((r) => r.success).length;
    console.log(`[Evolution] Benchmark completed: ${passed}/${results.length} cases passed.`);
  } catch (err) {
    console.log(
      `[Evolution] Recommended suites: ${suites.join(", ")} (run skipped: ${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * Rebuilds the metrics tracker from persisted experiment records so that the
 * health report reflects the full history, not just the current process.
 */
export function metricsFromExperimentStore(store: ExperimentStore): EvolutionMetricsTracker {
  const tracker = new EvolutionMetricsTracker();
  for (const r of store.listAll()) {
    const promoted = r.decision.result === "eligible";
    const accepted =
      r.lifecycle.state === "ACTIVE" || r.lifecycle.state === "REGRESSED" || r.lifecycle.state === "ROLLBACK";
    tracker.record({
      versionId: r.candidate.harness,
      parentVersionId: r.parent.harness,
      visibleGain: r.metrics.capability,
      heldOutGain: r.metrics.generalization,
      transferGain: r.metrics.generalization,
      promoted,
      genuinelyBetterOnHeldOut: promoted ? r.decision.stageB === "improved" : "unknown",
      accepted,
      rolledBack: r.lifecycle.state === "ROLLBACK",
      retainedBySuccessor: "unknown",
      executorModels: [r.executor.primary, ...r.executor.transfer],
      executorSensitivity: 0,
    });
  }
  return tracker;
}

async function executeCommand(engine: EvolutionEngine, values: Record<string, unknown>, root: string): Promise<void> {
  if (values.history) {
    console.log(formatHistory(engine.listVersions(), engine.getActiveVersion()));
    return;
  }
  if (typeof values.rollback === "string") {
    engine.rollback(values.rollback);
    console.log(`[Evolution] Active harness rolled back to ${values.rollback}.`);
    return;
  }
  if (typeof values.candidate === "string") {
    await runCandidateEvaluation(engine, values, values.candidate);
    return;
  }
  if (values.benchmark) {
    await runBenchmarkSuites(engine, root);
    return;
  }
  const limit = values.limit ? parseInt(values.limit as string, 10) : 20;
  const episodes = loadRecentEpisodes(root, limit);
  const { diagnoses, plan } = engine.diagnoseEpisodes(episodes);
  console.log(formatDiagnosesText(diagnoses, plan));
}

/** Formats a mutation actuator result for CLI display. */
export function formatMutationResult(res: {
  ok: boolean;
  stage?: string;
  reason?: string;
  mutation: {
    workspace?: { worktreePath: string; branchName: string };
    plan?: { summary: string; edits: unknown[] };
    result?: { diffStat: string };
    artifact?: { commitSha: string; changedFiles: string[] };
  };
}): string {
  const lines: string[] = ["=== Self-Development Actuator ==="];
  if (!res.ok) {
    lines.push(`FAILED at stage: ${res.stage}`, `Reason: ${res.reason}`);
    if (res.mutation.plan) lines.push(`Plan: ${res.mutation.plan.summary}`);
    return lines.join("\n");
  }
  if (res.mutation.workspace) {
    lines.push(`Worktree: ${res.mutation.workspace.worktreePath}`);
    lines.push(`Branch:   ${res.mutation.workspace.branchName}`);
  }
  if (res.mutation.plan) {
    lines.push(`Plan:     ${res.mutation.plan.summary} (${res.mutation.plan.edits.length} edit(s))`);
  }
  if (res.mutation.result) lines.push(`Diff:     ${res.mutation.result.diffStat.split("\n")[0] || "(no diff)"}`);
  if (res.mutation.artifact) {
    lines.push(`Commit:   ${res.mutation.artifact.commitSha}`);
    lines.push(`Files:    ${res.mutation.artifact.changedFiles.join(", ")}`);
  }
  return lines.join("\n");
}

/** Parses a JSONL telemetry file for the --monitor command. */
export function loadTelemetrySamples(path: string): OperationalTelemetry[] {
  const out: OperationalTelemetry[] = [];
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed) as OperationalTelemetry);
  }
  return out;
}

/** Formats an activation health verdict for CLI display. */
export function formatActivationHealth(health: ReturnType<ActivationMonitor["evaluate"]>): string {
  const lines: string[] = [
    "=== Activation Monitor (post-deployment) ===",
    `Harness:   ${health.harnessId}`,
    `Status:    ${health.status.toUpperCase()}`,
    `Samples:   ${health.samples} sample(s), ${health.sampleEpisodes} episode(s)`,
  ];
  if (health.violations.length > 0) {
    lines.push("Violations:");
    health.violations.forEach((v) => lines.push(`  - [${v.severity}] ${v.detail}`));
  }
  if (health.distributionDrift !== null) {
    lines.push(`Task-class drift: ${(health.distributionDrift * 100).toFixed(1)}%`);
  }
  lines.push(health.rationale);
  return lines.join("\n");
}

async function executeMutationCommand(root: string, values: Record<string, unknown>): Promise<void> {
  const repoRoot = values.repo as string | undefined;
  if (!repoRoot) {
    console.error("--mutate requires --repo <path> (the harness repository to mutate).");
    return;
  }
  const stateDir = workspaceStateDir(root);
  const experienceStore = new ExperienceStore(join(stateDir, "experience.db"));
  const limit = values.limit ? parseInt(values.limit as string, 10) : 20;
  // --agent: PRODUCTION self-development wiring — the mutation plan comes from
  // Nexum's own engineering agent (bounded tool loop over the configured
  // provider) inspecting the candidate worktree, not from the heuristic planner.
  // Default stays heuristic: autonomous source mutation is explicitly opt-in.
  const agentRuntime = values.agent
    ? (() => {
        const cfg = loadConfig();
        return new NexumEngineeringAgentRuntime({
          chat: chatClientFromProvider(new Provider({ tier: cfg.tier, model: cfg.model })),
        });
      })()
    : undefined;
  const engine = new ClosedLoopEngine({
    experienceStore,
    ...(agentRuntime
      ? { agentRuntime }
      : {
          mutationExecutor: new GitWorktreeMutationExecutor({ verifyCommands: [["node", "--version"]] }),
        }),
  });
  try {
    const episodes = loadRecentEpisodes(root, limit);
    const observation = engine.observe(episodes);
    if (!observation.target || !observation.mutationScope || observation.diagnoses.length === 0) {
      console.error("No operationalizable target from recent episodes; refusing to mutate blind.");
      return;
    }
    const outcome = await engine.runEvolutionCycle({
      experimentId: `exp-${Date.now()}`,
      parentHarnessId: "HEAD",
      parentCommit: (values.parent as string) || "HEAD",
      candidateHarnessId: `H${Date.now().toString(36)}`,
      repoRoot,
      target: observation.target,
      diagnosis: observation.diagnoses[0],
      scope: observation.mutationScope,
      baselineResults: [],
      evaluateCandidate: () => {
        throw new Error("CLI actuator does not run benchmarks; wire evaluateCandidate to runHarnessBenchmark.");
      },
    });
    console.log(formatMutationResult(outcome));
  } finally {
    experienceStore.close();
  }
}

async function executeMonitorCommand(root: string, values: Record<string, unknown>): Promise<void> {
  void root;
  const telemetryPath = values.telemetry as string | undefined;
  const harnessId = values.harness as string | undefined;
  if (!telemetryPath || !harnessId) {
    console.error("--monitor requires --telemetry <file.jsonl> and --harness <id>.");
    return;
  }
  const monitor = new ActivationMonitor();
  for (const sample of loadTelemetrySamples(telemetryPath)) {
    monitor.ingest(sample);
  }
  // Without a registered envelope the monitor reports 'insufficient samples'
  // honestly; production callers register envelopes via the engine.
  console.log(formatActivationHealth(monitor.evaluate(harnessId)));
}

async function executeClosedLoopCommand(root: string, values: Record<string, unknown>): Promise<void> {
  const stateDir = workspaceStateDir(root);
  const experienceStore = new ExperienceStore(join(stateDir, "experience.db"));
  const experimentStore = new ExperimentStore(join(stateDir, "experiments.db"));
  const engine = new ClosedLoopEngine({ experienceStore });
  const limit = values.limit ? parseInt(values.limit as string, 10) : 20;

  try {
    if (values.experience) {
      console.log(formatExperienceText(engine.digestExperience()));
      return;
    }
    if (values.experiments) {
      console.log(formatExperimentsText(experimentStore.listAll()));
      return;
    }
    if (values.report) {
      console.log(formatHealthReport(metricsFromExperimentStore(experimentStore).report()));
      return;
    }
    // Default v2 view: observation pipeline with target formation.
    const episodes = loadRecentEpisodes(root, limit);
    const observation = engine.observe(episodes);
    if (values.target) {
      console.log(formatTargetText(observation));
    } else {
      console.log(formatDiagnosesText(observation.diagnoses, observation.plan));
      console.log("");
      console.log(formatTargetText(observation));
    }
  } finally {
    experienceStore.close();
    experimentStore.close();
  }
}

export async function runEvolutionCli(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: CLI_OPTIONS, allowPositionals: true });
  if (values.help) {
    console.log(HELP_TEXT);
    return;
  }
  const root = findWorkspaceRoot(process.cwd());

  if (values.mutate) {
    await executeMutationCommand(root, values);
    return;
  }
  if (values.monitor) {
    await executeMonitorCommand(root, values);
    return;
  }

  // v2 closed-loop commands use their own stores and engine.
  if (values.target || values.experience || values.experiments || values.report) {
    await executeClosedLoopCommand(root, values);
    return;
  }

  const stateDir = workspaceStateDir(root);
  mkdirSync(stateDir, { recursive: true });
  const registry = new HarnessRegistry(join(stateDir, "evolution.db"));
  const engine = new EvolutionEngine({ registry });
  try {
    await executeCommand(engine, values, root);
  } finally {
    registry.close();
  }
}
