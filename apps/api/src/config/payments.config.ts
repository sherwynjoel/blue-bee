/**
 * Typed payments configuration (Increment 12) — the Stripe billing rail. Mirrors the other typed
 * config factories (AUTH_CONFIG / NOTIFICATIONS_CONFIG / MEDIA_CONFIG): every tunable comes from the
 * environment, provided via `{ provide: PAYMENTS_CONFIG, useFactory: loadPaymentsConfig }`.
 *
 * TEST MODE ONLY. `STRIPE_SECRET_KEY` selects the real outbound provider (StripePaymentProvider);
 * when absent we use the LocalPaymentProvider (deterministic, no network) so the whole rail runs
 * headlessly. `STRIPE_WEBHOOK_SECRET` is the HMAC secret the signature verifier checks the raw body
 * against — it ALWAYS runs (local crypto, no network), so the inbound rail is fully real either way.
 */
export const PAYMENTS_CONFIG = Symbol('PAYMENTS_CONFIG');

/** When to capture funds: at quote-approval (charge now — the PRD A5.1 tight default) or at delivery. */
export type CaptureTiming = 'on_approval' | 'on_delivery';

export interface PaymentsConfig {
  stripe: {
    /** Test secret key (`sk_test_…`). Null ⇒ no live outbound calls ⇒ LocalPaymentProvider. */
    secretKey: string | null;
    /** Webhook signing secret (`whsec_…`). Verified against the raw body on every webhook. */
    webhookSecret: string;
    /** Publishable (non-secret) key returned to the app for PaymentSheet; null ⇒ app supplies its own. */
    publishableKey: string | null;
  };
  /** ISO 4217 — CAD this phase (Ontario). */
  currency: string;
  /** PRD A5.1 setting: capture on approval (default) or on delivery (capture-later, seam-ready). */
  captureTiming: CaptureTiming;
  /** Bounded payment re-attempts before we stop (dunning gives up). */
  maxPaymentAttempts: number;
  /** Default net-terms days for a generated invoice. */
  invoiceDueDays: number;
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v.trim() : fallback;
}

function nullableStr(name: string): string | null {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v.trim() : null;
}

function intPositive(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadPaymentsConfig(): PaymentsConfig {
  return {
    stripe: {
      secretKey: nullableStr('STRIPE_SECRET_KEY'),
      // A default TEST HMAC secret keeps local dev + the headless proof working out of the box (the
      // signer + verifier share it). Production MUST set the real `whsec_…` from the Stripe dashboard.
      webhookSecret: str('STRIPE_WEBHOOK_SECRET', 'whsec_test_local_blue_bee'),
      publishableKey: nullableStr('STRIPE_PUBLISHABLE_KEY'),
    },
    currency: str('PAYMENTS_CURRENCY', 'CAD'),
    captureTiming: str('PAYMENTS_CAPTURE_TIMING', 'on_approval') === 'on_delivery' ? 'on_delivery' : 'on_approval',
    maxPaymentAttempts: intPositive('PAYMENTS_MAX_ATTEMPTS', 4),
    invoiceDueDays: intPositive('PAYMENTS_INVOICE_DUE_DAYS', 14),
  };
}
