/** Small display formatters (pure). */

/** Money string ("123.45") → "$123.45 CAD". */
export function money(amount: string | null | undefined, currency = 'CAD'): string {
  if (amount == null) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  return `$${n.toFixed(2)} ${currency}`;
}

/** An estimate range → "$45.00 – $58.00 CAD". */
export function rangeText(low?: string, high?: string, currency = 'CAD'): string {
  if (low == null || high == null) return '—';
  return `$${Number(low).toFixed(2)} – $${Number(high).toFixed(2)} ${currency}`;
}

/** ISO time → a short local time, e.g. "3:42 PM". */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** ISO date → a short date, e.g. "Jun 25". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** An ETA range "3:40 – 3:55 PM" from two ISO times. */
export function etaText(low: string | null, high: string | null, mid: string | null): string {
  if (low && high) return `${shortTime(low)} – ${shortTime(high)}`;
  if (mid) return shortTime(mid);
  return 'calculating…';
}

/** A short customer-facing order ref (first 8 chars), matching the server's push ref format. */
export function orderRef(orderId: string): string {
  return `#${orderId.slice(0, 8)}`;
}
