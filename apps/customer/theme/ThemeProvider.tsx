import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { buildTheme, lightTheme, type Theme } from './theme';

/**
 * Resolves the Daylight theme from the OS appearance (`useColorScheme`) and exposes it to the tree.
 * Every screen + primitive reads colors/spacing/type/motion through `useTheme()` — light ⇄ dark is a
 * single source-of-truth switch here. `app.json` sets `userInterfaceStyle: automatic`, so the device's
 * Light/Dark setting (and live toggles) flow straight through.
 */
const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const scheme = useColorScheme();
  const theme = useMemo(() => buildTheme(scheme === 'dark' ? 'dark' : 'light'), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/**
 * The resolved Daylight theme. Falls back to the light palette when no provider is mounted (e.g. a
 * screen rendered in isolation under jest) so primitives/screens always have valid tokens — the real
 * app always wraps the tree in <ThemeProvider> for live light ⇄ dark.
 */
export function useTheme(): Theme {
  return useContext(ThemeContext) ?? lightTheme;
}
