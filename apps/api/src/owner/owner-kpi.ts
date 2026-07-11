/**
 * Pure owner-KPI helpers (Increment 14a) — no I/O, unit-tested in `owner-kpi.spec.ts`. The owner
 * dashboard aggregation (`OwnerService.today`) is server-authoritative; these are the deterministic
 * bits (the business-day window, money summation, on-time math) factored out so they're provable
 * without a DB.
 *
 * [Inc-28] The wall-clock↔UTC conversion this file used to own privately now lives in `common/tz.ts`,
 * shared with the pickup-availability slot generator. Both must agree on what "9am in Toronto" means,
 * and a second implementation is how the booked window and the on-time KPI come to disagree.
 */
import { wallParts, zonedWallTimeToUtc } from '../common/tz';

/**
 * The UTC instant of the start of `now`'s calendar day in `tz` (the GTA business day,
 * `America/Toronto`).
 *
 * [Inc-28] Exact across DST as well: `zonedWallTimeToUtc` re-reads the zone offset at the resolved
 * instant, where the previous single-pass version read it at `now` and drifted by an hour when `now`
 * sat on the far side of a transition from local midnight. Behaviour is unchanged on every other day
 * (the specs below are untouched).
 */
export function businessDayStart(now: Date, tz: string): Date {
  const p = wallParts(now, tz);
  return zonedWallTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
}

/** Parse a fixed-2 (or any) dollar string to integer cents (round-half-up). NaN-safe → 0. */
export function toCents(dollars: string): number {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Sum dollar strings exactly in integer cents (no float drift). */
export function sumCents(values: string[]): number {
  return values.reduce((acc, v) => acc + toCents(v), 0);
}

/** Format integer cents back to a fixed-2 dollar string. */
export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * On-time % over completed stops that carried a delivery/pickup window: the fraction completed by the
 * window end. `null` when none of the stops had a window (nothing to measure). Rounded to a whole %.
 */
export function onTimePercent(stops: Array<{ completedAt: Date | null; windowEnd: Date | null }>): number | null {
  const measurable = stops.filter((s) => s.completedAt != null && s.windowEnd != null);
  if (measurable.length === 0) return null;
  const onTime = measurable.filter((s) => s.completedAt!.getTime() <= s.windowEnd!.getTime()).length;
  return Math.round((onTime / measurable.length) * 100);
}

/** Pull the window end (ISO string) out of a RouteStop.timeWindow JSON ({ start, end }), or null. */
export function windowEnd(timeWindow: unknown): Date | null {
  if (timeWindow && typeof timeWindow === 'object' && 'end' in timeWindow) {
    const end = (timeWindow as { end?: unknown }).end;
    if (typeof end === 'string') {
      const d = new Date(end);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}
