/**
 * Pure pickup-slot math (Increment 28) — no I/O, unit-tested in `pickup-slots.spec.ts`. Factored out of
 * `AvailabilityService` exactly like `owner-kpi` / `recurring-schedule`, so the rules that decide what a
 * customer may book are provable without a database.
 *
 * The one thing this file does NOT decide is capacity: a cap is counted against real rows, so it lives in
 * the service. Everything here is a function of (the founder's schedule, the timezone, the clock).
 */
import type { OrgSchedule, PickupSlotUnavailableReason } from '@blue-bee/shared';
import { addDaysToDateKey, parseDateKey, wallDateKey, weekdayOfDateKey, zonedWallTimeToUtc } from '../common/tz';

/** A schedule window resolved to absolute instants on one calendar date. */
export interface SlotInstant {
  label: string;
  start: Date;
  end: Date;
  /** The founder's wall clock for this window, carried through verbatim for display. */
  startLocal: string;
  endLocal: string;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Resolve every window the founder defined into absolute instants on `dateKey`, in start order.
 *
 * `zonedWallTimeToUtc` does the DST work: `09:00` on 2026-03-08 (spring-forward) resolves an hour earlier
 * in UTC than `09:00` the day before, because Toronto's offset changed overnight. The customer sees "9am"
 * both days, which is the point.
 *
 * Returns `[]` for a closed weekday — the caller renders an honest "we're closed" rather than a hidden day.
 */
export function daySlots(dateKey: string, tz: string, schedule: OrgSchedule): SlotInstant[] {
  const p = parseDateKey(dateKey);
  if (!p) throw new Error(`not a calendar date: ${dateKey}`);
  if (schedule.closedDays.includes(weekdayOfDateKey(dateKey))) return [];

  return [...schedule.windows]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((w) => {
      const [sh, sm] = w.start.split(':').map(Number) as [number, number];
      const [eh, em] = w.end.split(':').map(Number) as [number, number];
      return {
        label: w.label,
        start: zonedWallTimeToUtc(p.year, p.month, p.day, sh, sm, tz),
        end: zonedWallTimeToUtc(p.year, p.month, p.day, eh, em, tz),
        startLocal: w.start,
        endLocal: w.end,
      };
    });
}

/**
 * Why `slot` cannot be booked at `now`, or `null` if the clock allows it.
 *
 * The rule is stated on the window's START, because that is the only instant the lead time is measured
 * against ("book N hours before we arrive"):
 *
 *   • `'past'`      — the start has passed. The window is under way or over; either way you can no longer
 *                     book ahead of it. Reported for both, because to a customer they are the same fact.
 *   • `'lead_time'` — the start is still in the future, but sooner than `leadTimeHours` away. This is a
 *                     POLICY the app can explain ("we need 2 hours' notice"), so it must not be conflated
 *                     with a window that has simply gone. With `leadTimeHours: 0` this branch is
 *                     unreachable — a founder who asks for no notice never rejects a slot for lack of it.
 *
 * Capacity is NOT considered here — the service layers `'full'` on top after counting real orders.
 */
export function clockReason(slot: SlotInstant, now: Date, leadTimeHours: number): PickupSlotUnavailableReason | null {
  const untilStartMs = slot.start.getTime() - now.getTime();
  if (untilStartMs <= 0) return 'past';
  if (untilStartMs < leadTimeHours * MS_PER_HOUR) return 'lead_time';
  return null;
}

/**
 * The calendar dates (business-local `YYYY-MM-DD`) inside the horizon on which a customer could still book
 * something: `horizonDays` days counting today as day 1, minus configured closed days, minus any day whose
 * every window has already failed the clock (a today booked past its last lead-time cut).
 *
 * A day is offered only when at least one of its windows is CLOCK-bookable. A day whose slots are all
 * capacity-full still appears — the customer opens it and the picker shows the honest "no slots left"
 * empty state, rather than the day silently vanishing from the strip.
 */
export function bookableDates(now: Date, tz: string, schedule: OrgSchedule): string[] {
  const today = wallDateKey(now, tz);
  const out: string[] = [];
  for (let i = 0; i < schedule.horizonDays; i++) {
    const key = addDaysToDateKey(today, i);
    const slots = daySlots(key, tz, schedule);
    if (slots.some((s) => clockReason(s, now, schedule.leadTimeHours) === null)) out.push(key);
  }
  return out;
}

/**
 * Is `dateKey` inside the horizon window the endpoint will answer for? The lower bound is today in the
 * business timezone (a past date is never answerable), the upper bound is the last day of the horizon.
 * Closed days are IN range — the endpoint answers them with `closed: true`, which is a real answer.
 */
export function isWithinHorizon(dateKey: string, now: Date, tz: string, schedule: OrgSchedule): boolean {
  if (!parseDateKey(dateKey)) return false;
  const today = wallDateKey(now, tz);
  const last = addDaysToDateKey(today, schedule.horizonDays - 1);
  return dateKey >= today && dateKey <= last; // fixed-width ISO keys compare lexicographically
}

/** Do two half-open intervals overlap? Adjacent windows (`…12:00` / `12:00…`) do not. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}
