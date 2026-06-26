import { DisputeStatus, RouteStopStatus, type OwnerException } from '@blue-bee/shared';

/**
 * Exceptions feed — the SINGLE source of the "needs attention" status sets + windows + row→item
 * normalization shared by the OWNER cockpit (org-wide, `OwnerService.exceptions`) and the Track-A
 * B2B portal (account-scoped, `AccountsPortalService.exceptions`). Extracted here so the magic values
 * and the `OwnerException` mapping live in ONE place — the two consumers differ only in their WHERE
 * (org-wide vs. a single account); the constants and the normalized shape are identical.
 */

/** Terminal/recent windows for the feed (terminal stop/payment rows older than this are history). */
export const EXCEPTION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap the exception feed list (a COUNT, where used, stays the truth; the list shows the newest). */
export const EXCEPTION_FEED_LIMIT = 100;
/** A stop is an exception when FAILED or SKIPPED (PRD §5.4/§6.3). */
export const EXCEPTION_STOP_STATUSES = [RouteStopStatus.FAILED, RouteStopStatus.SKIPPED];
/** A dispute is open while OPEN or UNDER_REVIEW. */
export const OPEN_DISPUTE_STATUSES = [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW];

/** A fixed-2 dollar string carrier (Prisma `Decimal`) — structural so callers needn't import Decimal. */
type DecimalLike = { toFixed(digits: number): string };

export interface ExceptionStopRow {
  id: string;
  status: RouteStopStatus | string;
  exceptionReason: string | null;
  updatedAt: Date;
  routeId: string | null;
  orderId: string | null;
  site: { name: string } | null;
}
export interface ExceptionHeldRow {
  id: string;
  heldFrom: string | null;
  updatedAt: Date;
  account: { name: string } | null;
}
export interface ExceptionDisputeRow {
  id: string;
  status: string;
  amount: DecimalLike;
  currency: string;
  reason: string | null;
  openedAt: Date;
  orderId: string | null;
}
export interface ExceptionPaymentRow {
  id: string;
  amount: DecimalLike;
  currency: string;
  lastError: string | null;
  orderId: string | null;
  updatedAt: Date;
}

export interface ExceptionSources {
  stops: ExceptionStopRow[];
  held: ExceptionHeldRow[];
  disputes: ExceptionDisputeRow[];
  payments: ExceptionPaymentRow[];
}

/**
 * Normalize the four exception row-sets into the unified, newest-first `OwnerException[]` feed
 * (capped at {@link EXCEPTION_FEED_LIMIT}). `amount`/`currency` are set for finance exceptions, else
 * null — the exact shape both the owner app and the B2B console render.
 */
export function normalizeExceptions(src: ExceptionSources): OwnerException[] {
  const items: OwnerException[] = [
    ...src.stops.map((s): OwnerException => ({
      id: s.id,
      kind: s.status === RouteStopStatus.FAILED ? 'STOP_FAILED' : 'STOP_SKIPPED',
      title: `Stop ${s.status === RouteStopStatus.FAILED ? 'failed' : 'skipped'}${s.site?.name ? ` — ${s.site.name}` : ''}`,
      detail: s.exceptionReason ?? null,
      orderId: s.orderId,
      routeId: s.routeId,
      stopId: s.id,
      amount: null,
      currency: null,
      occurredAt: s.updatedAt.toISOString(),
    })),
    ...src.held.map((o): OwnerException => ({
      id: o.id,
      kind: 'ORDER_HELD',
      title: `Order on hold${o.account?.name ? ` — ${o.account.name}` : ''}`,
      detail: o.heldFrom ? `Paused from ${o.heldFrom}` : null,
      orderId: o.id,
      routeId: null,
      stopId: null,
      amount: null,
      currency: null,
      occurredAt: o.updatedAt.toISOString(),
    })),
    ...src.disputes.map((d): OwnerException => ({
      id: d.id,
      kind: 'PAYMENT_DISPUTE',
      title: `Payment dispute (${d.status})`,
      detail: d.reason ?? null,
      orderId: d.orderId,
      routeId: null,
      stopId: null,
      amount: d.amount.toFixed(2),
      currency: d.currency,
      occurredAt: d.openedAt.toISOString(),
    })),
    ...src.payments.map((p): OwnerException => ({
      id: p.id,
      kind: 'PAYMENT_FAILED',
      title: 'Payment failed',
      detail: p.lastError ?? null,
      orderId: p.orderId,
      routeId: null,
      stopId: null,
      amount: p.amount.toFixed(2),
      currency: p.currency,
      occurredAt: p.updatedAt.toISOString(),
    })),
  ];

  items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
  return items.slice(0, EXCEPTION_FEED_LIMIT);
}
