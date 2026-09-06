/**
 * CLI interface for the Nexum Harness Evolution System.
 *
 * Implements developer commands for diagnosing runtime weaknesses, inspecting
 * the H0 -> Hn evolutionary lineage, running benchmarks, and rolling back mutations.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../cli/config.js";
import { Episode } from "../learning/types.js";
import { findWorkspaceRoot, workspaceStateDir } from "../platform/paths.js";
import { Provider } from "../provider/provider.js";
import { runHarnessBenchmark } from "./benchmarks.js";
import { CandidateEvaluationOutcome, EvolutionEngine } from "./engine.js";
import { EvolutionPlan } from "./planner.js";
import { HarnessRegistry } from "./registry.js";
import { HarnessComponent, HarnessDiagnosis, HarnessVersion } from "./types.js";

const HELP_TEXT = `
Nexum Evolution — Self-Developing Harness System

Usage:
  nexum evolve [options]

Options:
  -d, --diagnose         Diagnose recent execution failures and recommend mutations
      --history          Show evolutionary lineage (H0 -> Hn) and active version
  -c, --candidate <id>   Evaluate candidate harness and check promotion criteria
  -r, --rollback <id>    Roll back active harness to a prior version
  -b, --benchmark        Run benchmark categories relevant to candidate
  -a, --autonomous       Run an autonomous diagnosis and mutation planning cycle
      --limit <n>        Limit number of episodes analyzed (default: 20)
      --component <name> Target subsystem for candidate evaluation (default: execution)
      --hypothesis <txt> Remediation hypothesis statement for candidate
  -h, --help             Show this help message
`;

const CLI_OPTIONS = {
  help: { type: "boolean" as const, short: "h" },
  diagnose: { type: "boolean" as const, short: "d" },
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

export async function runEvolutionCli(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: CLI_OPTIONS, allowPositionals: true });
  if (values.help) {
    console.log(HELP_TEXT);
    return;
  }
  const root = findWorkspaceRoot(process.cwd());
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
