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

// Vendored primitives
export { Badge, type BadgeProps, type BadgeVariant } from "./badge.js";
export { Spinner, type SpinnerProps, type SpinnerType } from "./spinner.js";
export { Divider, type DividerProps } from "./divider.js";
export { Tag, type TagProps, type TagVariant } from "./tag.js";
export { StatusMessage, type StatusMessageProps, type StatusVariant } from "./status-message.js";
export { ProgressBar, type ProgressBarProps } from "./progress-bar.js";
export { KeyboardShortcuts, type KeyboardShortcutsProps, type Shortcut } from "./keyboard-shortcuts.js";
export { Alert, type AlertProps, type AlertVariant } from "./alert.js";
export { InfoBox, type InfoBoxProps } from "./info-box.js";
export { Heading, type HeadingProps, type HeadingLevel } from "./heading.js";
export { KeyValue, type KeyValueItem, type KeyValueProps } from "./key-value.js";

// Vendored hooks
export {
  useInteraction,
  FocusScope,
  type InteractionProps,
  type UseInteractionOptions,
  type UseInteractionResult,
} from "./hooks/use-interaction.js";
export { useAnimation, type UseAnimationOptions } from "./hooks/use-animation.js";
export { useMotion, isReducedMotion, MotionContext } from "./hooks/use-motion.js";
