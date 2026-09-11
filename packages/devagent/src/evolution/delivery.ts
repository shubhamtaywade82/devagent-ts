/**
 * Git & GitHub Delivery Engine for promoting validated harness versions.
 *
 * Converts promoted candidate harnesses into isolated git branches, structured
 * commits, and GitHub Draft PRs containing complete empirical evidence tables.
 */

import { ComparisonResult, HarnessHypothesis, HarnessVersion } from "./types.js";
import { ExperimentRecord } from "./experiments/experiment-schema.js";
import { provenanceYamlCodeBlock } from "./experiments/provenance.js";

export interface DeliveryPrOptions {
  version: HarnessVersion;
  hypothesis: HarnessHypothesis;
  comparison: ComparisonResult;
}

export interface DeliveryReport {
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}

/** Formats a structured, research-grade commit message for the promoted harness candidate. */
export function formatEvolutionCommit(v: HarnessVersion, comp: ComparisonResult): string {
  const cap = (comp.scoreDeltas.capability * 100).toFixed(1);
  const rel = (comp.scoreDeltas.reliability * 100).toFixed(1);
  const eff = (comp.scoreDeltas.efficiency * 100).toFixed(1);
  const gen = (comp.scoreDeltas.generalization * 100).toFixed(1);

  return `feat(evolution): promote ${v.targetComponent} harness mutation (${v.id})

Parent: ${v.parentId ?? "baseline"}
Candidate: ${v.id}
Target Component: ${v.targetComponent}

Hypothesis:
${v.hypothesis}

Evaluation:
- Capability: ${comp.scoreDeltas.capability >= 0 ? "+" : ""}${cap}%
- Reliability: ${comp.scoreDeltas.reliability >= 0 ? "+" : ""}${rel}%
- Efficiency: ${comp.scoreDeltas.efficiency >= 0 ? "+" : ""}${eff}%
- Generalization: ${comp.scoreDeltas.generalization >= 0 ? "+" : ""}${gen}%

Decision: ${comp.decision.toUpperCase()} (${comp.rationale})`;
}

/** Builds the full Markdown body for a GitHub pull request. */
export function formatPrBody(opts: DeliveryPrOptions): string {
  const { version, hypothesis, comparison } = opts;
  const d = comparison.scoreDeltas;

  return `## Nexum Harness Evolution — Promoted Mutation \`${version.id}\`

### 1. Hypothesis & Root Cause
- **Target Component:** \`${version.targetComponent}\`
- **Parent Version:** \`${version.parentId ?? "baseline"}\`
- **Hypothesis:** ${hypothesis.statement}
- **Predicted Effect:** ${hypothesis.predictedEffect}

### 2. Empirical Evaluation

| Dimension | Delta | Interpretation |
| :--- | :---: | :--- |
| **Capability** | \`${d.capability >= 0 ? "+" : ""}${(d.capability * 100).toFixed(1)}%\` | Task success and verification accuracy |
| **Reliability** | \`${d.reliability >= 0 ? "+" : ""}${(d.reliability * 100).toFixed(1)}%\` | Error reduction, loop aborts, false successes |
| **Efficiency** | \`${d.efficiency >= 0 ? "+" : ""}${(d.efficiency * 100).toFixed(1)}%\` | Token consumption change |
| **Generalization** | \`${d.generalization >= 0 ? "+" : ""}${(d.generalization * 100).toFixed(1)}%\` | Held-out and cross-model transfer score |

### 3. Decision & Provenance
- **Decision:** **\`${comparison.decision.toUpperCase()}\`**
- **Rationale:** ${comparison.rationale}
- **Candidate Commit:** \`${version.commitSha}\`

---
*Generated autonomously by Nexum Evolution Engine.*`;
}

export class GitDeliveryEngine {
  prepareDelivery(opts: DeliveryPrOptions): DeliveryReport {
    const slug = opts.version.targetComponent.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const branchName = `evolution/${opts.version.id.toLowerCase()}-${slug}`;
    const commitMessage = formatEvolutionCommit(opts.version, opts.comparison);
    const prTitle = `feat(evolution): ${opts.version.targetComponent} improvement [${opts.version.id}]`;
    const prBody = formatPrBody(opts);

    return {
      branchName,
      commitMessage,
      prTitle,
      prBody,
    };
  }

  /**
   * v2: builds the delivery report for a full experiment record — the PR body
   * embeds the machine-readable experiment provenance YAML so the PR is a
   * persistent experiment log, not merely a code review.
   */
  prepareExperimentDelivery(
    record: ExperimentRecord,
    comparison: ComparisonResult,
    hypothesis: HarnessHypothesis,
  ): DeliveryReport {
    const base = this.prepareDelivery({
      version: {
        id: record.candidate.harness,
        commitSha: record.candidate.commit,
        parentId: record.parent.harness,
        createdAt: record.createdAt,
        targetComponent: (record.scopeComponents?.[0] ?? "execution") as HarnessVersion["targetComponent"],
        hypothesis: record.hypothesis.statement,
        metrics: {
          capability: { taskSuccessRate: record.metrics.capability, verificationPassRate: record.metrics.capability },
          reliability: { toolErrorRate: 1 - record.metrics.reliability, falseSuccessRate: 0, loopAbortRate: 0 },
          efficiency: { avgTokens: 0, avgLatencyMs: 0 },
          generalization: { heldOutScore: record.metrics.generalization, transferScore: record.metrics.generalization },
        },
        status: "validated",
      },
      hypothesis,
      comparison,
    });

    const prBody = [base.prBody, provenanceYamlCodeBlock(record)].join("\n\n");
    return { ...base, prBody };
  }
}
