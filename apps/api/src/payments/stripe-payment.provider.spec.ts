/**
 * Request-shaping unit tests for the REAL StripePaymentProvider with the `stripe` SDK MOCKED (the
 * only mock — per the no-stub rule). The LIVE test-mode network round-trip is the deferred run
 * (parked item (d)); these prove the SHIPPED code shapes the correct Stripe requests + always passes
 * an idempotency key (no double-charge/refund on retry).
 */
import Stripe from 'stripe';
import { StripePaymentProvider } from './provider/stripe-payment.provider';
import type { PaymentsConfig } from '../config/payments.config';

jest.mock('stripe');

const fake = {
  paymentIntents: { create: jest.fn(), capture: jest.fn(), retrieve: jest.fn() },
  refunds: { create: jest.fn() },
  customers: { create: jest.fn() },
  invoiceItems: { create: jest.fn() },
  invoices: { create: jest.fn(), finalizeInvoice: jest.fn() },
};

const config: PaymentsConfig = {
  stripe: { secretKey: 'sk_test_x', webhookSecret: 'whsec_test', publishableKey: 'pk_test_x' },
  currency: 'CAD',
  captureTiming: 'on_approval',
  maxPaymentAttempts: 4,
  invoiceDueDays: 14,
};

describe('StripePaymentProvider (request shaping; SDK mocked)', () => {
  let provider: StripePaymentProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    (Stripe as unknown as jest.Mock).mockImplementation(() => fake);
    provider = new StripePaymentProvider(config);
  });

  it('createPaymentIntent: server amount + currency + capture method + tenancy metadata + idempotency key', async () => {
    fake.paymentIntents.create.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret_abc', status: 'requires_payment_method', amount: 29380, currency: 'cad' });
    const res = await provider.createPaymentIntent({
      amountMinor: 29380,
      currency: 'cad',
      orderId: 'order-1',
      orgId: 'org-1',
      accountId: 'acct-1',
      customerEmail: 'rita@example.com',
      description: 'Order order-1',
      idempotencyKey: 'pi-order-order-1-1',
      captureMethod: 'automatic',
    });
    expect(res).toEqual({ id: 'pi_1', clientSecret: 'pi_1_secret_abc', status: 'requires_payment_method', amountMinor: 29380, currency: 'cad' });
    const [params, opts] = fake.paymentIntents.create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 29380,
      currency: 'cad',
      capture_method: 'automatic',
      receipt_email: 'rita@example.com',
      metadata: { orgId: 'org-1', orderId: 'order-1', accountId: 'acct-1' },
      automatic_payment_methods: { enabled: true },
    });
    expect(opts).toEqual({ idempotencyKey: 'pi-order-order-1-1' });
  });

  it('createPaymentIntent: manual capture (capture-later setting) shapes capture_method=manual', async () => {
    fake.paymentIntents.create.mockResolvedValue({ id: 'pi_2', client_secret: 'pi_2_secret', status: 'requires_capture', amount: 100, currency: 'cad' });
    await provider.createPaymentIntent({ amountMinor: 100, currency: 'cad', orderId: 'o', orgId: 'g', accountId: 'a', idempotencyKey: 'k', captureMethod: 'manual' });
    expect(fake.paymentIntents.create.mock.calls[0][0].capture_method).toBe('manual');
  });

  it('throws if Stripe returns no client_secret (never hand the app a broken intent)', async () => {
    fake.paymentIntents.create.mockResolvedValue({ id: 'pi_x', client_secret: null, status: 'requires_payment_method', amount: 1, currency: 'cad' });
    await expect(provider.createPaymentIntent({ amountMinor: 1, currency: 'cad', orderId: 'o', orgId: 'g', accountId: 'a', idempotencyKey: 'k', captureMethod: 'automatic' })).rejects.toThrow(/client_secret/);
  });

  it('refund: passes payment_intent + amount + a valid reason + idempotency key', async () => {
    fake.refunds.create.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 10000, currency: 'cad' });
    const res = await provider.refund({ paymentIntentId: 'pi_1', amountMinor: 10000, reason: 'requested_by_customer', idempotencyKey: 're-1', orgId: 'org-1', orderId: 'order-1' });
    expect(res).toEqual({ id: 're_1', status: 'succeeded', amountMinor: 10000, currency: 'cad' });
    const [params, opts] = fake.refunds.create.mock.calls[0];
    expect(params).toMatchObject({ payment_intent: 'pi_1', amount: 10000, reason: 'requested_by_customer', metadata: { orgId: 'org-1', orderId: 'order-1' } });
    expect(opts).toEqual({ idempotencyKey: 're-1' });
  });

  it('refund: a non-Stripe reason ("other") is omitted from reason and carried in metadata.note', async () => {
    fake.refunds.create.mockResolvedValue({ id: 're_2', status: 'succeeded', amount: 5, currency: 'cad' });
    await provider.refund({ paymentIntentId: 'pi_1', amountMinor: 5, reason: 'other', idempotencyKey: 're-2', orgId: 'org-1' });
    const params = fake.refunds.create.mock.calls[0][0];
    expect(params.reason).toBeUndefined();
    expect(params.metadata.note).toBe('other');
  });

  it('refund: full refund (omitted amount) sends no `amount` (Stripe refunds the full balance)', async () => {
    fake.refunds.create.mockResolvedValue({ id: 're_3', status: 'succeeded', amount: 29380, currency: 'cad' });
    await provider.refund({ paymentIntentId: 'pi_1', idempotencyKey: 're-3', orgId: 'org-1' });
    expect(fake.refunds.create.mock.calls[0][0].amount).toBeUndefined();
  });

  it('capturePaymentIntent: passes amount_to_capture + idempotency key', async () => {
    fake.paymentIntents.capture.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'succeeded', amount: 29380, currency: 'cad' });
    await provider.capturePaymentIntent({ paymentIntentId: 'pi_1', amountMinor: 29380, idempotencyKey: 'cap-1' });
    expect(fake.paymentIntents.capture).toHaveBeenCalledWith('pi_1', { amount_to_capture: 29380 }, { idempotencyKey: 'cap-1' });
  });
});
