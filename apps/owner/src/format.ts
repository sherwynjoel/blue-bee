/** Small display formatters (pure). */

/** Money string ("123.45") → "$123.45". Currency suffix optional. */
export function money(amount: string | null | undefined, currency?: string): string {
  if (amount == null) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount}${currency ? ` ${currency}` : ''}`;
  return `$${n.toFixed(2)}${currency ? ` ${currency}` : ''}`;
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

/** A relative "x ago" for a freshness stamp. `now` is injectable so it's pure/testable. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** A short order ref (first 8 chars), matching the server's push ref format. */
export function orderRef(orderId: string): string {
  return `#${orderId.slice(0, 8)}`;
}

/** "67%" or "—" when on-time has no measurable sample yet. */
export function percent(p: number | null | undefined): string {
  return p == null ? '—' : `${p}%`;
}
