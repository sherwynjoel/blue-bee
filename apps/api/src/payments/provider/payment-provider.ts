/**
 * The PaymentProvider seam (Increment 12) — the ONLY outbound Stripe-SDK touch-point (mirrors
 * StorageProvider / EtaEstimator / the notification transports). All amounts cross this boundary as
 * integer MINOR units (cents) — the Stripe convention — never floats. Every create-call carries an
 * idempotency key so a retry never double-charges/refunds.
 *
 * Two real implementations behind the `PAYMENT_PROVIDER` token, env-selected by STRIPE_SECRET_KEY:
 *   • StripePaymentProvider — the real `stripe` SDK (the shipped production path; its live test-mode
 *     network round-trip is the deferred run, parked item (d)).
 *   • LocalPaymentProvider  — deterministic, no-network (the default no-key path) so the whole rail
 *     runs headlessly. This is the deferred-OUTBOUND seam, NOT a stub of the inbound rail — the
 *     inbound side (signature verification + every state machine) is fully real either way.
 *
 * Signature verification is intentionally NOT here — it is always-real and lives in
 * StripeEventVerifier (local HMAC, no network), so the inbound source-of-truth never depends on
 * which outbound provider is selected.
 */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CreateIntentInput {
  /** Server-computed charge amount in minor units (cents). NEVER client-supplied. */
  amountMinor: number;
  /** ISO 4217 lower-cased for Stripe (e.g. 'cad'). */
  currency: string;
  /** The order being paid (order-level pay). Omitted for an invoice-level (B2B portal) charge. */
  orderId?: string;
  /** The invoice being paid (invoice-level pay — the B2B self-serve portal). Omitted for order-level. */
  invoiceId?: string;
  orgId: string;
  accountId: string;
  /** For Stripe `receipt_email` (a Stripe-issued receipt in addition to ours). */
  customerEmail?: string | null;
  description?: string;
  /** Stripe idempotency key — same key ⇒ same intent (no double-charge on retry). */
  idempotencyKey: string;
  /** 'automatic' = charge now (on-approval default); 'manual' = authorize now, capture later. */
  captureMethod: 'automatic' | 'manual';
}

export interface ProviderPaymentIntent {
  id: string;
  /** The ONLY value handed to the customer card SDK (PaymentSheet). `pi_…_secret_…`. */
  clientSecret: string;
  /** Raw Stripe status (e.g. requires_payment_method | requires_capture | succeeded). */
  status: string;
  amountMinor: number;
  currency: string;
}

export interface CaptureInput {
  paymentIntentId: string;
  /** Partial capture (≤ authorized); omit for full. */
  amountMinor?: number;
  idempotencyKey: string;
}

export interface RefundInput {
  paymentIntentId: string;
  /** Omit ⇒ full refund of the remaining balance; else a partial amount in minor units. */
  amountMinor?: number;
  reason?: string;
  idempotencyKey: string;
  orgId: string;
  orderId?: string | null;
}

export interface ProviderRefund {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
}

export interface CreateInvoiceInput {
  orgId: string;
  orderId: string;
  accountId: string;
  customerEmail?: string | null;
  currency: string;
  lines: { description: string; amountMinor: number; quantity: number }[];
  /** Stripe tax is computed from our HST line; we pass the already-taxed lines. */
  idempotencyKey: string;
  daysUntilDue: number;
}

export interface ProviderInvoice {
  id: string;
  status: string;
  hostedInvoiceUrl: string | null;
}

export interface PaymentProvider {
  /** Human label for logs/audit ('stripe' | 'local'). */
  readonly name: string;
  createPaymentIntent(input: CreateIntentInput): Promise<ProviderPaymentIntent>;
  capturePaymentIntent(input: CaptureInput): Promise<ProviderPaymentIntent>;
  refund(input: RefundInput): Promise<ProviderRefund>;
  retrievePaymentIntent(id: string): Promise<ProviderPaymentIntent>;
  createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice>;
  finalizeInvoice(invoiceId: string, idempotencyKey: string): Promise<ProviderInvoice>;
}
