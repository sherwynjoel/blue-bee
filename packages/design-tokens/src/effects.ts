/**
 * Daylight — elevation (shadows) and motion.
 *
 * Shadows are tuned for the LIGHT canvas (cool, low-spread, depth-not-decoration). e1→e3 is a
 * resting→raised→floating ramp; `focus` is the accessible focus ring. Dark mode leans on the
 * surface color steps (canvas→subtle→surface) for elevation rather than shadows.
 *
 * Motion: short, content-respecting durations with two easings — `standard` for most UI moves,
 * `emphasized` for entrances/sheets — plus a spring spec for RN/Reanimated gestures.
 */

export interface ShadowScale {
  /** Resting elevation (cards at rest). */
  e1: string;
  /** Raised (hovered cards, popovers). */
  e2: string;
  /** Floating (sheets, modals, menus). */
  e3: string;
  /** Accessible focus ring. */
  focus: string;
}

export const shadow: ShadowScale = {
  e1: '0 1px 2px rgba(10,37,64,.06), 0 1px 3px rgba(10,37,64,.04)',
  e2: '0 4px 12px rgba(10,37,64,.08)',
  e3: '0 12px 32px rgba(10,37,64,.14)',
  focus: '0 0 0 3px rgba(11,95,255,.35)',
};

export interface Motion {
  /** Durations in ms. */
  durations: { fast: number; base: number; slow: number; sheet: number };
  /** CSS cubic-bezier easing curves. */
  easing: { standard: string; emphasized: string };
  /** Spring spec for RN/Reanimated gesture-driven motion. */
  spring: { damping: number; stiffness: number; mass: number };
}

export const motion: Motion = {
  durations: { fast: 120, base: 200, slow: 320, sheet: 400 },
  easing: {
    standard: 'cubic-bezier(.2,.8,.2,1)',
    emphasized: 'cubic-bezier(.16,1,.3,1)',
  },
  spring: { damping: 18, stiffness: 180, mass: 1 },
};
