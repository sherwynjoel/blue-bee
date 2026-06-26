/**
 * Pure payment-state logic (Increment 12) — the Payment status machine's legal transitions and the
 * refund-ceiling math. No I/O, so it is unit-tested directly (`payment-state.spec.ts`). The webhook
 * is the only thing that drives these transitions; an illegal transition is a 409 at the call site.
 */
import { PaymentStatus } from '@blue-bee/shared';

/** Legal Payment status transitions. Re-attempt (FAILED→PENDING) happens by creating a NEW row, not
 *  by mutating a FAILED row, so it is intentionally NOT a legal in-place transition here. */
const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.SUCCEEDED, PaymentStatus.FAILED],
  // A captured payment can be (partially or fully) refunded. A partial refund keeps SUCCEEDED
  // (refundedAmount tracks it); only a FULL refund flips to REFUNDED.
  [PaymentStatus.SUCCEEDED]: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.REFUNDED]: [],
};

export function canPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The refundable balance (cents) = captured − already-refunded. Never negative. */
export function refundableCents(capturedCents: number, refundedCents: number): number {
  return Math.max(0, capturedCents - refundedCents);
}

/**
 * Resolve the refund amount (cents) for a request: an explicit partial amount must be > 0 and ≤ the
 * refundable balance; an omitted amount means a FULL refund of the remaining balance. Returns the
 * cents to refund, or throws a reason string the caller maps to a 422/409.
 */
export function resolveRefundCents(
  capturedCents: number,
  refundedCents: number,
  requestedCents: number | undefined,
): { cents: number; isFull: boolean } {
  const balance = refundableCents(capturedCents, refundedCents);
  if (balance <= 0) throw new Error('nothing left to refund');
  if (requestedCents === undefined) return { cents: balance, isFull: true };
  if (!Number.isInteger(requestedCents) || requestedCents <= 0) throw new Error('refund amount must be a positive amount');
  if (requestedCents > balance) throw new Error('refund exceeds the refundable balance');
  return { cents: requestedCents, isFull: requestedCents === balance };
}

/** After applying `appliedRefundCents`, is the payment now fully refunded? */
export function isFullyRefunded(capturedCents: number, refundedCentsAfter: number): boolean {
  return capturedCents > 0 && refundedCentsAfter >= capturedCents;
}
