import { useTheme } from '@blue-bee/ui';

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
 */

const glassLight = { glass: 'rgba(255,255,255,0.72)', blurTint: 'light' as const };
const glassDark = { glass: 'rgba(20,27,45,0.72)', blurTint: 'dark' as const };

export interface GlassTokens {
  /** Translucent surface used as the blur-fallback fill on glass elements. */
  glass: string;
  /** Tint passed to expo-blur ('light' | 'dark'). */
  blurTint: 'light' | 'dark';
}

/** The glass tokens for the active scheme (follows the shared theme's light/dark resolution). */
export function useGlass(): GlassTokens {
  const { isDark } = useTheme();
  return isDark ? glassDark : glassLight;
}
