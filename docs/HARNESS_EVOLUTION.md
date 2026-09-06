# Nexum Harness Evolution: Self-Developing Agent Runtime

Nexum implements a meta-evolutionary control loop inspired by the **HarnessDev** paradigm ($H = \langle E, T, C, S, L, V \rangle$). 

While traditional coding agents learn only *task-level* lessons, Nexum can diagnose its own runtime execution failures, identify architectural weaknesses in its execution harness, formulate targeted mutation hypotheses, benchmark candidate changes against multi-objective Pareto dimensions, and autonomously prepare scientific GitHub Pull Requests with empirical evidence matrices.

---

## 1. The Harness Model: $H = \langle E, T, C, S, L, V \rangle$

Nexum treats the agent harness as a formal six-tuple:

```text
H = ⟨ E, T, C, S, L, V ⟩
    │  │  │  │  │  └── Verification & Safety Guardrails
    │  │  │  │  └───── Lifecycle, Recovery & Error Escalation
    │  │  │  └──────── Centralized State Store & Atomic Checkpointing
    │  │  └─────────── Context Engine, LSP & Rails Code Intelligence
    │  └────────────── Tool Runtime & Dynamic Selector
    └───────────────── Execution Loop, Orchestrator DAG & Loop Detector
```

| Component | Subsystem | Purpose in Nexum |
| :--- | :--- | :--- |
| **$E$ — Execution** | `src/orchestrator/` | Step decomposition, dependency DAGs, parallel step execution, loop detection. |
| **$T$ — Tools** | `src/tools/` | 35+ tools, dynamic tool schema pruning per turn, sandbox execution. |
| **$C$ — Context** | `src/intelligence/`, `src/docs/` | 14-language LSP pool, Rails semantic index, DevDocs FTS5 offline search. |
| **$S$ — State** | `src/runtime/` | Immutable store, event bus, atomic step checkpoints, session transcripts. |
| **$L$ — Lifecycle** | `src/provider/`, `src/cli/` | Model routing, self-escalation on failure, session resume, retry policies. |
| **$V$ — Verification**| `src/validation/`, `src/safety/`| Test runners, lint gates, type diagnostics, path traversal containment. |

---

## 2. The Evolutionary Control Loop

The meta-harness control loop operates as a closed feedback cycle:

```text
Telemetry (Episodes)
       ↓
Failure Diagnoser (Root Cause & Taxonomy)
       ↓
Evolution Planner (Single-Component Scoped Hypothesis)
       ↓
Candidate Mutation & Benchmark Runner
       ↓
Multi-Objective Comparator (Pareto Frontiers & Hard Regression Gates)
       ↓
       ├─ [PROMOTE] → Register in SQLite & Open GitHub Draft PR
       └─ [REJECT]  → Demote candidate & Record rationale
```

### The Single-Component Scoping Principle
To prevent regression cascades, every evolution candidate mutation is strictly confined to **one subsystem** at a time ($E$, $T$, $C$, $S$, $L$, or $V$). Multi-component mutations are blocked by the `EvolutionPlanner`.

### Multi-Objective Pareto Dimensions & Regression Gates
Candidate versions are evaluated across four objective dimensions:

1. **Capability**: Task success rate and verification pass rate.
2. **Reliability**: Tool error reduction, elimination of false successes, loop abort rate.
3. **Efficiency**: Token overhead and execution latency (capped at $\le 25\%$ token overhead).
4. **Generalization**: Performance on held-out tasks and cross-model transferability.

**Hard Regression Gates**: Any candidate that degrades reliability by $> 5\%$, generalization by $> 5\%$, or capability by $> 2\%$ is immediately **rejected**.

---

## 3. CLI Reference (`nexum evolve`)

```bash
# View all evolution options
nexum evolve --help

# Show evolutionary lineage (H0 -> Hn) and currently active baseline
nexum evolve --history

# Inspect recent episode failures in .nexum/lessons.db and recommend mutations
nexum evolve --diagnose

# Run benchmark suites matching current weaknesses
nexum evolve --benchmark

# Evaluate and benchmark a candidate harness mutation live
nexum evolve --candidate H1 --component execution --hypothesis "Tighten loop detector threshold"

# Instant rollback to an earlier harness version
nexum evolve --rollback H0
```

---

## 4. Interactive TUI Commands (`/evolve`)

Inside the interactive terminal workspace (`nexum`), developers can control evolution without leaving the TUI:

- `/evolve` or `/evolve history`: Displays the registered version tree and active baseline.
- `/evolve diagnose`: Analyzes recent session episodes and prints detected weaknesses with expected impact deltas.
- `/evolve benchmark`: Displays recommended benchmark categories for active weaknesses.
- `/evolve rollback <id>`: Instantly demotes newer versions and restores version `<id>` as active.

---

## 5. Provenance & Delivery Engine

When a candidate harness mutation is validated and promoted, the `GitDeliveryEngine`:

1. Creates an isolated git branch: `evolution/<version-id>-<component>`
2. Formats a structured, research-grade commit message with hypothesis and score deltas.
3. Prepares a GitHub Draft PR body with a complete empirical evidence table:

```markdown
## Nexum Harness Evolution — Promoted Mutation `H1`

### 1. Hypothesis & Root Cause
- **Target Component:** `execution`
- **Parent Version:** `H0`
- **Hypothesis:** IF loop detection thresholds are tightened THEN loop aborts will decrease.

### 2. Empirical Evaluation

| Dimension | Delta | Interpretation |
| :--- | :---: | :--- |
| **Capability** | `+8.0%` | Task success and verification accuracy |
| **Reliability** | `+15.0%` | Error reduction, loop aborts, false successes |
| **Efficiency** | `+3.2%` | Token consumption change |
| **Generalization** | `+5.0%` | Held-out and cross-model transfer score |

### 3. Decision & Provenance
- **Decision:** **`PROMOTE`**
- **Rationale:** Promoted: capability delta +8.0%, reliability delta +15.0%
- **Candidate Commit:** `HEAD`
```
