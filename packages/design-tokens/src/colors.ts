/**
 * Daylight — color tokens (light + dark).
 *
 * These are the founder's canonical values (see docs/design/DESIGN-LANGUAGE.md). The reskin
 * branches currently mirror these locally; this package is the single typed source they will
 * reconcile to. Values are reproduced EXACTLY — do not "round" or invent variants.
 *
 * Honesty note on the light/dark asymmetry: the light scale ships the full interaction set
 * (primary hover/active + per-status tints); the dark scale ships only what the system defines
 * for dark (primary + primary tint). Optional fields below capture that faithfully rather than
 * fabricating dark-mode hovers/tints that the system does not specify.
 */

export interface ColorScale {
  /** App background — the page/screen canvas. */
  canvas: string;
  /** A faintly recessed background (grouped rows, inset panels). */
  subtle: string;
  /** Raised surface (cards, sheets, inputs). */
  surface: string;
  /** 1px separators / borders. */
  hairline: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  /** Brand action color. */
  primary: string;
  /** Pressed-target hover (light only). */
  primaryHover?: string;
  /** Pressed-target active (light only). */
  primaryActive?: string;
  /** Low-emphasis primary background (selected rows, ghost buttons). */
  primaryTint: string;

  accent: string;
  accentTint?: string;
  success: string;
  successTint?: string;
  warning: string;
  warningTint?: string;
  danger: string;
  dangerTint?: string;
}

export const light: ColorScale = {
  canvas: '#FBFCFE',
  subtle: '#F4F7FB',
  surface: '#FFFFFF',
  hairline: '#E5EAF1',

  textPrimary: '#0A2540',
  textSecondary: '#5A6B82',
  textTertiary: '#8A99AE',

  primary: '#0B5FFF',
  primaryHover: '#0A54E0',
  primaryActive: '#0848C2',
  primaryTint: '#E8F0FF',

  accent: '#FFB020',
  accentTint: '#FFF6E6',
  success: '#14B86A',
  successTint: '#E5F7EE',
  warning: '#F59E0B',
  warningTint: '#FFF4E0',
  danger: '#E5484D',
  dangerTint: '#FCEBEC',
};

export const dark: ColorScale = {
  canvas: '#0A0E1A',
  subtle: '#111728',
  surface: '#141B2D',
  hairline: 'rgba(255,255,255,0.08)',

  textPrimary: '#EAF0F8',
  textSecondary: '#9DB0C9',
  textTertiary: '#6B7C96',

  primary: '#3D8BFF',
  primaryTint: 'rgba(61,139,255,0.16)',

  accent: '#FFC34D',
  success: '#2DD583',
  warning: '#FFC34D',
  danger: '#FF6168',
};

export const color = { light, dark } as const;
