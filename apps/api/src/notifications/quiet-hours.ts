/**
 * Quiet-hours math (Increment 8, §8.5) — PURE + dependency-free (uses the built-in Intl tz
 * database, no moment/luxon). Windows are minutes-from-local-midnight in the recipient's IANA
 * timezone, and may wrap midnight (e.g. 22:00→07:00 ⇒ start 1320, end 420). Kept pure so the
 * defer-vs-bypass logic is unit-tested deterministically against a fixed instant.
 */

/** Minutes-from-local-midnight [0,1440) for an instant in an IANA timezone. */
export function localMinutesOfDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value) % 24; // some platforms render midnight as "24"
    else if (p.type === 'minute') m = Number(p.value);
  }
  return h * 60 + m;
}

/** Is `at` within the [startMin, endMin) quiet window (local), supporting a midnight wrap? */
export function isWithinQuietHours(
  at: Date,
  timeZone: string,
  startMin: number | null | undefined,
  endMin: number | null | undefined,
): boolean {
  if (startMin == null || endMin == null || startMin === endMin) return false; // unset/empty ⇒ no quiet hours
  const now = localMinutesOfDay(at, timeZone);
  return startMin < endMin
    ? now >= startMin && now < endMin // same-day window
    : now >= startMin || now < endMin; // wraps midnight
}

/**
 * The next instant the quiet window ENDS, for deferral scheduling — DST-CORRECT. A naive
 * minute-delta on the UTC clock is wrong across a DST boundary (on the fall-back night it would land
 * an hour INSIDE the window, sending a deferred non-urgent alert early). So we seed with the naive
 * estimate, then iterate: at each candidate, measure the residual between its LOCAL minutes-of-day
 * and `endMin` and correct by that residual. Offsets shift by ≤60 min, so this converges in a couple
 * of steps to an instant whose local wall-clock equals `endMin`.
 */
export function quietHoursEndAt(at: Date, timeZone: string, endMin: number): Date {
  const startLocal = localMinutesOfDay(at, timeZone);
  let delta = endMin - startLocal;
  if (delta <= 0) delta += 1440; // the window ends tomorrow (local)
  let guess = new Date(at.getTime() + delta * 60_000);
  for (let i = 0; i < 4; i++) {
    let residual = endMin - localMinutesOfDay(guess, timeZone);
    // normalize to [-720, 720] so we always nudge by the shortest direction
    if (residual > 720) residual -= 1440;
    else if (residual < -720) residual += 1440;
    if (residual === 0) break;
    guess = new Date(guess.getTime() + residual * 60_000);
  }
  return guess;
}
