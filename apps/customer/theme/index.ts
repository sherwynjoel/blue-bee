/**
 * The customer app's theme surface.
 *
 * COLORS + the type/space/radius/elevation/motion scales come from the ONE canonical, Royal-Dry-Cleaning-
 * branded source — `@blue-bee/ui`'s theme layer (which reads `@blue-bee/design-tokens`) — shared with
 * driver/owner. Customer's former local `theme.ts` mirror is deleted; nothing hard-codes tokens.
 *
 * THE LIGHT PIN (deliberate, deterministic). The customer surface is ALWAYS the clean, bright "Daylight"
 * look regardless of the device's Light/Dark setting — the founder's reference. `@blue-bee/ui`'s own
 * `useTheme()` follows `useColorScheme()` (correct for driver/owner, which DO track the OS), so customer
 * exports its OWN `useTheme()` here that deterministically returns the shared `lightTheme` — exactly what
 * the (now-deleted) local `ThemeProvider` did, but without a context provider. This pins every
 * customer-AUTHORED component (all screens + the specialized components below) to light in ALL
 * environments (dev, tests, native builds), independent of any native config — and it is covered by the
 * app's test suite.
 *
 * The SHARED `@blue-bee/ui` primitives (`Button`/`Card`/`Badge`/`Input`/`Text`/`StatTile`) call
 * `@blue-bee/ui`'s own `useColorScheme()`-based `useTheme()` internally — there is NO injection point for a
 * consumer to override that from app-land (and modifying the shared hook is out of scope: driver/owner
 * intentionally track the OS). Those primitives are kept light by the NATIVE mechanism instead:
 * `expo.userInterfaceStyle: "light"` in app.json, which iOS enforces via Info.plist on its own and Android
 * applies via the `expo-system-ui` dependency (added for exactly this) — so `useColorScheme()` resolves to
 * light in the native build. See the report's disclosure for what this does / does NOT verify from CI.
 *
 * On top of the shared layer, customer keeps two small local extras:
 *  - `useGlass()` — the `glass`/`blurTint` fields for the customer-only frosted-glass UI (see ./glass).
 *  - `useEntrance()`/`usePulse()` — the booking-flow stagger + live-marker pulse hooks (see ./motion).
 */

import {
  lightTheme,
  darkTheme,
  buildTheme,
  usePressScale,
  useReducedMotion,
  type Theme,
  type ThemeColors,
  type Scheme,
  type TypeVariant,
} from '@blue-bee/ui';

/** The customer surface is pinned to the LIGHT Daylight palette (founder's reference), deterministically. */
export function useTheme(): Theme {
  return lightTheme;
}

export { lightTheme, darkTheme, buildTheme, usePressScale, useReducedMotion };
export type { Theme, ThemeColors, Scheme, TypeVariant };
export { useEntrance, usePulse } from './motion';
export { useGlass, type GlassTokens } from './glass';
