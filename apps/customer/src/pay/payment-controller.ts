import { OrderStatus, PaymentStatus, QuoteStatus, type PaymentView } from '@blue-bee/shared';
import type { OrderDetail } from '../api/types';

/**
 * Framework-agnostic pay-flow logic (Increment 12) — pure, unit-tested. The screen layers Stripe's
 * PaymentSheet + the API client on top. The webhook is the source of truth: after the SDK confirms
 * the card, we POLL the server payment until it reaches a terminal state (REST is truth, §12.3-style)
 * — we never mark "paid" on the client's say-so.
 */

/** A payment is terminal (no more polling) once the webhook has resolved it. */
const TERMINAL: PaymentStatus[] = [PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.REFUNDED];

/** Statuses from which an order can still be paid (approved, not yet paid/declined/closed). */
export function isPayable(order: OrderDetail): boolean {
  const ps = order.totals?.paymentStatus;
  if (ps === 'PAID' || ps === 'REFUNDED' || ps === 'PARTIALLY_REFUNDED') return false;
  const status = order.status;
  if (status === OrderStatus.QUOTE_DECLINED || status === OrderStatus.CLOSED_NO_WORK) return false;
  // An approved quote is the chargeable basis.
  return order.quotes.some((q) => q.status === QuoteStatus.APPROVED) || hasApprovedStatus(status);
}

function hasApprovedStatus(status: OrderStatus): boolean {
  const idx = PAYABLE_FROM.indexOf(status);
  return idx >= 0;
}

const PAYABLE_FROM: OrderStatus[] = [
  OrderStatus.QUOTE_APPROVED,
  OrderStatus.IN_CLEANING,
  OrderStatus.QC,
  OrderStatus.READY,
  OrderStatus.SCHEDULED_DELIVERY,
  OrderStatus.DELIVERY_EN_ROUTE,
  OrderStatus.DELIVERED,
  OrderStatus.INVOICED,
];

/** The chargeable total (the approved quote total, incl. HST) as a money string, or null. */
export function payAmount(order: OrderDetail): string | null {
  const approved = order.quotes.find((q) => q.status === QuoteStatus.APPROVED);
  if (approved?.total) return approved.total;
  return order.totals?.total ?? null;
}

export interface PollOptions {
  attempts: number;
  intervalMs: number;
}

/**
 * Poll the order's payment until it reaches a terminal (webhook-confirmed) state, or attempts run
 * out. Returns the last observed payment (possibly still PENDING → the UI shows "processing"). Never
 * throws on a transient read error — it retries — so a flaky network can't strand the UI.
 */
export async function pollPaymentConfirmed(
  getPayment: () => Promise<PaymentView | null>,
  delay: (ms: number) => Promise<void>,
  opts: PollOptions = { attempts: 6, intervalMs: 1500 },
): Promise<PaymentView | null> {
  let last: PaymentView | null = null;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      last = await getPayment();
      if (last && TERMINAL.includes(last.status)) return last;
    } catch {
      // transient — keep polling
    }
    if (i < opts.attempts - 1) await delay(opts.intervalMs);
  }
  return last;
}
