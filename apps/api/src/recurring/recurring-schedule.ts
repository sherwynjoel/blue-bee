/**
 * Pure cadence / next-run math for Track-A standing orders (no I/O — unit-tested in
 * `recurring-schedule.spec.ts`). Factored out of the generation service so the recurrence rules are
 * provable without a DB, exactly like the Inc-15 `analytics-kpi` / Inc-14a `owner-kpi` helpers.
 *
 * DST-safe by construction: all occurrence math is whole-DAY integer arithmetic over UTC-midnight
 * dates (never elapsed-millisecond intervals), so a clock that springs forward/falls back can never
 * shift an occurrence onto the wrong weekday or flip biweekly parity. A pickup window's HH:MM is
 * applied as UTC wall-clock on the occurrence date (a deterministic window label); mapping it to the
 * org's America/Toronto business timezone is a documented follow-on (not faked here).
 */
import { StandingOrderCadence, type PickupWindow } from '@blue-bee/shared';

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** The minimal recurrence spec the pure math needs (a subset of the StandingOrder row). */
export interface CadenceSpec {
  cadence: StandingOrderCadence;
  /** 0=Sunday … 6=Saturday (matches Date.getUTCDay). */
  weekday: number;
  startsOn: Date;
  endsOn?: Date | null;
}

/** UTC-midnight floor of a date (strips time-of-day). */
export function utcDateFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The period/occurrence key for a date — its UTC calendar date `YYYY-MM-DD`. */
export function periodKey(d: Date): string {
  return utcDateFloor(d).toISOString().slice(0, 10);
}

/** Whole-day count from `a` to `b` (DST-safe: integer days between UTC-midnight floors). */
export function wholeDaysBetween(a: Date, b: Date): number {
  return Math.round((utcDateFloor(b).getTime() - utcDateFloor(a).getTime()) / MS_PER_DAY);
}

/** The first date on/after `from` whose UTC weekday equals `weekday`. */
export function firstWeekdayOnOrAfter(from: Date, weekday: number): Date {
  const f = utcDateFloor(from);
  const delta = (weekday - f.getUTCDay() + 7) % 7;
  return new Date(f.getTime() + delta * MS_PER_DAY);
}

/**
 * Does `date` fall on the spec's cadence? Requires the matching UTC weekday, and for BIWEEKLY an
 * EVEN number of weeks from the first on-cadence date on/after `startsOn` (the parity anchor).
 */
export function matchesCadence(spec: CadenceSpec, date: Date): boolean {
  const d = utcDateFloor(date);
  if (d.getUTCDay() !== spec.weekday) return false;
  const anchor = firstWeekdayOnOrAfter(spec.startsOn, spec.weekday);
  if (d.getTime() < anchor.getTime()) return false; // before the first occurrence
  if (spec.cadence === StandingOrderCadence.WEEKLY) return true;
  const weeks = Math.round((d.getTime() - anchor.getTime()) / MS_PER_WEEK);
  return weeks % 2 === 0; // biweekly: every other week from the anchor
}

/**
 * All occurrence dates (UTC midnight) on the cadence within `[windowStart, windowEnd]`, inclusive,
 * clamped to `[startsOn, endsOn]`. Ascending. Used by the generator: pass a bounded look-back
 * window so a first run never back-fills unbounded history (the occurrence ledger dedups re-runs).
 */
export function occurrenceDatesInWindow(spec: CadenceSpec, windowStart: Date, windowEnd: Date): Date[] {
  const lowerMs = Math.max(utcDateFloor(windowStart).getTime(), utcDateFloor(spec.startsOn).getTime());
  const endCapMs = spec.endsOn ? utcDateFloor(spec.endsOn).getTime() : Number.POSITIVE_INFINITY;
  const upperMs = Math.min(utcDateFloor(windowEnd).getTime(), endCapMs);
  if (upperMs < lowerMs) return [];

  const out: Date[] = [];
  let t = firstWeekdayOnOrAfter(new Date(lowerMs), spec.weekday).getTime();
  for (; t <= upperMs; t += MS_PER_WEEK) {
    const d = new Date(t);
    if (matchesCadence(spec, d)) out.push(d);
  }
  return out;
}

/** The next occurrence date STRICTLY after `after` (for `nextRunAt`); null if past `endsOn`. */
export function nextOccurrenceAfter(spec: CadenceSpec, after: Date): Date | null {
  const fromMs = Math.max(utcDateFloor(after).getTime() + MS_PER_DAY, utcDateFloor(spec.startsOn).getTime());
  const endCapMs = spec.endsOn ? utcDateFloor(spec.endsOn).getTime() : Number.POSITIVE_INFINITY;
  let t = firstWeekdayOnOrAfter(new Date(fromMs), spec.weekday).getTime();
  // Bounded scan (≤ ~4y of weeks) so a misconfigured spec can't loop forever.
  for (let i = 0; i < 220 && t <= endCapMs; i++, t += MS_PER_WEEK) {
    const d = new Date(t);
    if (matchesCadence(spec, d)) return d;
  }
  return null;
}

/**
 * Build a generated order's `scheduledPickupWindow` ({start,end} ISO) from an occurrence date + the
 * standing order's HH:MM window. Applied as UTC wall-clock on the occurrence date (see file header).
 */
export function buildPickupWindowForDate(date: Date, window: PickupWindow): { start: string; end: string } {
  const base = utcDateFloor(date).getTime();
  const at = (hhmm: string): string => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(base + (h * 60 + m) * 60_000).toISOString();
  };
  return { start: at(window.start), end: at(window.end) };
}
