/** Display helpers (Increment 13). Money arrives as decimal strings; never re-derive amounts here. */

const numberFormat = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 });

/**
 * Group the integer part of a numeric string with thousands separators, preserving the fractional
 * part and sign verbatim (presentation-only — it does NOT re-derive the amount). Non-numeric input is
 * returned untouched.
 */
function groupDigits(intStr: string): string {
  const neg = intStr.startsWith('-');
  const digits = neg ? intStr.slice(1) : intStr;
  if (!/^\d+$/.test(digits)) return intStr;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${grouped}` : grouped;
}

/**
 * Format a computed number for display with thousands separators (e.g. 195652 → "195,652", 0.69 →
 * "0.69"). Up to 2 decimals, trailing zeros trimmed. Non-finite input renders the honest em-dash.
 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return numberFormat.format(n);
}

export function money(amount: string | null | undefined, currency = 'CAD'): string {
  if (amount == null || amount === '') return '—';
  const [intPart, fracPart] = String(amount).split('.');
  const grouped = groupDigits(intPart ?? '') + (fracPart != null ? `.${fracPart}` : '');
  return `$${grouped}${currency ? ` ${currency}` : ''}`;
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
