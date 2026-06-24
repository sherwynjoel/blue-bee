/**
 * Money math for the quote engine (PRD §8.3). All arithmetic is done in integer
 * cents to avoid binary-float drift, then rendered as fixed-2 strings for the
 * Prisma `Decimal(12,2)` columns. Pure + unit-tested (`money.spec.ts`).
 */

/** Round a dollar amount to whole cents, half away from zero (with an fp-safety nudge). */
export function roundCents(dollars: number): number {
  if (!Number.isFinite(dollars)) throw new Error('roundCents: non-finite input');
  const cents = dollars * 100;
  const sign = cents < 0 ? -1 : 1;
  // 1e-6 absorbs representation error on exact halves (e.g. 1.005*100 → 100.4999…).
  return sign * Math.round(Math.abs(cents) + 1e-6);
}

/** Cents → a fixed-2 dollar string (the form Prisma persists to Decimal(12,2)). */
export function centsToMoney(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('centsToMoney: cents must be an integer');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Convenience: round a dollar amount and render it as a money string. */
export function toMoney(dollars: number): string {
  return centsToMoney(roundCents(dollars));
}
