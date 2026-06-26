import { Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';

/**
 * "Daylight" — the Blue Bee operator design system (driver + owner share one identical theme so the
 * two apps read as one family). Confident, glanceable, high-contrast, one-handed-friendly: premium but
 * utilitarian. Light + dark are first-class; the active palette follows the OS via `useColorScheme()`
 * (both apps set `userInterfaceStyle: "automatic"`).
 *
 * This file is intentionally byte-identical between apps/driver and apps/owner — keep it that way; it
 * reconciles to `packages/design-tokens` at merge. Domain-specific colour mapping (status → tone) lives
 * in the screens, so this stays a pure token surface.
 */

export type Scheme = 'light' | 'dark';

export interface ThemeColors {
  /** App background (behind everything). */
  canvas: string;
  /** A faintly recessed fill (grouped backgrounds, inset rows). */
  subtle: string;
  /** Cards / sheets / raised surfaces. */
  surface: string;
  /** Pressed/active surface tint. */
  surfacePressed: string;
  /** 1px separators + card borders. */
  hairline: string;
  /** Primary / secondary / tertiary text. */
  text: string;
  textMuted: string;
  textFaint: string;
  /** Brand primary (the action colour). */
  azure: string;
  azureTint: string;
  /** Readable azure for text-on-tint / KPI figures (darker than the brand fill for AA contrast). */
  azureInk: string;
  /** Brand secondary accent (warmth / highlights). */
  honey: string;
  honeyTint: string;
  honeyInk: string;
  /** Semantic. */
  success: string;
  successTint: string;
  successInk: string;
  warning: string;
  warningTint: string;
  warningInk: string;
  danger: string;
  dangerTint: string;
  dangerInk: string;
  /** Text on a solid azure fill / on a honey fill. */
  onAzure: string;
  onHoney: string;
  /** Modal scrim. */
  scrim: string;
  /** Skeleton base + highlight. */
  skeleton: string;
  skeletonHighlight: string;
}

const light: ThemeColors = {
  canvas: '#FBFCFE',
  subtle: '#F4F7FB',
  surface: '#FFFFFF',
  surfacePressed: '#EEF3FA',
  hairline: '#E5EAF1',
  text: '#0A2540',
  textMuted: '#5A6B82',
  textFaint: '#61738E',
  azure: '#0B5FFF',
  azureTint: '#E8F0FF',
  azureInk: '#0A54E6',
  honey: '#FFB020',
  honeyTint: '#FFF6E6',
  honeyInk: '#8A5A00',
  success: '#14B86A',
  successTint: '#E4F7EE',
  successInk: '#0B7A45',
  warning: '#F59E0B',
  warningTint: '#FEF4E6',
  warningInk: '#8A5C00',
  danger: '#E5484D',
  dangerTint: '#FCEBEC',
  dangerInk: '#C5363B',
  onAzure: '#FFFFFF',
  onHoney: '#3A2A00',
  scrim: 'rgba(10,37,64,0.45)',
  skeleton: '#E9EEF5',
  skeletonHighlight: '#F4F7FB',
};

const dark: ThemeColors = {
  canvas: '#0A0E1A',
  subtle: '#111728',
  surface: '#141B2D',
  surfacePressed: '#1B2438',
  hairline: 'rgba(255,255,255,0.08)',
  text: '#EAF0F8',
  textMuted: '#9DB0C9',
  textFaint: '#6B7C96',
  azure: '#3D8BFF',
  azureTint: 'rgba(61,139,255,0.16)',
  azureInk: '#3D8BFF',
  honey: '#FFC34D',
  honeyTint: 'rgba(255,195,77,0.14)',
  honeyInk: '#FFC34D',
  success: '#2DD583',
  successTint: 'rgba(45,213,131,0.16)',
  successInk: '#2DD583',
  warning: '#FFC34D',
  warningTint: 'rgba(255,195,77,0.14)',
  warningInk: '#FFC34D',
  danger: '#FF6168',
  dangerTint: 'rgba(255,97,104,0.16)',
  dangerInk: '#FF6168',
  onAzure: '#FFFFFF',
  onHoney: '#1A1200',
  scrim: 'rgba(0,0,0,0.6)',
  skeleton: '#1B2438',
  skeletonHighlight: '#222D45',
};

export const palette: Record<Scheme, ThemeColors> = { light, dark };

/** SF Pro is the system face; counts/ETAs/IDs/timestamps use tabular figures (and true mono for IDs). */
export const fonts = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
} as const;

/** Apply tabular figures to any numeric Text so counts/ETAs don't jitter as they update. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** The iOS type ramp (pt / line-height / weight), used through the kit's <Text variant=…>. */
export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: 0.2 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.2 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  title3: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.7 },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof typography;

/** 8pt spacing scale (4 is the half-step). */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** Corner radii — cards 16, buttons 14, inputs 12, sheets 24. */
export const radius = { sm: 10, input: 12, button: 14, card: 16, sheet: 24, pill: 999 } as const;

/** Minimum one-handed / glove-friendly touch target (driver action is larger still). */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TARGET = 48;

const shadows: Record<Scheme, { card: ViewStyle; raised: ViewStyle }> = {
  light: {
    card: { shadowColor: '#0A2540', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
    raised: { shadowColor: '#0A2540', shadowOpacity: 0.1, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  },
  dark: {
    card: { shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
    raised: { shadowColor: '#000000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  },
};

export interface Theme {
  scheme: Scheme;
  isDark: boolean;
  color: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof typography;
  font: typeof fonts;
  shadow: { card: ViewStyle; raised: ViewStyle };
}

/** The semantic tone vocabulary shared by Badge / StatusPill / Toast. */
export type Tone = 'azure' | 'honey' | 'success' | 'warning' | 'danger' | 'neutral';

/** Resolve a tone to its on-tint text (ink), its tint background, and its solid fill. */
export function toneColors(c: ThemeColors, t: Tone): { ink: string; bg: string; solid: string } {
  switch (t) {
    case 'azure':
      return { ink: c.azureInk, bg: c.azureTint, solid: c.azure };
    case 'honey':
      return { ink: c.honeyInk, bg: c.honeyTint, solid: c.honey };
    case 'success':
      return { ink: c.successInk, bg: c.successTint, solid: c.success };
    case 'warning':
      return { ink: c.warningInk, bg: c.warningTint, solid: c.warning };
    case 'danger':
      return { ink: c.dangerInk, bg: c.dangerTint, solid: c.danger };
    case 'neutral':
    default:
      return { ink: c.textMuted, bg: c.subtle, solid: c.textMuted };
  }
}

/** The one hook every component uses. Re-renders when the OS light/dark setting flips. */
export function useTheme(): Theme {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return {
    scheme,
    isDark: scheme === 'dark',
    color: palette[scheme],
    spacing,
    radius,
    type: typography,
    font: fonts,
    shadow: shadows[scheme],
  };
}
