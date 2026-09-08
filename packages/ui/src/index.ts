/**
 * @blue-bee/ui — the shared "Daylight" React Native component library.
 *
 * Consumed as raw TypeScript SOURCE by Metro (this package's `main`/`types` point at src), so the
 * editor, typecheck, jest, and the Metro bundler all resolve the same files. Task 3 extends this barrel
 * with the remaining primitives (Card / Badge / Input / StatTile / …) — don't treat it as final.
 */

export {
  useTheme,
  usePressScale,
  useReducedMotion,
  toneColors,
  buildTheme,
  lightTheme,
  darkTheme,
  HIT_SLOP,
  MIN_TARGET,
  type Theme,
  type ThemeColors,
  type Tone,
  type Scheme,
  type TypeVariant,
} from './theme';
export { fireHaptic, haptics, type HapticKind } from './haptics';
export { Text, type TextProps, type TextColor } from './Text';
export { Button, type ButtonProps, type ButtonTone, type ButtonVariant, type ButtonSize } from './Button';
