import { isOrderRateable } from '@blue-bee/shared';
import type { OrderDetail, OrderSummary } from '../api/types';

/**
 * [Inc-32] Rating eligibility, derived from SERVER state (mirrors quote.ts's server-authoritative helpers).
 * The single definition of "rateable" lives in `@blue-bee/shared` (`isOrderRateable`) so the app CTA and the
 * API gate can never disagree; the server stays the authority (a stale client that shows the CTA still gets a
 * clean 4xx if the order isn't actually rateable).
 */

/** Whether an order may be rated now — it has reached DELIVERED (delivered-or-later). */
export function isRateable(order: Pick<OrderDetail, 'status'> | Pick<OrderSummary, 'status'>): boolean {
  return isOrderRateable(order.status);
}

/** Whether the order already carries a rating (embedded by `getOrder` / the order list). */
export function alreadyRated(order: Pick<OrderDetail, 'rating'> | Pick<OrderSummary, 'rating'>): boolean {
  return order.rating != null;
}
