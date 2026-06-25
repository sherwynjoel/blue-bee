import { OrderStatus, QuoteStatus } from '@blue-bee/shared';
import type { OrderDetail, ItemView, QuoteView } from '../api/types';

/** The latest quote (the order read returns quotes newest-first). */
export function latestQuote(order: OrderDetail): QuoteView | null {
  return order.quotes?.[0] ?? null;
}

export interface QuoteActionability {
  quote: QuoteView | null;
  /** Show approve/decline — order is QUOTED with a SENT quote. The server stays the authority. */
  actionable: boolean;
  approved: boolean;
  declined: boolean;
  /** Client-side hint that the SENT quote's expiresAt has passed (server confirms via 409). */
  expired: boolean;
}

/**
 * Whether the customer can act on the quote, derived from SERVER state (order.status + quote.status).
 * Approve/decline stay server-authoritative + atomic (Inc 3): a 409 (expired / already-claimed) is
 * the server's truth → the screen re-syncs, never fights it.
 */
export function quoteActionability(order: OrderDetail, now: number = Date.now()): QuoteActionability {
  const quote = latestQuote(order);
  const actionable = order.status === OrderStatus.QUOTED && quote?.status === QuoteStatus.SENT;
  const expired = !!quote && quote.status === QuoteStatus.SENT && !!quote.expiresAt && new Date(quote.expiresAt).getTime() < now;
  return {
    quote,
    actionable,
    approved: order.status === OrderStatus.QUOTE_APPROVED || quote?.status === QuoteStatus.APPROVED,
    declined:
      order.status === OrderStatus.QUOTE_DECLINED ||
      order.status === OrderStatus.CLOSED_NO_WORK ||
      quote?.status === QuoteStatus.DECLINED,
    expired,
  };
}

/** Items flagged with pre-existing damage at intake (§5.1) — the ack notice source. */
export function preexistingDamageItems(order: OrderDetail): ItemView[] {
  return order.items.filter((it) => it.inspections.some((ins) => ins.preexistingDamage));
}

/** True when an order has a route stop that's still active (so "Track my truck" is meaningful). */
export function hasActiveStop(order: OrderDetail): boolean {
  const terminal = new Set(['COMPLETED', 'FAILED', 'SKIPPED']);
  return order.routeStops.some((s) => !terminal.has(s.status));
}
