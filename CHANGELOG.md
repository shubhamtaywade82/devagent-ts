# Changelog

## Unreleased

### Added — Closed-Loop Self-Development v2 (`src/evolution/`)

Implements the deeper closed-loop RSI layers on top of the HarnessDev-style
v1 foundation, informed by the Self-Developing Agents research (Aspire /
S³Gym / HarnessDev):

- **Evolution lifecycle state machine** (`state-machine.ts`): 13 progressive
  states (`OBSERVED → … → ACTIVE`) with explicit failure paths
  (`REJECTED`, `CI_FAILED`, `CHANGES_REQUESTED`, `REGRESSED`, `ROLLBACK`)
  and recovery transitions. Declared promotions are structurally impossible.
- **TargetEngine** (`targets/target-engine.ts`): Aspire-style target
  formation between diagnosis and planning — answers "what capability is
  actually failing?" before "which file should I change?"; refuses vague
  targets with weak evidence.
- **Experience engine** (`experience/`): `ExperienceStore` (SQLite),
  `TrajectoryAnalyzer`, `EvidenceAggregator`, `TransferAnalyzer` —
  evidence-grounded experience records bound to verifier evidence, executor
  model, and harness version; multi-representation digests (raw trajectory /
  summary / aggregated statistics) selected per task class per the S³Gym
  finding that no single representation wins.
- **Two-stage candidate selection** (`comparison/two-stage-selector.ts`):
  Stage A statistical/execution validity (sample size, verifier coverage,
  catastrophic regressions) separated from Stage B improvement validity
  (capability/reliability gain, held-out, transfer, cost).
- **Fixed-executor evaluation protocol** (`evaluation/fixed-executor.ts`) and
  **GeneralizationGate** (`generalization/generalization-gate.ts`): evaluator
  model, harness candidate, and task suite as independent variables; held-out
  - transfer gates with executor-sensitivity and direction-agreement metrics.
- **Mutation scope escalation** (`mutation/mutation-scope.ts`): single
  component by default; explicit compound hypothesis after repeated
  single-component failures against the same capability.
- **Experiment provenance** (`experiments/`): persistent `ExperimentRecord`
  schema + SQLite store + `ExperimentController`; evolution PRs embed a
  machine-readable YAML provenance block making the PR a persistent
  experiment log (CI status and review state included).
- **AcceptanceController** (`acceptance/acceptance-controller.ts`): explicit
  evidence-gated pipeline `candidate → validated → eligible → delivered →
accepted → active`.
- **First-class loop health metrics** (`metrics.ts`): promotion precision,
  false promotion rate, retention/regression/rollback rates, experience→
  improvement correlation, executor sensitivity, visible/held-out/transfer
  gains.
- **`ClosedLoopEngine`** (`engine-v2.ts`): wires the full v2 loop —
  episodes → diagnosis → target formation → hypothesis → experiment →
  two-stage gates → generalization gate → delivery → CI/review feedback →
  active/rollback.
- **v2 CLI**: `nexum evolve --target | --experience | --experiments | --report`.

The v1 `EvolutionEngine` API remains fully backward compatible.

### Added — v2.1: The Self-Development Actuator, Real Delivery & Post-Activation Monitoring

Closes the gaps identified in the v2 architecture review — Nexum moves from
self-evaluating to self-developing:

- **HarnessMutationExecutor** (`mutation/mutation-executor.ts`): the missing
  actuator. `prepareWorkspace → inspectTarget → implement → verify →
finalize` turns a formed target into a verifiable candidate commit inside
  an isolated git worktree. `MutationStrategy` is pluggable (default:
  deterministic heuristic; real self-modification plugs in the agent
  runtime/LLM). Every edit is scope-guarded at the filesystem boundary and
  must survive the configured verification commands.
- **`ClosedLoopEngine.runEvolutionCycle()`**: the full self-development cycle
  — mutation → candidate commit → benchmark callback → two-stage +
  generalization gates → delivery — with per-stage failure reporting
  (`prepare` / `implement` / `verify` / `finalize` / `evaluate`) and
  artifacts preserved for rework.
- **GitHubDeliveryAdapter** (`delivery/github-adapter.ts`): performs the
  real Git/GitHub delivery loop (commit → push → PR) and feeds external
  results back into the `ExperimentController`: CI check-run polling
  (`syncCiFeedback`), latest-review polling (`syncReviewFeedback`), and
  merge support. Git and HTTP are injectable; a polling timeout reports
  `pending` honestly instead of fabricating a verdict.
- **Explicit CI/review lifecycle states** (v2.1 state machine): `CI_PENDING`,
  `CI_PASSED`, `REVIEW_PENDING`, `APPROVED` — a CI verdict ALWAYS advances
  the experiment (DELIVERED → CI_PENDING → CI_FAILED | CI_PASSED →
  REVIEW_PENDING), and a review verdict always advances it (REVIEW_PENDING →
  APPROVED | CHANGES_REQUESTED). Fixes the v2.0 bug where a passing CI run
  left the lifecycle parked at DELIVERED. `normalizeLegacyState()` maps old
  persisted `REVIEWED` records onto `REVIEW_PENDING`.
- **Generalization policy** (`ClosedLoopEngineOptions.generalizationPolicy`):
  `optional` (development, the v2.0 behavior) | `required` (research: the
  fixed-executor matrix MUST be supplied and pass) | `required-for-production`
  (research + transfer-executor evidence). Policy-blocked candidates walk
  VALIDATED → GENERALIZED → REJECTED with the reason in the audit trail.
- **ActivationMonitor** (`monitoring/activation-monitor.ts`): post-activation
  regression detection from operational telemetry (success rate, false
  success rate, tool error rate, loop aborts, verification failures, token
  consumption, latency, task-class distribution drift) against a
  performance envelope derived from the parent harness at activation time.
  `healthy → degrading → regressed`, with `regressed` auto-driving
  ACTIVE → REGRESSED → ROLLBACK.
- **Two-stage rejection path**: candidates rejected by Stage A/B now walk
  EVALUATING → REJECTED explicitly instead of being left stuck in EVALUATING.
- **v2.1 CLI**: `nexum evolve --mutate --repo <path> [--parent <sha>]`
  (self-development actuator) and `nexum evolve --monitor --harness <id>
--telemetry <file.jsonl>` (post-activation health).

## 2.0.0 (2026-08-30)

DevAgent TS is now **Nexum** — same runtime, new name. This is a breaking
product migration: package, CLI, environment variables, and workspace state
directory all change, with one-major-version compatibility aliases so nothing
of yours is lost. Full contract: [docs/REBRANDING.md](docs/REBRANDING.md).

### Breaking

- Package renamed: `@nemesis-oss/devagent-ts` → `@nemesis-oss/nexum`
- CLI renamed: `nexum` (bin aliases `devagent` and `devagent-ts` retained for
  one major version)
- Workspace state moved: `.devagent/` → `.nexum/` — migrated automatically on
  first run (atomic copy, idempotent, never deletes the original); `nexum
migrate` prints an explicit migration report
- Global state moved: `~/.devagent/` → `~/.nexum/` (legacy read as fallback)
- Environment variables renamed: `DEVAGENT_*` → `NEXUM_*` (legacy names still
  honored as deprecated aliases — they warn on stderr and lose to the
  canonical name; suppress with `NEXUM_NO_DEPRECATION_WARNINGS=1`)

### Added

- `src/platform/` layer — `brand.ts` (single source of truth for product
  identity), `environment.ts` (canonical-then-legacy env resolution with
  deprecation warnings), `paths.ts` (state-dir resolution, workspace-root
  discovery), `workspace.ts` (`WorkspaceManager`: detect / migrate /
  initialize / resolve; global-state migration)
- `nexum migrate` command with structured report (workspace entries, history
  file, global state, active legacy env variables)
- `nexum doctor` now reports workspace-state health, legacy `.devagent`
  presence, deprecated `DEVAGENT_*` variables, and the sandbox image
- `docs/REBRANDING.md` — the authoritative DevAgent → Nexum migration contract
- Default sandbox image `nexum-sandbox:latest` (Dockerfile now node:22-slim;
  legacy `devagent-sandbox:latest` still honored when configured explicitly)

### Fixed

- CI push trigger now also covers `rename/**` branches (PRs against `main`
  were already covered)
- Node.js version documented consistently as >= 22 everywhere (AGENTS.md said
  > = 20; sandbox image was node:20-slim)

## 1.0.0 (2026-08-29)

Final DevAgent TS baseline (tagged `v1.0.0`). See git history.

## 0.1.0 (2026-08-28)

### Added

- Public API surface with typed exports (`Agent`, `Provider`, `ModelCatalog`, `Router`)
- Conditional exports map for ESM consumers
- `prepare` npm script to build before publish
- `.npmignore` to ship only compiled output
- MIT LICENSE file
- `src/index.ts` barrel entry re-exporting core classes
- `testTimeout` and `forceExit` in Jest config for reliable CI runs

### Fixed

- Removed unused imports that caused lint errors (`Capability`, `ChatMessage`, `ChatResponse`, `CommandEffect`, `existsSync`)
- CI workflow Node version aligned to `>=22` (was 20)
- App.test.tsx no longer hangs indefinitely — extracted `useStdout()` into a lazily-rendered `TerminalSizeListener` component so tests that provide explicit dimensions never attach Ink's stdout listener
- Skipped bracketed-paste integration test that sets `process.stdin.isTTY = true` (leaves open handle on real stdin)
- Eliminated all 23 `as any` type casts — replaced with proper interfaces and type guards

### Changed

- `package.json` no longer marked `private` — package is publishable to npm
- `useTerminalSize` hook in App.tsx avoids calling `useStdout()` when both dimensions are provided
- `ChatResponse.message` now includes optional `thinking` field for extended Ollama streaming responses
