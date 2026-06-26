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

/**
 * Parse a fixed-2 money string (a Prisma `Decimal(12,2)` rendering, e.g. "293.80" or "-12.00") to
 * integer cents — the minor-unit form Stripe charges in (Increment 12). Exact (no float math on the
 * cents): splits on the decimal point. Throws on a malformed string so a bad amount can never charge.
 */
export function moneyToCents(money: string): number {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(money.trim());
  if (!m) throw new Error(`moneyToCents: malformed money string "${money}"`);
  const sign = m[1] ? -1 : 1;
  const whole = Number(m[2]);
  const frac = m[3] ? Number(m[3].padEnd(2, '0')) : 0;
  return sign * (whole * 100 + frac);
}

/**
 * Normalize a money value to a fixed-2 string. Prisma's `Decimal.toString()` drops trailing zeros
 * ("293.80" → "293.8"), so any Decimal(12,2) column read back must pass through here before crossing
 * the wire (Increment 12 — payment/invoice/refund amounts). Accepts a Decimal-like or a string.
 */
export function decimalMoney(v: { toString(): string } | string): string {
  return centsToMoney(moneyToCents(typeof v === 'string' ? v : v.toString()));
}
