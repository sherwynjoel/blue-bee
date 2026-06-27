/**
 * Daylight — spacing, radius, and the type scale.
 *
 * `space` is an 8pt rhythm (with 2/4px half-steps for tight optical work). `radius` runs from
 * controls (xs/sm) to cards/sheets (md..2xl) to fully-round (pill). `fontSize` is a semantic
 * type ramp: each role carries size + lineHeight (px) + weight + tracking (em).
 */

/** 8pt spacing rhythm (px). Keys are the step name; 0.5/1/2 are the fine half-steps. */
export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;
export type SpaceToken = keyof typeof space;

/** Corner radii (px). `pill` is effectively fully-round. */
export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 28,
  pill: 999,
} as const;
export type RadiusToken = keyof typeof radius;

export interface TypeStyle {
  /** Font size in px. */
  size: number;
  /** Line height in px. */
  lineHeight: number;
  /** Font weight (numeric). */
  weight: number;
  /** Letter-spacing in em. */
  tracking: number;
}

/** Semantic type ramp (px sizes/line-heights; tracking in em). */
export const fontSize = {
  display: { size: 34, lineHeight: 40, weight: 700, tracking: -0.02 },
  title1: { size: 28, lineHeight: 34, weight: 700, tracking: -0.02 },
  title2: { size: 22, lineHeight: 28, weight: 600, tracking: -0.01 },
  title3: { size: 20, lineHeight: 26, weight: 600, tracking: -0.01 },
  headline: { size: 17, lineHeight: 22, weight: 600, tracking: 0 },
  body: { size: 16, lineHeight: 24, weight: 400, tracking: 0 },
  subhead: { size: 15, lineHeight: 20, weight: 500, tracking: 0 },
  footnote: { size: 13, lineHeight: 18, weight: 400, tracking: 0 },
  caption: { size: 12, lineHeight: 16, weight: 500, tracking: 0.01 },
} as const satisfies Record<string, TypeStyle>;
export type FontSizeToken = keyof typeof fontSize;
