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

/**
 * Pull {subtotal, tax, total} fixed-2 dollar strings out of an `Order.totals` JSON, or null when the
 * order carries no billable `total`. `total` is required to bill; `subtotal` defaults to `total` and
 * `tax` to "0.00" when absent. The single source of truth for "is this order billable, and for how
 * much" — shared by the batch-invoice engine (Track A) and the cost-centre split + report (Phase 2),
 * so the two paths can never diverge on what an order is worth.
 */
export function parseOrderTotals(totals: unknown): { subtotal: string; tax: string; total: string } | null {
  if (!totals || typeof totals !== 'object') return null;
  const t = totals as Record<string, unknown>;
  const num = (v: unknown): string | null => {
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2);
    return null;
  };
  const total = num(t.total);
  if (total === null) return null;
  const subtotal = num(t.subtotal) ?? total;
  const tax = num(t.tax) ?? '0.00';
  return { subtotal, tax, total };
}
