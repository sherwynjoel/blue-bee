import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PAYMENTS_CONFIG, type PaymentsConfig } from '../../config/payments.config';
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

/** Stripe `refund.reason` only accepts these three; anything else rides along in metadata. */
const STRIPE_REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

/**
 * The real outbound provider — the `stripe` SDK, the SHIPPED production path (env-selected when
 * STRIPE_SECRET_KEY is present). TEST MODE ONLY. Every create-call passes an idempotency key so a
 * retry never double-charges/refunds. Its LIVE test-mode network round-trip is the deferred run
 * (parked item (d)); request-shaping is unit-tested with the SDK mocked.
 *
 * Money safety: amounts are integer minor units; we never accept a client amount here. No card data
 * ever reaches this code (the customer confirms the PaymentIntent client-side via PaymentSheet).
 */
@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly logger = new Logger(StripePaymentProvider.name);
  private readonly stripe: Stripe;

  constructor(@Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig) {
    // Constructed only when secretKey is present (the module factory guarantees this). No network
    // call happens at construction — the first real I/O is the deferred live test-mode run.
    this.stripe = new Stripe(config.stripe.secretKey as string);
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<ProviderPaymentIntent> {
    const params: Stripe.PaymentIntentCreateParams = {
      amount: input.amountMinor,
      currency: input.currency,
      capture_method: input.captureMethod,
      description: input.description,
      // metadata is how the webhook maps the Stripe object back to OUR org/order (tenancy) — never
      // trust the client; this is the trusted server-set linkage.
      metadata: { orgId: input.orgId, orderId: input.orderId, accountId: input.accountId },
      automatic_payment_methods: { enabled: true },
    };
    if (input.customerEmail) params.receipt_email = input.customerEmail;
    const pi = await this.stripe.paymentIntents.create(params, { idempotencyKey: input.idempotencyKey });
    return this.toIntent(pi);
  }

  async capturePaymentIntent(input: CaptureInput): Promise<ProviderPaymentIntent> {
    const params: Stripe.PaymentIntentCaptureParams = {};
    if (input.amountMinor !== undefined) params.amount_to_capture = input.amountMinor;
    const pi = await this.stripe.paymentIntents.capture(input.paymentIntentId, params, {
      idempotencyKey: input.idempotencyKey,
    });
    return this.toIntent(pi);
  }

  async refund(input: RefundInput): Promise<ProviderRefund> {
    const params: Stripe.RefundCreateParams = {
      payment_intent: input.paymentIntentId,
      metadata: { orgId: input.orgId, ...(input.orderId ? { orderId: input.orderId } : {}), ...(input.reason ? { note: input.reason } : {}) },
    };
    if (input.amountMinor !== undefined) params.amount = input.amountMinor;
    if (input.reason && STRIPE_REFUND_REASONS.has(input.reason)) {
      params.reason = input.reason as Stripe.RefundCreateParams.Reason;
    }
    const refund = await this.stripe.refunds.create(params, { idempotencyKey: input.idempotencyKey });
    return {
      id: refund.id,
      status: refund.status ?? 'unknown',
      amountMinor: refund.amount,
      currency: refund.currency,
    };
  }

  async retrievePaymentIntent(id: string): Promise<ProviderPaymentIntent> {
    const pi = await this.stripe.paymentIntents.retrieve(id);
    return this.toIntent(pi);
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    // Real Stripe Invoices path (outbound, deferred): a customer + invoice items + a sent invoice.
    const customer = await this.stripe.customers.create(
      { email: input.customerEmail ?? undefined, metadata: { orgId: input.orgId, accountId: input.accountId } },
      { idempotencyKey: `${input.idempotencyKey}-cust` },
    );
    for (const [i, line] of input.lines.entries()) {
      await this.stripe.invoiceItems.create(
        { customer: customer.id, amount: line.amountMinor, currency: input.currency, description: line.description },
        { idempotencyKey: `${input.idempotencyKey}-li-${i}` },
      );
    }
    const invoice = await this.stripe.invoices.create(
      {
        customer: customer.id,
        collection_method: 'send_invoice',
        days_until_due: input.daysUntilDue,
        metadata: { orgId: input.orgId, orderId: input.orderId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: invoice.id as string, status: invoice.status ?? 'draft', hostedInvoiceUrl: invoice.hosted_invoice_url ?? null };
  }

  async finalizeInvoice(invoiceId: string, idempotencyKey: string): Promise<ProviderInvoice> {
    const invoice = await this.stripe.invoices.finalizeInvoice(invoiceId, undefined, { idempotencyKey });
    return { id: invoice.id as string, status: invoice.status ?? 'open', hostedInvoiceUrl: invoice.hosted_invoice_url ?? null };
  }

  private toIntent(pi: Stripe.PaymentIntent): ProviderPaymentIntent {
    if (!pi.client_secret) {
      throw new Error(`Stripe PaymentIntent ${pi.id} has no client_secret`);
    }
    return { id: pi.id, clientSecret: pi.client_secret, status: pi.status, amountMinor: pi.amount, currency: pi.currency };
  }
}
