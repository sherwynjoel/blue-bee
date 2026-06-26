/**
 * Pure analytics-KPI helpers (Increment 15) — no I/O, unit-tested in `analytics-kpi.spec.ts`. The
 * analytics aggregations (`AnalyticsService`) are server-authoritative; these are the deterministic
 * bits (range parsing, divide-by-zero-safe rates, median, dwell, AR aging buckets) factored out so
 * they're provable without a DB. Money/on-time/business-day math is REUSED from `owner-kpi` (the
 * Inc-14a helpers) — not duplicated.
 */
import type { ArBucketLabel } from '@blue-bee/shared';

/** Re-export the shared money/on-time/window helpers so the analytics service has ONE import site. */
export { businessDayStart, formatMoney, onTimePercent, sumCents, toCents, windowEnd } from '../owner/owner-kpi';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Thrown by {@link parseRange} on a malformed/illogical window — the controller maps it to a 400. */
export class InvalidRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRangeError';
  }
}

/**
 * Parse & validate an analytics `[from, to)` window. Either bound may be omitted:
 *   • neither → the last `defaultDays` ending at `now`.
 *   • `from` only → `[from, now)`.
 *   • `to` only → `[to − defaultDays, to)`.
 * Bounds must be valid ISO instants with `from < to`. Throws {@link InvalidRangeError} otherwise.
 */
export function parseRange(
  fromRaw: string | undefined,
  toRaw: string | undefined,
  now: Date,
  defaultDays = 30,
): { from: Date; to: Date } {
  const parse = (raw: string, which: string): Date => {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new InvalidRangeError(`'${which}' is not a valid ISO-8601 date: ${raw}`);
    return d;
  };

  let to: Date;
  let from: Date;
  if (toRaw !== undefined) {
    to = parse(toRaw, 'to');
  } else if (fromRaw !== undefined) {
    to = now;
  } else {
    to = now;
  }
  if (fromRaw !== undefined) {
    from = parse(fromRaw, 'from');
  } else {
    from = new Date(to.getTime() - defaultDays * MS_PER_DAY);
  }

  if (from.getTime() >= to.getTime()) {
    throw new InvalidRangeError(`'from' (${from.toISOString()}) must be strictly before 'to' (${to.toISOString()})`);
  }
  return { from, to };
}

/**
 * A divide-by-zero-safe percentage: `numerator / denominator × 100`, rounded to a whole %. Returns
 * `null` when the denominator is 0 (nothing to measure) — NEVER a fake 0. `numerator` is clamped into
 * `[0, denominator]` defensively so a bad caller can't produce a >100% or negative rate.
 */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  const n = Math.max(0, Math.min(numerator, denominator));
  return Math.round((n / denominator) * 100);
}

/** A divide-by-zero-safe ratio (e.g. stops/hour), rounded to `decimals`. `null` when denominator ≤ 0. */
export function ratio(numerator: number, denominator: number, decimals = 2): number | null {
  if (denominator <= 0) return null;
  const f = 10 ** decimals;
  return Math.round((numerator / denominator) * f) / f;
}

/** The median of a list of numbers, or `null` when empty. (Average of the middle two for even counts.) */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Whole-and-fractional days spanned by `[from, to)` (always > 0 for a valid range). */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

/** Weeks spanned by `[from, to)`, floored at a small epsilon so a sub-week range never divides by ~0. */
export function weeksBetween(from: Date, to: Date): number {
  return Math.max((to.getTime() - from.getTime()) / MS_PER_WEEK, 1 / 7);
}

/** Whole months spanned by `[from, to)` (≈ days/30.4375), floored at 1 so monthly spend never blows up. */
export function monthsBetween(from: Date, to: Date): number {
  const months = (to.getTime() - from.getTime()) / (MS_PER_DAY * 30.4375);
  return Math.max(months, 1);
}

/**
 * The AR-aging bucket for an invoice `dueAt` as of `asOf`:
 *   not-yet-due (or no due date) → 'current'; else by age in days: ≤30 '1-30', ≤60 '31-60', ≤90 '61-90', else '90+'.
 */
export function agingBucket(dueAt: Date | null, asOf: Date): ArBucketLabel {
  if (dueAt === null) return 'current';
  const ageDays = (asOf.getTime() - dueAt.getTime()) / MS_PER_DAY;
  if (ageDays <= 0) return 'current';
  if (ageDays <= 30) return '1-30';
  if (ageDays <= 60) return '31-60';
  if (ageDays <= 90) return '61-90';
  return '90+';
}

/**
 * Average dwell (minutes) on site over stops with a measurable on-site interval. For each stop, the
 * interval is ARRIVED→DEPARTED (geofence) when both exist, else arrived→completed (RouteStop). Stops
 * with no measurable interval are excluded. `null` when none are measurable. Negative intervals
 * (clock skew / out-of-order events) are dropped.
 */
export function avgDwellMinutes(
  stops: Array<{ arrivedAt: Date | null; departedAt: Date | null }>,
): number | null {
  const durations = stops
    .filter((s) => s.arrivedAt != null && s.departedAt != null)
    .map((s) => (s.departedAt!.getTime() - s.arrivedAt!.getTime()) / MS_PER_MINUTE)
    .filter((m) => m >= 0);
  if (durations.length === 0) return null;
  const sum = durations.reduce((a, b) => a + b, 0);
  return Math.round((sum / durations.length) * 10) / 10;
}

/** Hours between two instants (drops negatives → 0). Used to total per-route active on-site time. */
export function hoursBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / (60 * MS_PER_MINUTE));
}
