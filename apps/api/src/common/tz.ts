/**
 * IANA-timezone primitives (no I/O, no date library — `Intl.DateTimeFormat` only). Unit-tested in
 * `tz.spec.ts`.
 *
 * These were extracted from `owner/owner-kpi.ts`, which had grown the only correct wall-clock↔UTC
 * conversion in the codebase. Increment 28 (pickup scheduling) needs exactly the same conversion to
 * turn a founder's `09:00` into a real instant, and a second implementation is how the availability
 * endpoint and the on-time KPI come to disagree about what "9am" meant. One implementation, two callers.
 *
 * `Intl` is used because Node's ICU carries the tz database; `America/Toronto` is a DST zone and the
 * offset is a function of the instant, never a constant.
 */

export interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock calendar/clock parts of `date` rendered in `tz`. */
export function wallParts(date: Date, tz: string): WallParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Milliseconds `tz` is ahead of UTC at `date` (negative for west-of-UTC, e.g. America/Toronto). */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = wallParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * The UTC instant at which the wall clock in `tz` reads `year-month-day hour:minute`.
 *
 * TWO PASSES, deliberately. A zone's offset depends on the instant, but the instant is what we are
 * solving for — so the first pass guesses the offset from the naive timestamp and the second re-reads
 * it at the (now nearly correct) instant. Without the second pass, every wall time on the far side of
 * a DST transition from the naive guess lands an hour out: `2026-03-08 09:00` in Toronto would resolve
 * with the EST offset that was still in force at `09:00 UTC` and come back as 10:00 EDT.
 *
 * The two nonexistent/ambiguous wall times at the transition itself (02:00–03:00 on the spring-forward
 * day; the repeated hour in the fall) resolve to a single deterministic instant rather than throwing.
 * Blue Bee's pickup windows start at 09:00 at the earliest, so no bookable slot can land on one.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstPass = naiveUtcMs - tzOffsetMs(new Date(naiveUtcMs), tz);
  return new Date(naiveUtcMs - tzOffsetMs(new Date(firstPass), tz));
}

/** The calendar date (`YYYY-MM-DD`) `instant` falls on in `tz`. */
export function wallDateKey(instant: Date, tz: string): string {
  const p = wallParts(instant, tz);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The weekday (0=Sunday … 6=Saturday) `instant` falls on in `tz`. */
export function weekdayInTz(instant: Date, tz: string): number {
  const p = wallParts(instant, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/**
 * Parse a `YYYY-MM-DD` key to its numeric parts, rejecting a well-formed-but-nonexistent date
 * (`2026-02-30`). Returns null when the string is not a real calendar date.
 */
export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Round-trip through UTC: Date.UTC rolls Feb 30 into Mar 2, so a mismatch means the date is fake.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** `YYYY-MM-DD` for the calendar date `days` after `key` (pure calendar arithmetic, no timezone). */
export function addDaysToDateKey(key: string, days: number): string {
  const p = parseDateKey(key);
  if (!p) throw new Error(`not a calendar date: ${key}`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return d.toISOString().slice(0, 10);
}

/** The weekday (0=Sunday … 6=Saturday) of a `YYYY-MM-DD` key. */
export function weekdayOfDateKey(key: string): number {
  const p = parseDateKey(key);
  if (!p) throw new Error(`not a calendar date: ${key}`);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}
