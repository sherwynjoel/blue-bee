/**
 * @blue-bee/design-tokens — the canonical "Daylight" design tokens.
 *
 * Pure TypeScript constants (no React, no platform imports) shared by the web (Tailwind) and the
 * Expo apps. The in-repo prose home of the system is docs/design/DESIGN-LANGUAGE.md; these values
 * are its machine-readable counterpart and must stay in lock-step.
 */
export { type ColorScale, light, dark, color } from './colors';
export {
  type SpaceToken,
  type RadiusToken,
  type FontSizeToken,
  type TypeStyle,
  space,
  radius,
  fontSize,
} from './scale';
export { type ShadowScale, type Motion, shadow, motion } from './effects';
export { type TailwindPreset, tailwindPreset } from './tailwind-preset';

import { color } from './colors';
import { space, radius, fontSize } from './scale';
import { shadow, motion } from './effects';

/** The whole system as one object, for consumers that prefer a single import. */
export const tokens = {
  color,
  space,
  radius,
  fontSize,
  shadow,
  motion,
} as const;

export type Tokens = typeof tokens;
