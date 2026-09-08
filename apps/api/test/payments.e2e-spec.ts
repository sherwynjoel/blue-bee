import { INestApplication } from '@nestjs/common';
import { OrderStatus, PrismaClient, QuoteStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { StripeEventVerifier } from '../src/payments/provider/stripe-event.verifier';

// ── Seeded ids (must match prisma/seed.ts) ──
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_B = 'e0000000-0000-4000-8000-0000000000b0';

const PHONES = {
  owner: '+14165550001', // OWNER (org-wide)
  finance: '+14165550005', // FINANCE (org-wide) — refunds / invoices / disputes
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
  acctBAdmin: '+14165550020', // ACCOUNT_ADMIN, Account B
};

/**
 * Payments / billing e2e (Increment 12) — proves the WHOLE inbound rail with Stripe's OWN signed
 * test events (`StripeEventVerifier.signTestPayload` → real `generateTestHeaderString`; the genuine
 * verification path, not a mock). Outbound create-calls run through the LocalPaymentProvider (no
 * STRIPE_SECRET_KEY in test env) — the deferred-outbound seam — while signature verification + every
 * Payment/Invoice/Refund/Dispute transition are fully real.
 */
describe('Payments e2e — Increment 12 (Stripe billing rail, signed test events)', () => {
  let app: INestApplication;
  let verifier: StripeEventVerifier;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  // A per-run nonce so event ids never collide with a PRIOR run's persisted ProcessedStripeEvent rows
  // (the ledger is never reset between runs) — keeping the suite re-runnable while still letting an
  // explicit id collide WITHIN a run (the redelivery/idempotency tests).
  const runNonce = randomUUID().slice(0, 8);
  let evtSeq = 0;

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

  /** Build, sign, and POST a Stripe event. Returns the supertest response. */
  const fire = (type: string, object: Record<string, unknown>, opts?: { id?: string; badSig?: boolean; tamper?: boolean }) => {
    const id = `${runNonce}_${opts?.id ?? `evt_${type.replace(/\W/g, '_')}_${++evtSeq}`}`;
    const payload = JSON.stringify({ id, object: 'event', api_version: '2024-06-20', type, data: { object } });
    const signature = opts?.badSig ? 't=1,v1=deadbeef' : verifier.signTestPayload(opts?.tamper ? `${payload} ` : payload);
    return request(app.getHttpServer())
      .post('/v1/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  };

  /** Insert an order with an APPROVED quote (the payable precondition) at the given payable status. */
  async function makeApprovedOrder(accountId = ACCOUNT_A, total = '293.80', status: OrderStatus = OrderStatus.QUOTE_APPROVED): Promise<string> {
    const order = await prisma.order.create({
      data: {
        orgId: ORG1,
        accountId,
        status,
        totals: { subtotal: '260.00', tax: '33.80', total, currency: 'CAD' },
      },
    });
    await prisma.quote.create({
      data: {
        orgId: ORG1,
        orderId: order.id,
        lines: [{ serviceName: 'Rug cleaning', amount: '260.00' }],
        subtotal: '260.00',
        tax: '33.80',
        total,
        status: QuoteStatus.APPROVED,
        approvedAt: new Date(),
      },
    });
    return order.id;
  }

  const piFromSecret = (clientSecret: string): string => clientSecret.split('_secret_')[0];

  beforeAll(async () => {
    app = await createTestApp();
    verifier = app.get(StripeEventVerifier);
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  // ─────────────────────────── take-payment + succeeded (the happy path) ───────────────────────────

  describe('take-payment → payment_intent.succeeded → paid + receipt', () => {
    let orderId: string;
    let paymentId: string;
    let piId: string;

    it('creates a PaymentIntent for the SERVER-computed amount (client never supplies it)', async () => {
      orderId = await makeApprovedOrder();
      const res = await post(`/v1/orders/${orderId}/payment-intent`, 'rita', { note: 'ignored by amount' }).expect(201);
      expect(res.body.amount).toBe('293.80'); // = approved quote total incl. HST, server-computed
      expect(res.body.currency).toBe('CAD');
      expect(res.body.status).toBe('PENDING');
      expect(typeof res.body.clientSecret).toBe('string');
      expect(res.body.clientSecret).toContain('_secret_');
      paymentId = res.body.paymentId;
      piId = piFromSecret(res.body.clientSecret);
    });

    it('re-attempt returns the SAME intent (idempotent — no second pending charge)', async () => {
      const res = await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201);
      expect(res.body.paymentId).toBe(paymentId);
      expect(piFromSecret(res.body.clientSecret)).toBe(piId);
      const count = await prisma.payment.count({ where: { orderId } });
      expect(count).toBe(1);
    });

    it('payment is PENDING until the webhook confirms it', async () => {
      const res = await get(`/v1/orders/${orderId}/payment`, 'rita').expect(200);
      expect(res.body.status).toBe('PENDING');
    });

    it('a signed payment_intent.succeeded marks it SUCCEEDED + generates the PAID receipt + mirrors order billing state', async () => {
      await fire('payment_intent.succeeded', {
        id: piId,
        object: 'payment_intent',
        amount: 29380,
        amount_received: 29380,
        currency: 'cad',
        status: 'succeeded',
        latest_charge: `ch_${runNonce}_A`,
        metadata: { orgId: ORG1, orderId, accountId: ACCOUNT_A },
      }).expect(200);

      const pay = (await get(`/v1/orders/${orderId}/payment`, 'rita').expect(200)).body;
      expect(pay.status).toBe('SUCCEEDED');
      expect(pay.capturedAmount).toBe('293.80');

      const inv = (await get(`/v1/orders/${orderId}/invoice`, 'rita').expect(200)).body;
      expect(inv.status).toBe('PAID');
      expect(inv.total).toBe('293.80');
      expect(inv.lines.some((l: { description: string }) => l.description.includes('HST'))).toBe(true);

      const order = (await get(`/v1/orders/${orderId}`, 'rita').expect(200)).body;
      expect(order.totals.paymentStatus).toBe('PAID');
    });

    it('enqueues a customer receipt notification (Inc-8 engine, owning customer)', async () => {
      const n = await prisma.notification.findFirst({ where: { eventType: 'payment.receipt', payload: { path: ['orderId'], equals: orderId } } });
      expect(n).toBeTruthy();
    });

    it('REDELIVERY of the same event id is a no-op (idempotent): still one payment, one invoice, one ledger row', async () => {
      await fire('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 29380, currency: 'cad', status: 'succeeded', metadata: { orgId: ORG1, orderId } }, { id: 'evt_dupe_A' }).expect(200);
      await fire('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 29380, currency: 'cad', status: 'succeeded', metadata: { orgId: ORG1, orderId } }, { id: 'evt_dupe_A' }).expect(200);
      expect(await prisma.invoice.count({ where: { orderId } })).toBe(1);
      expect(await prisma.processedStripeEvent.count({ where: { eventId: `${runNonce}_evt_dupe_A` } })).toBe(1);
      expect((await get(`/v1/orders/${orderId}/payment`, 'rita').expect(200)).body.status).toBe('SUCCEEDED');
    });

    it('rejects double payment: a second create-intent on a paid order → 409', async () => {
      await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(409);
    });
  });

  // ─────────────────────────── Inc-31 — the DELIVERED → INVOICED path is now live ───────────────────────────

  // Inc-31 makes DELIVERED a genuinely reachable order state (the POD-gated delivery-stop completion is
  // proven end-to-end in pod.e2e-spec.ts). This closes the loop: a payment confirmed while the order is
  // DELIVERED advances the §5.1 spine DELIVERED → INVOICED (payment.service.ts:maybeAdvanceToInvoiced),
  // a path that could never fire before because no order ever reached DELIVERED.
  describe('a DELIVERED order invoices when its payment confirms', () => {
    it('payment_intent.succeeded on a DELIVERED order advances DELIVERED → INVOICED', async () => {
      const orderId = await makeApprovedOrder(ACCOUNT_A, '293.80', OrderStatus.DELIVERED);
      const pi = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body; // DELIVERED is payable
      const piId = piFromSecret(pi.clientSecret);

      await fire('payment_intent.succeeded', {
        id: piId,
        object: 'payment_intent',
        amount: 29380,
        amount_received: 29380,
        currency: 'cad',
        status: 'succeeded',
        latest_charge: `ch_${runNonce}_DEL`,
        metadata: { orgId: ORG1, orderId, accountId: ACCOUNT_A },
      }).expect(200);

      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(OrderStatus.INVOICED);
      // ...and the billing artefacts still land (paid invoice + mirrored order billing state).
      expect((await get(`/v1/orders/${orderId}/invoice`, 'rita').expect(200)).body.status).toBe('PAID');
      expect((await get(`/v1/orders/${orderId}`, 'rita').expect(200)).body.totals.paymentStatus).toBe('PAID');
    });
  });

  // ─────────────────────────── webhook security ───────────────────────────

  describe('webhook signature security', () => {
    it('a forged signature → 400', async () => {
      await fire('payment_intent.succeeded', { id: 'pi_x', object: 'payment_intent', amount: 1, currency: 'cad' }, { badSig: true }).expect(400);
    });
    it('a tampered body (valid sig over different bytes) → 400', async () => {
      await fire('payment_intent.succeeded', { id: 'pi_y', object: 'payment_intent', amount: 1, currency: 'cad' }, { tamper: true }).expect(400);
    });
    it('a missing signature header → 400', async () => {
      await request(app.getHttpServer()).post('/v1/webhooks/stripe').set('content-type', 'application/json').send('{}').expect(400);
    });
    it('an unmapped intent (maps to no Payment) is recorded + no-op (no cross-tenant guess)', async () => {
      await fire('payment_intent.succeeded', { id: 'pi_does_not_exist', object: 'payment_intent', amount: 999, currency: 'cad', metadata: { orgId: ORG1 } }, { id: 'evt_unmapped' }).expect(200);
      expect(await prisma.payment.count({ where: { stripePaymentIntentId: 'pi_does_not_exist' } })).toBe(0);
    });
  });

  // ─────────────────────────── tenancy + RBAC ───────────────────────────

  describe('tenancy + RBAC', () => {
    it("a customer cannot pay another account's order (cross-account → 403)", async () => {
      const orderB = await makeApprovedOrder(ACCOUNT_B);
      await post(`/v1/orders/${orderB}/payment-intent`, 'rita').expect(403);
    });
    it('a customer cannot refund (role → 403) and cannot generate an invoice (403)', async () => {
      const orderId = await makeApprovedOrder();
      const pay = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body;
      await post(`/v1/payments/${pay.paymentId}/refund`, 'rita', { amount: 1 }).expect(403);
      await post(`/v1/orders/${orderId}/invoice`, 'rita').expect(403);
    });
    it('a customer cannot list disputes (403); finance can (200)', async () => {
      await get('/v1/disputes', 'rita').expect(403);
      await get('/v1/disputes', 'finance').expect(200);
    });
  });

  // ─────────────────────────── failed payment → dunning + re-attempt ───────────────────────────

  describe('payment_intent.payment_failed → FAILED + dunning + re-attempt', () => {
    it('marks FAILED, mirrors order state, enqueues dunning, and allows a fresh re-attempt', async () => {
      const orderId = await makeApprovedOrder();
      const pay = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body;
      const piId = piFromSecret(pay.clientSecret);

      await fire('payment_intent.payment_failed', {
        id: piId,
        object: 'payment_intent',
        amount: 29380,
        currency: 'cad',
        status: 'requires_payment_method',
        last_payment_error: { message: 'Your card was declined.' },
        metadata: { orgId: ORG1, orderId },
      }).expect(200);

      expect((await get(`/v1/orders/${orderId}/payment`, 'rita').expect(200)).body.status).toBe('FAILED');
      expect((await get(`/v1/orders/${orderId}`, 'rita').expect(200)).body.totals.paymentStatus).toBe('FAILED');

      const dunning = await prisma.notification.findFirst({ where: { eventType: 'payment.failed', payload: { path: ['orderId'], equals: orderId } } });
      expect(dunning).toBeTruthy();

      // Re-attempt creates a fresh PENDING payment (a NEW intent).
      const retry = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body;
      expect(retry.status).toBe('PENDING');
      expect(await prisma.payment.count({ where: { orderId } })).toBe(2);
    });
  });

  // ─────────────────────────── concurrency: no orphaned duplicate payment rows ───────────────────────────

  describe('order-level payment concurrency (double-tap / retry safety)', () => {
    it('two concurrent create-intent calls for the same order converge on ONE payment row, never two', async () => {
      const orderId = await makeApprovedOrder();

      const [a, b] = await Promise.all([
        post(`/v1/orders/${orderId}/payment-intent`, 'rita'),
        post(`/v1/orders/${orderId}/payment-intent`, 'rita'),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.paymentId).toBe(b.body.paymentId); // same row reused, not a second PENDING payment

      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
      const row = await prisma.payment.findFirstOrThrow({ where: { orderId } });
      expect(row.stripePaymentIntentId).toBeTruthy(); // never left null/orphaned by a losing concurrent update
      expect(row.status).toBe('PENDING');
    });
  });

  // ─────────────────────────── refunds (full + partial, owner/finance) ───────────────────────────

  describe('refunds + charge.refunded', () => {
    let orderId: string;
    let paymentId: string;
    let piId: string;

    beforeAll(async () => {
      orderId = await makeApprovedOrder();
      const pay = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body;
      paymentId = pay.paymentId;
      piId = piFromSecret(pay.clientSecret);
      await fire('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 29380, currency: 'cad', status: 'succeeded', latest_charge: `ch_${runNonce}_refund`, metadata: { orgId: ORG1, orderId } }).expect(200);
    });

    it('finance can partially refund (refund ≤ captured); order shows PARTIALLY_REFUNDED', async () => {
      const r = (await post(`/v1/payments/${paymentId}/refund`, 'finance', { amount: 100, reason: 'requested_by_customer' }).expect(201)).body;
      expect(r.amount).toBe('100.00');
      expect(r.status).toBe('SUCCEEDED');
      const pay = (await get(`/v1/orders/${orderId}/payment`, 'rita').expect(200)).body;
      expect(pay.refundedAmount).toBe('100.00');
      expect(pay.status).toBe('SUCCEEDED');
      expect((await get(`/v1/orders/${orderId}`, 'rita').expect(200)).body.totals.paymentStatus).toBe('PARTIALLY_REFUNDED');
    });

    it('charge.refunded reconciles to the authoritative total (idempotent)', async () => {
      await fire('charge.refunded', { id: `ch_${runNonce}_refund`, object: 'charge', payment_intent: piId, amount: 29380, amount_refunded: 10000, currency: 'cad', metadata: { orgId: ORG1, orderId } }).expect(200);
      expect((await get(`/v1/orders/${orderId}/payment`, 'rita').expect(200)).body.refundedAmount).toBe('100.00');
    });

    it('a full refund of the remainder flips the payment to REFUNDED', async () => {
      const r = (await post(`/v1/payments/${paymentId}/refund`, 'finance', {}).expect(201)).body;
      expect(r.amount).toBe('193.80');
      const pay = (await get(`/v1/orders/${orderId}/payment`, 'rita').expect(200)).body;
      expect(pay.refundedAmount).toBe('293.80');
      expect(pay.status).toBe('REFUNDED');
      expect((await get(`/v1/orders/${orderId}`, 'rita').expect(200)).body.totals.paymentStatus).toBe('REFUNDED');
    });

    it('an over-refund is rejected (422 refund exceeds captured)', async () => {
      await post(`/v1/payments/${paymentId}/refund`, 'finance', { amount: 50 }).expect(422);
    });

    it('charge.refunded ALONE (dashboard-initiated, API never called) creates a SUCCEEDED refund row', async () => {
      const o2 = await makeApprovedOrder();
      const p2 = (await post(`/v1/orders/${o2}/payment-intent`, 'rita').expect(201)).body;
      const pi2 = piFromSecret(p2.clientSecret);
      await fire('payment_intent.succeeded', { id: pi2, object: 'payment_intent', amount: 29380, currency: 'cad', status: 'succeeded', latest_charge: `ch_${runNonce}_dash`, metadata: { orgId: ORG1, orderId: o2 } }).expect(200);
      await fire('charge.refunded', { id: `ch_${runNonce}_dash`, object: 'charge', payment_intent: pi2, amount: 29380, amount_refunded: 29380, currency: 'cad', metadata: { orgId: ORG1, orderId: o2 } }).expect(200);
      const refunds = await prisma.refund.findMany({ where: { paymentId: p2.paymentId } });
      expect(refunds.length).toBe(1);
      expect(refunds[0].status).toBe('SUCCEEDED');
      expect((await get(`/v1/orders/${o2}/payment`, 'rita').expect(200)).body.status).toBe('REFUNDED');
    });
  });

  // ─────────────────────────── disputes ───────────────────────────

  describe('disputes (charge.dispute.created/.closed)', () => {
    let orderId: string;
    let piId: string;

    beforeAll(async () => {
      orderId = await makeApprovedOrder();
      const pay = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body;
      piId = piFromSecret(pay.clientSecret);
      await fire('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 29380, currency: 'cad', status: 'succeeded', latest_charge: `ch_${runNonce}_disp`, metadata: { orgId: ORG1, orderId } }).expect(200);
    });

    it('charge.dispute.created records an OPEN dispute + alerts owner/finance (not the customer)', async () => {
      await fire('charge.dispute.created', {
        id: `dp_${runNonce}_E`,
        object: 'dispute',
        payment_intent: piId,
        charge: `ch_${runNonce}_disp`,
        amount: 29380,
        currency: 'cad',
        reason: 'fraudulent',
        status: 'needs_response',
        evidence_details: { due_by: 1893456000 },
        metadata: { orgId: ORG1, orderId },
      }).expect(200);

      const disputes = (await get('/v1/disputes', 'finance').expect(200)).body as Array<{ status: string; orderId: string; amount: string }>;
      const d = disputes.find((x) => x.orderId === orderId);
      expect(d?.status).toBe('OPEN');
      expect(d?.amount).toBe('293.80');

      // Alert went to org staff (owner/finance), never the customer.
      const alert = await prisma.notification.findFirst({ where: { eventType: 'payment.dispute', sourceType: 'Dispute' } });
      expect(alert).toBeTruthy();
    });

    it('redelivery of dispute.created is a no-op (one dispute)', async () => {
      await fire('charge.dispute.created', { id: `dp_${runNonce}_E`, object: 'dispute', payment_intent: piId, charge: `ch_${runNonce}_disp`, amount: 29380, currency: 'cad', reason: 'fraudulent', status: 'needs_response', metadata: { orgId: ORG1, orderId } }, { id: 'evt_disp_dupe' }).expect(200);
      expect(await prisma.dispute.count({ where: { stripeDisputeId: `dp_${runNonce}_E` } })).toBe(1);
    });

    it('charge.dispute.closed (lost) resolves the dispute', async () => {
      await fire('charge.dispute.closed', { id: `dp_${runNonce}_E`, object: 'dispute', status: 'lost' }).expect(200);
      const disputes = (await get('/v1/disputes', 'finance').expect(200)).body as Array<{ stripeDisputeId?: string; status: string; orderId: string }>;
      const d = disputes.find((x) => x.orderId === orderId);
      expect(d?.status).toBe('LOST');
    });
  });

  // ─────────────────────────── invoicing (Stripe-invoice path + invoice.* webhooks) ───────────────────────────

  describe('invoicing + invoice.* webhooks', () => {
    it('finance generates an invoice; invoice.paid → PAID', async () => {
      const orderId = await makeApprovedOrder();
      const inv = (await post(`/v1/orders/${orderId}/invoice`, 'finance', { dueInDays: 7 }).expect(201)).body;
      expect(inv.status).toBe('ISSUED');
      const row = await prisma.invoice.findFirstOrThrow({ where: { orderId } });
      expect(row.stripeInvoiceId).toBeTruthy();
      await fire('invoice.paid', { id: row.stripeInvoiceId, object: 'invoice', status: 'paid', metadata: { orgId: ORG1, orderId } }).expect(200);
      expect((await get(`/v1/orders/${orderId}/invoice`, 'finance').expect(200)).body.status).toBe('PAID');
    });

    it('invoice.payment_failed → OVERDUE', async () => {
      const orderId = await makeApprovedOrder();
      await post(`/v1/orders/${orderId}/invoice`, 'finance').expect(201);
      const row = await prisma.invoice.findFirstOrThrow({ where: { orderId } });
      await fire('invoice.payment_failed', { id: row.stripeInvoiceId, object: 'invoice', status: 'open', metadata: { orgId: ORG1, orderId } }).expect(200);
      expect((await get(`/v1/orders/${orderId}/invoice`, 'finance').expect(200)).body.status).toBe('OVERDUE');
    });
  });
});
