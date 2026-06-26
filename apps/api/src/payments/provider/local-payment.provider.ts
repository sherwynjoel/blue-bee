import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  CaptureInput,
  CreateIntentInput,
  CreateInvoiceInput,
  PaymentProvider,
  ProviderInvoice,
  ProviderPaymentIntent,
  ProviderRefund,
  RefundInput,
} from './payment-provider';

/** Deterministic short id from an idempotency key (same key ⇒ same id ⇒ idempotent, no Math.random). */
function localId(prefix: string, key: string): string {
  return `${prefix}_local_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

/**
 * The deterministic, no-network outbound provider (Increment 12) — selected when STRIPE_SECRET_KEY is
 * absent (the default build/test/headless-proof path). It shapes the SAME results as Stripe (a
 * `pi_…_secret_…` client secret the rail can parse a PaymentIntent id from), with no live call.
 *
 * THIS IS THE DEFERRED-OUTBOUND SEAM, NOT A STUB OF THE INBOUND RAIL. The inbound side — real
 * signature verification (StripeEventVerifier) and every Payment/Invoice/Refund/Dispute state
 * transition driven by Stripe's own SIGNED test events — is fully real regardless of which provider
 * is selected. Production sets STRIPE_SECRET_KEY and uses StripePaymentProvider (real `stripe` SDK).
 */
@Injectable()
export class LocalPaymentProvider implements PaymentProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalPaymentProvider.name);

  async createPaymentIntent(input: CreateIntentInput): Promise<ProviderPaymentIntent> {
    const id = localId('pi', input.idempotencyKey);
    this.logger.log(`[local] createPaymentIntent ${id} ${input.amountMinor} ${input.currency} (order ${input.orderId})`);
    return {
      id,
      // Same shape as a real client secret so the app + the proof parse the intent id identically.
      clientSecret: `${id}_secret_${createHash('sha256').update(`${id}:secret`).digest('hex').slice(0, 24)}`,
      status: input.captureMethod === 'manual' ? 'requires_capture' : 'requires_payment_method',
      amountMinor: input.amountMinor,
      currency: input.currency,
    };
  }

  async capturePaymentIntent(input: CaptureInput): Promise<ProviderPaymentIntent> {
    return {
      id: input.paymentIntentId,
      clientSecret: `${input.paymentIntentId}_secret_captured`,
      status: 'succeeded',
      amountMinor: input.amountMinor ?? 0,
      currency: 'cad',
    };
  }

  async refund(input: RefundInput): Promise<ProviderRefund> {
    const id = localId('re', input.idempotencyKey);
    this.logger.log(`[local] refund ${id} for ${input.paymentIntentId} amount=${input.amountMinor ?? 'full'}`);
    return { id, status: 'succeeded', amountMinor: input.amountMinor ?? 0, currency: 'cad' };
  }

  async retrievePaymentIntent(id: string): Promise<ProviderPaymentIntent> {
    return { id, clientSecret: `${id}_secret_local`, status: 'succeeded', amountMinor: 0, currency: 'cad' };
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    const id = localId('in', input.idempotencyKey);
    this.logger.log(`[local] createInvoice ${id} for order ${input.orderId} (${input.lines.length} lines)`);
    return { id, status: 'draft', hostedInvoiceUrl: null };
  }

  async finalizeInvoice(invoiceId: string): Promise<ProviderInvoice> {
    return { id: invoiceId, status: 'open', hostedInvoiceUrl: null };
  }
}
