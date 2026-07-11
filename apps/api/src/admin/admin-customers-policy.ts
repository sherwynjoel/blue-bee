import type { CustomerNotificationView } from '@blue-bee/shared';
import { parseOrderTotals } from '../orders/money';

/**
 * Pure customer-360 helpers (Increment 27) — no I/O, unit-tested in `admin-customers-policy.spec.ts`.
 * Each one encodes a place where the honest answer is "we don't know", and where a naive implementation
 * would quietly answer "no" instead. The AdminCustomersService does the I/O.
 */

/** `Order.totals` is a free-form JSON blob. Only trust a total that is actually there and numeric-ish. */
export interface OrderTotalsView {
  total: string | null;
  currency: string;
}

const DEFAULT_CURRENCY = 'CAD';

/**
 * Read the grand total off an order's `totals` JSON.
 *
 * Delegates to `parseOrderTotals` — the single source of truth for "is this order billable, and for how
 * much", already shared by the batch-invoice engine and the cost-centre split. A second, hand-rolled
 * parser here is exactly how the console would come to disagree with the invoice.
 *
 * An unpriced order (`{}`) has no total — that is `null`, not `"0"`. Rendering a zero would tell staff the
 * customer owes nothing when in truth the order has not been quoted yet.
 */
export function orderTotals(totals: unknown): OrderTotalsView {
  const parsed = parseOrderTotals(totals);
  const currency =
    totals !== null && typeof totals === 'object' && typeof (totals as { currency?: unknown }).currency === 'string' && (totals as { currency: string }).currency.length > 0
      ? (totals as { currency: string }).currency
      : DEFAULT_CURRENCY;
  return { total: parsed?.total ?? null, currency };
}

/**
 * Did this customer place the order? `Order` has no `userId`; the only signal is `createdBy`.
 *
 * When `createdBy` is unset (older rows) we genuinely do not know, and must say so — returning `false`
 * would render as "booked by staff" in the console, which is a claim the data does not support.
 */
export function bookedByCustomer(createdBy: string | null, customerUserId: string): boolean | null {
  if (createdBy === null) return null;
  return createdBy === customerUserId;
}

/** The `NotificationPreference` columns the 360 reads (a subset of the Prisma model). */
export interface NotificationPrefRow {
  pushEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string;
}

/** Server defaults, mirrored from the Prisma model's column defaults. */
const NOTIFICATION_DEFAULTS = {
  pushEnabled: true,
  smsEnabled: true,
  emailEnabled: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: 'America/Toronto',
} as const;

/**
 * No `NotificationPreference` row ⇒ the customer never chose anything and is running on server defaults.
 * `configured: false` says exactly that, so the console cannot present a default as a customer's decision
 * ("SMS on" reads very differently when they picked it vs when nobody ever asked).
 */
export function toNotificationView(pref: NotificationPrefRow | null): CustomerNotificationView {
  if (!pref) return { configured: false, ...NOTIFICATION_DEFAULTS };
  return {
    configured: true,
    pushEnabled: pref.pushEnabled,
    smsEnabled: pref.smsEnabled,
    emailEnabled: pref.emailEnabled,
    quietHoursStart: pref.quietHoursStart,
    quietHoursEnd: pref.quietHoursEnd,
    timezone: pref.timezone,
  };
}

/**
 * Coverage for a saved address, from the service-zone gate's raw answer.
 *
 * `hasActiveZones === false` means the org has drawn no zones, so the gate is inert — that is NOT
 * evidence of coverage, and `checked: false` tells the console to claim nothing. The 360 is a read: it
 * reports coverage and never captures out-of-area demand, so `coverageRequestId` is always null here.
 */
export function toServiceability(gate: { hasActiveZones: boolean; covered: boolean }): {
  checked: boolean;
  serviceable: boolean;
  coverageRequestId: null;
} {
  return {
    checked: gate.hasActiveZones,
    serviceable: gate.hasActiveZones && gate.covered,
    coverageRequestId: null,
  };
}
