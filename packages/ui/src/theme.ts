import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';
import { color, type ColorScale } from '@blue-bee/design-tokens';

/**
 * Daylight — the shared theme layer for every Blue Bee RN app (customer/driver/owner).
 *
 * COLORS come from `@blue-bee/design-tokens` (the single canonical, Royal-Dry-Cleaning source, shared
 * with the web console). The RN-shaped scales below (`type` as RN `TextStyle`, `space`/`radius` as the
 * semantic control/card tokens, `elevation` as RN `ViewStyle` shadows, `motion` for RN `Animated`) are
 * kept here on purpose: design-tokens' `scale`/`effects` are web-oriented (numeric/t-shirt keys, em
 * tracking, CSS box-shadow strings) and don't match what RN components consume (`radius.button`,
 * `space.lg`, RN `TextStyle`, `ViewStyle`). Pulling them from design-tokens would break typing AND
 * change the type ramp (a visual regression the project explicitly forbids). This file therefore
 * consumes design-tokens for the one part that genuinely reconciles — colors — and stays the RN home
 * of the type/space/radius/elevation/motion values (customer's canonical values, which ARE the Royal
 * Dry Cleaning set, plus driver/owner's `overline` type variant and `radius.sm`).
 *
 * `useTheme()` follows driver/owner's provider-LESS pattern: it reads `useColorScheme()` directly, so
 * light⇄dark tracks the OS with no <ThemeProvider> to mount (preserved verbatim per the design).
 */

export type Scheme = 'light' | 'dark';

/** The canonical color scale (from @blue-bee/design-tokens). Re-exported so consumers type against it. */
export type ThemeColors = ColorScale;

// ───────────────────────────── type scale (RN TextStyle) ─────────────────────────────

/** A monospaced family for money / ETA / IDs — paired with tabular figures. */
export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string;

export type TypeVariant =
  | 'display'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'subhead'
  | 'footnote'
  | 'caption'
  | 'overline';

/**
 * pt size / line-height / weight — the Daylight scale. Customer's (most-recently-tuned) letter-spacing
 * values, plus driver/owner's `overline` variant (fontSize 12 / lineHeight 16 / weight 700 /
 * letterSpacing 0.7pt) so no app loses a variant it uses today.
 */
export const type: Record<TypeVariant, TextStyle> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: 0.37 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.36 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: 0.35 },
  title3: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: 0.38 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.41 },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400', letterSpacing: -0.41 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '500', letterSpacing: -0.24 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: -0.08 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0 },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.7 },
};

/** Tabular-figure style for money / ETA / IDs (apply alongside a type variant). */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };
/** Mono + tabular for IDs / ETAs that should read as data. */
export const monoTabular: TextStyle = { fontFamily: MONO, fontVariant: ['tabular-nums'] };

// ───────────────────────────── spacing (8pt rhythm) ─────────────────────────────

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

/** Default screen horizontal padding (16–20 per spec). */
export const SCREEN_PADDING = 20;
/** Default card inner padding. */
export const CARD_PADDING = 16;

// ───────────────────────────── radius ─────────────────────────────

/** Corner radii. `sm` is driver/owner's plain small radius (customer lacked it — added per the design). */
export const radius = {
  sm: 10,
  input: 12,
  button: 14,
  card: 16,
  sheet: 24,
  pill: 999,
} as const;

// ───────────────────────────── elevation (soft, theme-aware) ─────────────────────────────

export interface Elevation {
  e1: ViewStyle;
  e2: ViewStyle;
  sheet: ViewStyle;
}

const lightElevation: Elevation = {
  e1: {
    shadowColor: '#0A2540',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  e2: {
    shadowColor: '#0A2540',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 6,
  },
  sheet: {
    shadowColor: '#0A2540',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 16,
  },
};

// In dark mode shadows read weakly; lean on deeper, larger shadows + the surface step for lift.
const darkElevation: Elevation = {
  e1: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 1,
  },
  e2: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 6,
  },
  sheet: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.55,
    shadowRadius: 28,
    elevation: 18,
  },
};

// ───────────────────────────── motion ─────────────────────────────

/**
 * Daylight motion. Springs tuned to damping ~18 / stiffness ~180 (calm, premium, no overshoot),
 * implemented on RN's built-in `Animated` (zero extra native deps). All motion respects reduced-motion
 * (see `usePressScale` / `useEntrance` / `usePulse`).
 */
export const motion = {
  spring: { damping: 18, stiffness: 180, mass: 1, useNativeDriver: true },
  /** A snappier spring for press feedback. */
  springPress: { damping: 20, stiffness: 320, mass: 1, useNativeDriver: true },
  /** Press-down scale for primary controls. */
  pressScale: 0.97,
  /** Timing fallbacks (ms) for opacity/entrance where a spring isn't natural. */
  durationFast: 140,
  durationBase: 240,
  /** Per-item delay for list stagger-in. */
  staggerStep: 45,
  staggerMax: 8,
} as const;

// ───────────────────────────── touch-target constants (driver/owner) ─────────────────────────────

/** Minimum one-handed / glove-friendly touch-target hit slop. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
/** Minimum touch-target size (pt). */
export const MIN_TARGET = 48;

// ───────────────────────────── tone helper (driver/owner) ─────────────────────────────

/** The semantic tone vocabulary shared by Badge / StatusPill / Toast. */
export type Tone = 'azure' | 'honey' | 'success' | 'warning' | 'danger' | 'neutral';

/**
 * Resolve a tone to its on-tint text (ink), its tint background, and its solid fill. Field names are the
 * reconciled ones: `*Ink` → `on*Tint`, `textMuted` → `textSecondary`.
 */
export function toneColors(c: ThemeColors, t: Tone): { ink: string; bg: string; solid: string } {
  switch (t) {
    case 'azure':
      return { ink: c.onAzureTint, bg: c.azureTint, solid: c.azure };
    case 'honey':
      return { ink: c.onHoneyTint, bg: c.honeyTint, solid: c.honey };
    case 'success':
      return { ink: c.onSuccessTint, bg: c.successTint, solid: c.success };
    case 'warning':
      return { ink: c.onWarningTint, bg: c.warningTint, solid: c.warning };
    case 'danger':
      return { ink: c.onDangerTint, bg: c.dangerTint, solid: c.danger };
    case 'neutral':
    default:
      return { ink: c.textSecondary, bg: c.subtle, solid: c.textSecondary };
  }
}

// ───────────────────────────── assembled theme ─────────────────────────────

export interface Theme {
  scheme: Scheme;
  isDark: boolean;
  colors: ThemeColors;
  type: Record<TypeVariant, TextStyle>;
  tabular: TextStyle;
  monoTabular: TextStyle;
  space: typeof space;
  radius: typeof radius;
  elevation: Elevation;
  motion: typeof motion;
  screenPadding: number;
  cardPadding: number;
}

export function buildTheme(scheme: Scheme): Theme {
  const isDark = scheme === 'dark';
  return {
    scheme,
    isDark,
    colors: color[scheme],
    type,
    tabular,
    monoTabular,
    space,
    radius,
    elevation: isDark ? darkElevation : lightElevation,
    motion,
    screenPadding: SCREEN_PADDING,
    cardPadding: CARD_PADDING,
  };
}

export const lightTheme = buildTheme('light');
export const darkTheme = buildTheme('dark');

/**
 * The one hook every component uses. Reads the OS light/dark setting directly (no ThemeProvider — the
 * driver/owner pattern, preserved), so it re-renders when the OS scheme flips.
 */
export function useTheme(): Theme {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return scheme === 'dark' ? darkTheme : lightTheme;
}

// ───────────────────────────── motion hooks ─────────────────────────────

/** Live OS "Reduce Motion" preference (with change subscription). */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    // Guard the result shape: some environments (jest) return undefined rather than a Promise.
    const probe = AccessibilityInfo.isReduceMotionEnabled?.();
    if (probe && typeof (probe as Promise<boolean>).then === 'function') {
      (probe as Promise<boolean>).then((v) => mounted && setReduce(!!v)).catch(() => undefined);
    }
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

/**
 * Press-scale feedback for primary controls (scale → .97 on press, spring back on release). Returns a
 * `transform` to spread onto an `Animated.View` plus the press handlers. No-op under reduced motion.
 */
export function usePressScale(enabled = true): {
  scale: Animated.Value;
  transform: { scale: Animated.Value }[];
  onPressIn: () => void;
  onPressOut: () => void;
} {
  const reduce = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(() => {
    if (reduce || !enabled) return;
    Animated.spring(scale, { toValue: motion.pressScale, ...motion.springPress }).start();
  }, [reduce, enabled, scale]);

  const onPressOut = useCallback(() => {
    if (reduce || !enabled) return;
    Animated.spring(scale, { toValue: 1, ...motion.springPress }).start();
  }, [reduce, enabled, scale]);

  return { scale, transform: [{ scale }], onPressIn, onPressOut };
}
