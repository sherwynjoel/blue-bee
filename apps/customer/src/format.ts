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

// ───────────────────────── pickup scheduling (Inc-28) ─────────────────────────
//
// These deliberately avoid `Intl` / `toLocale*`. A pickup window is a wall-clock time in the ORG's business
// timezone — the server sends it as `HH:MM` precisely so the app never has to convert — and Hermes ships a
// partial `Intl` whose `timeZone` option is unreliable on Android. Pure string/index math renders identically
// on every device, and shows the customer the hours their laundry is actually collected in rather than that
// instant re-expressed in whatever timezone their phone happens to be in.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A wall-clock "HH:MM" (24h) → a 12-hour label: "09:00" → "9:00 AM", "15:00" → "3:00 PM". */
export function hhmmTo12h(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** A pickup window's wall clock → "9:00 AM – 12:00 PM". */
export function windowText(startLocal: string, endLocal: string): string {
  return `${hhmmTo12h(startLocal)} – ${hhmmTo12h(endLocal)}`;
}

/**
 * A business-local `YYYY-MM-DD` → the day-chip parts: `{ weekday: 'Sat', day: '11', month: 'Jul' }`.
 *
 * Parsed as UTC midnight and read back through the `getUTC*` accessors, so the device's own offset can never
 * shift the label onto the previous day — the classic `new Date('2026-07-11')` bug west of Greenwich.
 */
export function dateKeyParts(dateKey: string): { weekday: string; day: string; month: string } {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { weekday: '—', day: '—', month: '' };
  return {
    weekday: WEEKDAYS[d.getUTCDay()] as string,
    day: String(d.getUTCDate()),
    month: MONTHS[d.getUTCMonth()] as string,
  };
}
