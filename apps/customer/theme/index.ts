/**
 * The customer app's theme surface.
 *
 * COLORS + the type/space/radius/elevation/motion scales now come from the ONE canonical, Royal-Dry-
 * Cleaning-branded source — `@blue-bee/ui`'s theme layer (which reads `@blue-bee/design-tokens`) — shared
 * with driver/owner. Customer's former local `theme.ts` mirror is deleted; nothing hard-codes tokens.
 *
 * On top of the shared layer, customer keeps two small local extras:
 *  - `useGlass()` — the `glass`/`blurTint` fields for the customer-only frosted-glass UI (see ./glass).
 *  - `useEntrance()`/`usePulse()` — the booking-flow stagger + live-marker pulse hooks (see ./motion).
 *
 * `useTheme()` is `@blue-bee/ui`'s provider-less hook (reads `useColorScheme()` directly). The customer
 * surface is kept LIGHT via `expo.userInterfaceStyle: "light"` in app.json (forces the OS scheme to light
 * for the native build), so there is no <ThemeProvider> to mount — matching the driver/owner pattern.
 */

export {
  useTheme,
  usePressScale,
  useReducedMotion,
  buildTheme,
  lightTheme,
  darkTheme,
  type Theme,
  type ThemeColors,
  type Scheme,
  type TypeVariant,
} from '@blue-bee/ui';
export { useEntrance, usePulse } from './motion';
export { useGlass, type GlassTokens } from './glass';
