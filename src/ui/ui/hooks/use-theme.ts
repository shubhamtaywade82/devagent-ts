import * as React from "react";

import { getTheme } from "../theme-registry.js";
import type { Theme, ThemeContextValue } from "../types.js";

export const ThemeContext = React.createContext<ThemeContextValue>({
  setTheme: () => {
    // The default context keeps useTheme provider-optional.
  },
  theme: getTheme("default"),
});

export const useTheme = (): Theme => React.useContext(ThemeContext).theme;

export const useThemeUpdater = (): ((theme: Theme) => void) => React.useContext(ThemeContext).setTheme;
