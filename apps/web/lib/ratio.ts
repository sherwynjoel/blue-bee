/**
 * Display-side plausibility guard for rate metrics (console demo-polish).
 *
 * The analytics endpoints already wrap every number in a {@link Metric} with honest provenance, but a
 * *computed-from-real-rows* ratio can still be physically implausible when its denominator collapses
 * toward zero — e.g. seeded / e2e route-stops created with `arrivedAt ≈ completedAt` make the
 * on-site-hours denominator of `stops/hour` tiny, so the ratio explodes to absurd values (~195,652).
 *
 * This is **defense-in-depth + honest formatting**, NOT a cover-up: the value's source is fixed at the
 * data layer. Here we refuse to *show* a number we know is meaningless and instead state
 * "n/a (insufficient data)" plainly, while surfacing the raw computed figure in {@link RateGuard.reason}
 * (tooltip) so the underlying problem is disclosed, never hidden behind a fake-clean number.
 */

import { formatNumber } from './format';

/**
 * Ceiling above which a stops/hour figure is treated as "insufficient data" rather than a real rate.
 *
 * A physical route stop (arrive → service → depart) takes minutes; even an aggressive concierge
 * micro-stop cadence tops out well under ~60 stops/active-hour. 100 is a deliberately generous ceiling
 * — comfortably above any real field value, so honest data is never suppressed — while still catching
 * the denominator-collapse artifact, which lands orders of magnitude higher.
 */
export const MAX_PLAUSIBLE_STOPS_PER_HOUR = 100;

export interface RateGuard {
  /** True when the value is a finite, non-negative rate within the plausibility ceiling. */
  plausible: boolean;
  /** The original computed value, echoed for transparency. */
  raw: number;
  /** Hover/tooltip text: blank when plausible; the honest disclosure of the flagged figure otherwise. */
  reason: string;
}

/**
 * Decide whether a computed rate is plausible enough to display. When it isn't, the caller should show
 * an honest "n/a (insufficient data)" and expose {@link RateGuard.reason} as the tooltip.
 */
export function guardRate(value: number, opts: { max: number; unit: string }): RateGuard {
  const plausible = Number.isFinite(value) && value >= 0 && value <= opts.max;
  if (plausible) return { plausible: true, raw: value, reason: '' };
  return {
    plausible: false,
    raw: value,
    reason: `Computed ${formatNumber(value)} ${opts.unit}, which is implausibly high (> ${formatNumber(
      opts.max,
    )}). The on-site-time denominator is too small to be reliable, so this is shown as insufficient data rather than a misleading number.`,
  };
}

/** The {@link guardRate} preset for the operational "Stops / hour" metric. */
export function guardStopsPerHour(value: number): RateGuard {
  return guardRate(value, { max: MAX_PLAUSIBLE_STOPS_PER_HOUR, unit: 'stops/hr' });
}
