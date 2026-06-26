/**
 * Pure owner-KPI helpers (Increment 14a) — no I/O, unit-tested in `owner-kpi.spec.ts`. The owner
 * dashboard aggregation (`OwnerService.today`) is server-authoritative; these are the deterministic
 * bits (the business-day window, money summation, on-time math) factored out so they're provable
 * without a DB.
 */

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock calendar/clock parts of `date` rendered in `tz`. */
function wallParts(date: Date, tz: string): WallParts {
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
function tzOffsetMs(date: Date, tz: string): number {
  const p = wallParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * The UTC instant of the start of `now`'s calendar day in `tz` (the GTA business day,
 * `America/Toronto`). DST-safe to the minute except across the ~yearly transition hour (a "today's
 * numbers" KPI tolerates that, and the transition is at 02:00 local, not midnight).
 */
export function businessDayStart(now: Date, tz: string): Date {
  const p = wallParts(now, tz);
  const offsetMs = tzOffsetMs(now, tz);
  const localMidnightAsUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0);
  return new Date(localMidnightAsUtc - offsetMs);
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
