/** Display helpers (Increment 13). Money arrives as decimal strings; never re-derive amounts here. */

export function money(amount: string | null | undefined, currency = 'CAD'): string {
  if (amount == null || amount === '') return '—';
  return `$${amount}${currency ? ` ${currency}` : ''}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function orderRef(id: string): string {
  return `#${id.slice(0, 8)}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

/** Title-case a SCREAMING_SNAKE status for display. */
export function humanize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
