import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { PAYMENTS_CONFIG, type PaymentsConfig } from '../../config/payments.config';

/**
 * The INBOUND source of truth (Increment 12) — ALWAYS-REAL Stripe webhook signature verification.
 * `stripe.webhooks.constructEvent` recomputes the HMAC of the RAW request body against
 * `STRIPE_WEBHOOK_SECRET` and rejects any forged/unsigned/tampered payload — it is local crypto, NO
 * network call, so it runs identically whether the outbound provider is Stripe or Local. A forged
 * signature throws (→ the controller returns 400). This is what makes "the webhook is the single
 * source of truth" real: we never trust the client's "it succeeded", only a Stripe-signed event.
 *
 * `generateTestHeaderString` is Stripe's OWN test utility — it produces a REAL, validly-signed
 * header for a given payload + secret. It is NOT a mock; it is how the e2e/integration proof drives
 * the genuine verification path with genuine signatures.
 */
@Injectable()
export class StripeEventVerifier {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(@Inject(PAYMENTS_CONFIG) config: PaymentsConfig) {
    // Verification needs no live key — a placeholder is fine when running with the Local provider; the
    // webhook secret is what signs/verifies. (No network I/O at construction or in constructEvent.)
    this.stripe = new Stripe(config.stripe.secretKey ?? 'sk_test_placeholder_for_local_verification');
    this.webhookSecret = config.stripe.webhookSecret;
  }

  /** Verify + parse a signed webhook. Throws on any signature/secret mismatch (forged ⇒ caller 400s). */
  constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  /**
   * Produce a REAL Stripe signature header for a payload (Stripe's own test utility). Used only by
   * the e2e suite + the headless integration proof to exercise the genuine verification path.
   */
  signTestPayload(payload: string, timestamp?: number): string {
    return this.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: this.webhookSecret,
      ...(timestamp !== undefined ? { timestamp } : {}),
    });
  }
}
