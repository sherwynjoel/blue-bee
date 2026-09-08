import { lightTheme } from '@blue-bee/ui';

/**
 * Customer-local glass tokens.
 *
 * `glass` (the translucent blur-fallback fill) and `blurTint` (the tint passed to expo-blur) were the two
 * fields customer's old local `ThemeColors` carried that the shared canonical `ColorScale`
 * (`@blue-bee/design-tokens`) deliberately omits: driver/owner have NO frosted-glass UI (confirmed — no
 * `expo-blur` import in either app), so promoting these to the shared scale would be dead weight there.
 * Per the design's Open Item resolution, they live here as a tiny customer-local extension layered on top
 * of the shared theme — `Glass.tsx` reads its surface `colors`/`radius` from `@blue-bee/ui`'s `useTheme()`
 * and pulls just these two fields from `useGlass()`. Values are verbatim from customer's old `theme.ts`.
 *
 * Customer is pinned to the LIGHT palette (see theme/index.ts), so glass resolves deterministically off
 * the shared `lightTheme` — never `useColorScheme()` — matching every other customer-authored surface.
 */

const glassLight = { glass: 'rgba(255,255,255,0.72)', blurTint: 'light' as const };
const glassDark = { glass: 'rgba(20,27,45,0.72)', blurTint: 'dark' as const };

export interface GlassTokens {
  /** Translucent surface used as the blur-fallback fill on glass elements. */
  glass: string;
  /** Tint passed to expo-blur ('light' | 'dark'). */
  blurTint: 'light' | 'dark';
}

/** The glass tokens for the customer's pinned (light) scheme. */
export function useGlass(): GlassTokens {
  return lightTheme.isDark ? glassDark : glassLight;
}
