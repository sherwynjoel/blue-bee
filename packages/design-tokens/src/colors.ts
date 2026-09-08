/**
 * Daylight — color tokens (light + dark), Royal Dry Cleaning brand.
 *
 * These are the founder's canonical values (see docs/design/DESIGN-LANGUAGE.md). Every RN app and
 * the web console read colors from here — this is the single typed source; nothing hard-codes a hex
 * outside this file. Token names (azure/honey) match what's already live in production across all
 * three mobile apps — see docs/superpowers/specs/2026-09-08-shared-ui-design-tokens-design.md for
 * why these names were kept over the generic primary/accent names this file used to have.
 *
 * `onXTint` fields are the legible foreground for text drawn ON that status's pale tint background —
 * in light mode these are deep shades of the hue (the bright semantic color fails contrast on its own
 * tint); in dark mode they're the bright hue (reads fine on the dark translucent tint). Use the bright
 * `success/warning/danger/honey`/`azure` values only for fills, icons, dots, and borders — never for
 * text on the matching tint.
 */

export interface ColorScale {
  /** App background — the page/screen canvas. */
  canvas: string;
  /** A faintly recessed background (grouped rows, inset panels). */
  subtle: string;
  /** Raised surface (cards, sheets, inputs). */
  surface: string;
  /** Pressed/active surface tint (list rows, buttons mid-press). */
  surfacePressed: string;
  /** 1px separators / borders. */
  hairline: string;

  text: string;
  textSecondary: string;
  textTertiary: string;

  /** Brand primary — the crest's royal blue. */
  azure: string;
  /** Azure wash (selected chips, info cards, marker halo). */
  azureTint: string;
  /** Brand accent — the crown's gold. */
  honey: string;
  /** Honey wash. */
  honeyTint: string;

  success: string;
  successTint: string;
  warning: string;
  warningTint: string;
  danger: string;
  dangerTint: string;

  /** Text drawn ON a solid azure / honey fill (contrast-safe). */
  onAzure: string;
  onHoney: string;

  /** Legible foregrounds for text on the matching pale TINT (see file doc comment above). */
  onAzureTint: string;
  onSuccessTint: string;
  onWarningTint: string;
  onDangerTint: string;
  onHoneyTint: string;

  /** Modal scrim behind sheets. */
  scrim: string;
  /** Skeleton loading-state base + highlight. */
  skeleton: string;
  skeletonHighlight: string;
}

export const light: ColorScale = {
  canvas: '#F4F6FB',
  subtle: '#EAEFF7',
  surface: '#FFFFFF',
  surfacePressed: '#EEF3FA',
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
  skeleton: '#E9EEF5',
  skeletonHighlight: '#F4F7FB',
};

export const dark: ColorScale = {
  canvas: '#0A0E1A',
  subtle: '#111728',
  surface: '#141B2D',
  surfacePressed: '#1B2438',
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
  skeleton: '#1B2438',
  skeletonHighlight: '#222D45',
};

export const color = { light, dark } as const;
