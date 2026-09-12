/**
 * Nexum-owned UI kit, vendored from the termcn (ink-ui) registry.
 *
 * Components here are source we own (shadcn-style copy-paste install via
 * `node scripts/vendor-termcn.mjs <name>`), not a black-box dependency.
 * Nexum views/overlays/zones build on these primitives; business logic
 * stays in the runtime/interaction layers.
 */

export * from "./types.js";
export { useTheme, useThemeUpdater, ThemeContext } from "./hooks/use-theme.js";
export { useUnicode, UnicodeContext, isNoUnicode } from "./hooks/use-unicode.js";
export { ThemeProvider, AutoThemeProvider, createTheme, detectColorScheme } from "./providers/theme-provider.js";
export { getTheme, themeNames } from "./theme-registry.js";
export { resolveBorderStyle } from "./lib/terminal-style.js";
export { resolveStatusSymbol, resolveTerminalSymbol, type TerminalStatus } from "./lib/terminal-symbols.js";
