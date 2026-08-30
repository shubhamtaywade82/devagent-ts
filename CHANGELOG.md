# Changelog

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
  >= 20; sandbox image was node:20-slim)

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
