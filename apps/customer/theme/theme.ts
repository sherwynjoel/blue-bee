import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Daylight — the Royal Dry Cleaning & Laundry customer-app design system (premium, Apple-grade).
 *
 * This is the LOCAL mirror of the Daylight tokens. The shared `packages/design-tokens` lands on
 * another branch; until then these exact values live here and are reconciled at merge. Light + dark
 * are resolved at runtime from `useColorScheme()` (see ThemeProvider) — every token below has a
 * parity value in both palettes so dark mode is a first-class surface, not an afterthought.
 *
 * Everything a screen needs is read through `useTheme()`; nothing hard-codes a hex.
 */

// ───────────────────────────── palette (exact Daylight values) ─────────────────────────────

export interface ThemeColors {
  /** App background (the furthest-back layer). */
  canvas: string;
  /** A subtly recessed fill (grouped-list backing, inset wells). */
  subtle: string;
  /** Raised surfaces — cards, sheets, inputs. */
  surface: string;
  /** 1px separators / card borders. */
  hairline: string;

  /** Primary text. */
  text: string;
  /** Secondary text (meta, captions). */
  textSecondary: string;
  /** Tertiary text (disabled, faint hints). */
  textTertiary: string;

  /** Brand primary — azure (primary actions, live, links). */
  azure: string;
  /** Azure wash (selected chips, info cards, marker halo). */
  azureTint: string;
  /** Brand accent — gold (the crown; destination, highlights, "needs your decision"). */
  honey: string;
  /** Honey wash. */
  honeyTint: string;

  success: string;
  successTint: string;
  warning: string;
  warningTint: string;
  danger: string;
  dangerTint: string;

  /** Text drawn ON azure / honey fills (contrast-safe). */
  onAzure: string;
  onHoney: string;

  /**
   * Legible foregrounds for semantic TEXT drawn on the matching *pale tint* (or a light surface). In
   * light mode these are deep shades of the hue (the bright semantic color fails contrast on its own
   * tint); in dark mode they are the bright hue (which reads fine on the dark translucent tint). Use
   * the bright `success/warning/danger/honey` only for fills, icons, dots, and borders.
   */
  onAzureTint: string;
  onSuccessTint: string;
  onWarningTint: string;
  onDangerTint: string;
  onHoneyTint: string;

  /** Modal scrim behind sheets. */
  scrim: string;
  /** Translucent surface used as the blur-fallback fill on glass elements. */
  glass: string;
  /** Tint passed to expo-blur ('light' | 'dark' | 'default'). */
  blurTint: 'light' | 'dark';
}

// Royal Dry Cleaning & Laundry brand: azure token now carries the crest's royal blue; honey now
// carries the crown's gold. Token NAMES are kept (azure/honey) as semantic slots used across ~15 files —
// only the values move — so nothing structural changes. Canvas is a cool light-grey so white cards lift.
const light: ThemeColors = {
  canvas: '#F4F6FB',
  subtle: '#EAEFF7',
  surface: '#FFFFFF',
  hairline: '#E4E9F2',

  text: '#0A2540',
  textSecondary: '#5A6B82',
  textTertiary: '#8A99AE',

  azure: '#1E50C8',
  azureTint: '#E7ECFB',
  honey: '#DDA82E',
  honeyTint: '#FAF3DF',

  success: '#14B86A',
  successTint: '#E5F8EE',
  warning: '#F59E0B',
  warningTint: '#FEF3E2',
  danger: '#E5484D',
  dangerTint: '#FDECEC',

  onAzure: '#FFFFFF',
  onHoney: '#3D2C00',

  onAzureTint: '#1E50C8',
  onSuccessTint: '#0A7C46',
  onWarningTint: '#8A5300',
  onDangerTint: '#C42A1F',
  onHoneyTint: '#7A5800',

  scrim: 'rgba(10,37,64,0.45)',
  glass: 'rgba(255,255,255,0.72)',
  blurTint: 'light',
};

const dark: ThemeColors = {
  canvas: '#0A0E1A',
  subtle: '#111728',
  surface: '#141B2D',
  hairline: 'rgba(255,255,255,0.08)',

  text: '#EAF0F8',
  textSecondary: '#9DB0C9',
  textTertiary: '#6B7C96',

  azure: '#5B87F5',
  azureTint: 'rgba(91,135,245,0.18)',
  honey: '#E8B84D',
  honeyTint: 'rgba(232,184,77,0.16)',

  success: '#2DD583',
  successTint: 'rgba(45,213,131,0.16)',
  warning: '#FFC34D',
  warningTint: 'rgba(255,195,77,0.16)',
  danger: '#FF6168',
  dangerTint: 'rgba(255,97,104,0.16)',

  onAzure: '#FFFFFF',
  onHoney: '#241A00',

  onAzureTint: '#5B87F5',
  onSuccessTint: '#2DD583',
  onWarningTint: '#FFC34D',
  onDangerTint: '#FF6168',
  onHoneyTint: '#E8B84D',

  scrim: 'rgba(0,0,0,0.6)',
  glass: 'rgba(20,27,45,0.72)',
  blurTint: 'dark',
};

// ───────────────────────────── type scale (SF Pro via System) ─────────────────────────────

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
  | 'caption';

/** pt size / line-height / weight — the Daylight scale. Letter-spacing tuned for the larger sizes. */
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

export const radius = {
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
 * Daylight motion. Springs tuned to damping ~18 / stiffness ~180 (calm, premium, no overshoot).
 * Implemented on RN's built-in `Animated` (zero extra native deps; honors the exact spring physics) —
 * centralized here so the whole app swaps to `react-native-reanimated` in one place at the
 * design-tokens merge if desired. All motion respects reduced-motion (see theme/motion.ts).
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

// ───────────────────────────── assembled theme ─────────────────────────────

export type Scheme = 'light' | 'dark';

export interface Theme {
  scheme: Scheme;
  isDark: boolean;
  colors: ThemeColors;
  type: typeof type;
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
    colors: isDark ? dark : light,
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
