import React, { createContext, useContext } from 'react';
import { lightTheme, type Theme } from './theme';

/**
 * Exposes the Daylight theme to the tree. Every screen + primitive reads colors/spacing/type/motion
 * through `useTheme()`.
 *
 * The customer app is pinned to the LIGHT palette to match the founder's reference: the product surface
 * is always the clean, bright "Daylight" look regardless of the device's Light/Dark setting. The dark
 * palette + `buildTheme('dark')` still exist in theme.ts, so restoring OS-driven light⇄dark is a one-line
 * change here (resolve from `useColorScheme()` again) — nothing else in the app needs to change.
 * NB: for the native chrome (status bar, keyboard, launch) to stay light too, set
 * `expo.userInterfaceStyle: "light"` in app.json (takes effect on the next native build).
 */
const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ThemeContext.Provider value={lightTheme}>{children}</ThemeContext.Provider>;
}

/**
 * The resolved Daylight theme. Falls back to the light palette when no provider is mounted (e.g. a
 * screen rendered in isolation under jest) so primitives/screens always have valid tokens — the real
 * app always wraps the tree in <ThemeProvider> for live light ⇄ dark.
 */
export function useTheme(): Theme {
  return useContext(ThemeContext) ?? lightTheme;
}
