/**
 * Daylight — optional Tailwind preset for the web console / customer web.
 *
 * Derived from the token objects (not hand-duplicated) so it can never drift from them. Web can
 * adopt it later with `presets: [require('@blue-bee/design-tokens').tailwindPreset]`. Colors here
 * are the LIGHT scale (the default canvas); dark mode is layered on by web via the `dark:` variant
 * or CSS variables in a later reconciliation pass — this branch only publishes the values.
 */
import { light } from './colors';
import { space, radius, fontSize } from './scale';
import { shadow } from './effects';

export interface TailwindFontSizeTuple {
  0: string;
  1: { lineHeight: string; letterSpacing: string; fontWeight: string };
  length: 2;
}

export interface TailwindPreset {
  theme: {
    extend: {
      colors: Record<string, string | Record<string, string>>;
      spacing: Record<string, string>;
      borderRadius: Record<string, string>;
      boxShadow: Record<string, string>;
      fontSize: Record<string, [string, { lineHeight: string; letterSpacing: string; fontWeight: string }]>;
    };
  };
}

const spacing: Record<string, string> = {};
for (const [k, v] of Object.entries(space)) spacing[k] = `${v}px`;

const borderRadius: Record<string, string> = {};
for (const [k, v] of Object.entries(radius)) borderRadius[k] = `${v}px`;

const twFontSize: TailwindPreset['theme']['extend']['fontSize'] = {};
for (const [k, t] of Object.entries(fontSize)) {
  twFontSize[k] = [`${t.size}px`, { lineHeight: `${t.lineHeight}px`, letterSpacing: `${t.tracking}em`, fontWeight: String(t.weight) }];
}

export const tailwindPreset: TailwindPreset = {
  theme: {
    extend: {
      colors: {
        canvas: light.canvas,
        subtle: light.subtle,
        surface: light.surface,
        hairline: light.hairline,
        text: {
          DEFAULT: light.text,
          secondary: light.textSecondary,
          tertiary: light.textTertiary,
        },
        azure: {
          DEFAULT: light.azure,
          tint: light.azureTint,
        },
        honey: { DEFAULT: light.honey, tint: light.honeyTint },
        success: { DEFAULT: light.success, tint: light.successTint },
        warning: { DEFAULT: light.warning, tint: light.warningTint },
        danger: { DEFAULT: light.danger, tint: light.dangerTint },
      },
      spacing,
      borderRadius,
      boxShadow: { ...shadow },
      fontSize: twFontSize,
    },
  },
};
