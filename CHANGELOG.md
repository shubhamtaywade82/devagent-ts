# Changelog

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
