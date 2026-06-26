/**
 * Payments / billing contract (Increment 12) — Zod request schemas + derived DTO types and view
 * shapes for the Stripe billing rail (PRD §8.4, §9.6, A2.2/A5.1). Single source of truth shared by
 * the API (validation + response typing) and the customer Pay surface.
 *
 * The wire shapes only — the state machines, the PaymentProvider seam, and the signature-verified
 * webhook live in `apps/api/src/payments` + `apps/api/src/billing`. Money crosses the wire as
 * fixed-2 dollar strings (the Decimal(12,2) form); the app/Stripe convert to integer minor units.
 * The card never touches our API: the customer app drives Stripe's PaymentSheet with the
 * `clientSecret` only (PCI SAQ-A).
 */
import { z } from 'zod';
import { InvoiceStatus, PaymentMethod, PaymentStatus } from './enums';

// ───────────────────────────── requests ─────────────────────────────

/**
 * Create (or re-attempt) the PaymentIntent for an approved order. The amount is ALWAYS computed
 * server-side from the approved quote total (incl. Ontario HST) — never supplied by the client.
 * Body carries no money. Idempotent per order+attempt at the Stripe layer.
 */
export const createPaymentIntentSchema = z.object({
  /** Optional client correlation note (audit only); never affects the charged amount. */
  note: z.string().max(500).optional(),
});
export type CreatePaymentIntentDto = z.infer<typeof createPaymentIntentSchema>;

/**
 * Refund a captured payment (owner/finance). Omit `amount` for a FULL refund; a positive `amount`
 * (dollars) ≤ the captured-minus-already-refunded balance is a partial refund (validated server-side).
 */
export const refundPaymentSchema = z.object({
  amount: z.number().positive().finite().optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer', 'other']).optional(),
  note: z.string().max(500).optional(),
});
export type RefundPaymentDto = z.infer<typeof refundPaymentSchema>;

/** Generate an invoice for an order from its approved quote (owner/finance). */
export const generateInvoiceSchema = z.object({
  /** Days until due (net terms); defaults server-side when omitted. */
  dueInDays: z.number().int().min(0).max(365).optional(),
});
export type GenerateInvoiceDto = z.infer<typeof generateInvoiceSchema>;

// ───────────────────────────── responses / view shapes ─────────────────────────────

/** The PaymentIntent handed to the customer app to drive PaymentSheet (clientSecret only — SAQ-A). */
export interface PaymentIntentResponse {
  paymentId: string;
  /** Stripe PaymentIntent client secret — the ONLY value the card SDK needs. */
  clientSecret: string;
  /** Charged amount as a fixed-2 dollar string (server-computed from the approved quote). */
  amount: string;
  /** ISO 4217, always CAD this phase. */
  currency: string;
  status: PaymentStatus;
  /** Publishable (non-secret) Stripe key for the SDK, or null when the app supplies its own. */
  publishableKey: string | null;
}

/** A payment record as surfaced to the apps (no Stripe secrets, no card data). */
export interface PaymentView {
  id: string;
  orderId: string | null;
  invoiceId: string | null;
  method: PaymentMethod;
  amount: string;
  currency: string;
  status: PaymentStatus;
  /** Captured-so-far + refunded-so-far as fixed-2 strings (for receipts + partial-refund math). */
  capturedAmount: string;
  refundedAmount: string;
  attempts: number;
  createdAt: string;
  capturedAt: string | null;
}

export interface InvoiceLineView {
  description: string;
  quantity: number;
  unitAmount: string;
  amount: string;
}

/** An invoice + its receipt-ready lines (the customer "receipt" for a paid order). */
export interface InvoiceView {
  id: string;
  orderId: string | null;
  number: string | null;
  status: InvoiceStatus;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  lines: InvoiceLineView[];
  issuedAt: string | null;
  paidAt: string | null;
  dueAt: string | null;
  createdAt: string;
}

export interface RefundView {
  id: string;
  paymentId: string;
  amount: string;
  currency: string;
  status: string;
  reason: string | null;
  createdAt: string;
}

export interface DisputeView {
  id: string;
  paymentId: string;
  orderId: string | null;
  amount: string;
  currency: string;
  status: string;
  reason: string | null;
  openedAt: string;
  resolvedAt: string | null;
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const PAYMENT_ERRORS = {
  ORDER_NOT_PAYABLE: 'payment.order_not_payable',
  NO_APPROVED_QUOTE: 'payment.no_approved_quote',
  ALREADY_PAID: 'payment.already_paid',
  PAYMENT_NOT_FOUND: 'payment.not_found',
  ILLEGAL_TRANSITION: 'payment.illegal_transition',
  REFUND_EXCEEDS_CAPTURED: 'payment.refund_exceeds_captured',
  NOT_REFUNDABLE: 'payment.not_refundable',
  RETRY_LIMIT_REACHED: 'payment.retry_limit_reached',
  INVOICE_NOT_FOUND: 'payment.invoice_not_found',
  WEBHOOK_SIGNATURE_INVALID: 'payment.webhook_signature_invalid',
} as const;

// ───────────────────────────── Stripe webhook event types we handle ─────────────────────────────

/** The Stripe event types the webhook drives state from. Anything else is recorded + ignored (no-op). */
export const STRIPE_HANDLED_EVENTS = {
  PAYMENT_INTENT_SUCCEEDED: 'payment_intent.succeeded',
  PAYMENT_INTENT_FAILED: 'payment_intent.payment_failed',
  CHARGE_REFUNDED: 'charge.refunded',
  DISPUTE_CREATED: 'charge.dispute.created',
  DISPUTE_CLOSED: 'charge.dispute.closed',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
} as const;
