import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { StripeEventVerifier } from '../src/payments/provider/stripe-event.verifier';

/**
 * B2B self-serve invoice portal e2e (Track A). Boots the real app against the real (migrated) Postgres
 * + Redis. Proves the Definition of Done end-to-end:
 *   • Account-admin invoice READS — `GET /v1/invoices` lists ONLY the caller's own account's invoices;
 *     `GET /v1/invoices/:id` returns header + lines + the cost-centre split (sums EXACTLY to the total).
 *   • Tenancy — a cross-account invoice → 404 (read); a cross-org id → 404; a non-read role → 403.
 *   • Invoice-level PAY — `POST /v1/invoices/:id/payment-intent` returns the client secret only with the
 *     SERVER-computed amount (= invoice total incl. HST); a re-attempt reuses the pending intent (no
 *     double-charge); a cross-account pay → 403; a cross-org pay → 404.
 *   • Webhook is source of truth — a SIGNED `payment_intent.succeeded` flips the invoice → PAID (+ the
 *     payment SUCCEEDED); a forged/unsigned event → 400; a redelivery is a no-op; a paid invoice → 409.
 *   • PDF statement — `GET /v1/invoices/:id/statement.pdf` streams real %PDF bytes (account-scoped).
 *
 * Self-contained fixture under Org-1 with deterministic `b1b`-prefixed ids — created + torn down here,
 * so the suite never corrupts the demo seed and is re-runnable.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';

const ACC_A = 'b1b00000-0000-4000-8000-0000000000a0'; // the caller's account (BATCH_PERIODIC condo)
const ACC_B = 'b1b00000-0000-4000-8000-0000000000b0'; // a DIFFERENT account, same org (cross-account probe)
const USER_ADMIN_A = 'b1b00000-0000-4000-8000-0000000000a1';
const ROLE_ADMIN_A = 'b1b00000-0000-4000-8000-0000000000a2';
const USER_ADMIN_B = 'b1b00000-0000-4000-8000-0000000000b1';
const ROLE_ADMIN_B = 'b1b00000-0000-4000-8000-0000000000b2';
const CC1 = 'b1b00000-0000-4000-8000-0000000000c1';
const CC2 = 'b1b00000-0000-4000-8000-0000000000c2';
const INV_A = 'b1b00000-0000-4000-8000-0000000000f1'; // ISSUED, with a 2-cost-centre split (the pay subject)
const INV_B = 'b1b00000-0000-4000-8000-0000000000f2'; // ISSUED, on ACC_B (cross-account isolation probe)
const LINE_1 = 'b1b00000-0000-4000-8000-0000000000d1';
const LINE_2 = 'b1b00000-0000-4000-8000-0000000000d2';

// Seeded principals (by phone) for support + RBAC/cross-org negatives.
const PHONES = {
  owner: '+14165550001', // OWNER (Org 1) — support read
  finance: '+14165550005', // FINANCE (Org 1) — support read
  driver: '+14165550006', // DRIVER — not a read role → 403
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER → 403
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org isolation probe → 404
};

// The split reconciles exactly: CC1 100/13/113 + CC2 200/26/226 = 300/39/339.
const BREAKDOWN = [
  { costCenterId: CC1, code: 'TWR-A', name: 'Tower A', subtotal: '100.00', tax: '13.00', total: '113.00' },
  { costCenterId: CC2, code: 'TWR-B', name: 'Tower B', subtotal: '200.00', tax: '26.00', total: '226.00' },
];

async function tearDown(prisma: PrismaClient): Promise<void> {
  // NB: never delete the fixture USERS — they are referenced as AuditLog.actorId (FK ON DELETE SET NULL)
  // and AuditLog is append-only (a trigger blocks the UPDATE → 23514). We upsert them instead (idempotent),
  // exactly like the seeded-user pattern the other e2e specs rely on.
  const accts = [ACC_A, ACC_B];
  await prisma.payment.deleteMany({ where: { accountId: { in: accts } } });
  await prisma.invoice.deleteMany({ where: { accountId: { in: accts } } }); // cascades InvoiceLine
  await prisma.costCenter.deleteMany({ where: { accountId: { in: accts } } });
  await prisma.account.deleteMany({ where: { id: { in: accts } } });
}

async function seedFixture(prisma: PrismaClient): Promise<void> {
  await prisma.account.createMany({
    data: [
      { id: ACC_A, orgId: ORG1, type: 'BUSINESS', name: 'B2B E2E — Account A (batch)', billingMode: 'BATCH_PERIODIC', billingNetDays: 30 },
      { id: ACC_B, orgId: ORG1, type: 'BUSINESS', name: 'B2B E2E — Account B' },
    ],
  });
  // Upsert the two account-admin users + their grants (idempotent — left in place across runs).
  for (const u of [
    { id: USER_ADMIN_A, name: 'B2B E2E Admin A', phone: '+14165550901', email: 'admin-a@b2b-e2e.example' },
    { id: USER_ADMIN_B, name: 'B2B E2E Admin B', phone: '+14165550902', email: 'admin-b@b2b-e2e.example' },
  ]) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { name: u.name, phone: u.phone, status: 'ACTIVE' },
      create: { id: u.id, orgId: ORG1, name: u.name, phone: u.phone, email: u.email, authProviders: ['phone'], status: 'ACTIVE' },
    });
  }
  for (const r of [
    { id: ROLE_ADMIN_A, userId: USER_ADMIN_A, scopeId: ACC_A },
    { id: ROLE_ADMIN_B, userId: USER_ADMIN_B, scopeId: ACC_B },
  ]) {
    await prisma.userRole.upsert({
      where: { id: r.id },
      update: { scopeId: r.scopeId },
      create: { id: r.id, orgId: ORG1, userId: r.userId, role: 'ACCOUNT_ADMIN', scope: 'ACCOUNT', scopeId: r.scopeId },
    });
  }
  await prisma.costCenter.createMany({
    data: [
      { id: CC1, orgId: ORG1, accountId: ACC_A, code: 'TWR-A', name: 'Tower A', kind: 'WING' },
      { id: CC2, orgId: ORG1, accountId: ACC_A, code: 'TWR-B', name: 'Tower B', kind: 'WING' },
    ],
  });
  await prisma.invoice.create({
    data: {
      id: INV_A, orgId: ORG1, accountId: ACC_A, period: '2026-06-b2b-e2e', number: 'B2B-E2E-A-2026-06',
      lines: BREAKDOWN.map((b) => ({ description: `Amenity linen — ${b.name}`, quantity: 1, amount: b.subtotal })),
      subtotal: '300.00', tax: '39.00', total: '339.00', currency: 'CAD', status: 'ISSUED',
      issuedAt: new Date('2026-06-01T00:00:00.000Z'), dueAt: new Date('2026-07-01T00:00:00.000Z'),
      costCenterBreakdown: BREAKDOWN,
    },
  });
  await prisma.invoiceLine.createMany({
    data: [
      { id: LINE_1, orgId: ORG1, invoiceId: INV_A, description: 'Amenity linen — Tower A', quantity: 1, unitAmount: '100.00', amount: '100.00', costCenterId: CC1 },
      { id: LINE_2, orgId: ORG1, invoiceId: INV_A, description: 'Amenity linen — Tower B', quantity: 1, unitAmount: '200.00', amount: '200.00', costCenterId: CC2 },
    ],
  });
  await prisma.invoice.create({
    data: {
      id: INV_B, orgId: ORG1, accountId: ACC_B, number: 'B2B-E2E-B-2026-06',
      subtotal: '100.00', tax: '13.00', total: '113.00', currency: 'CAD', status: 'ISSUED',
      issuedAt: new Date('2026-06-01T00:00:00.000Z'), dueAt: new Date('2026-07-01T00:00:00.000Z'),
    },
  });
}

describe('B2B self-serve invoice portal e2e (Track A)', () => {
  let app: INestApplication;
  let verifier: StripeEventVerifier;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const runNonce = randomUUID().slice(0, 8); // event ids must not collide across runs (ledger never reset)
  let evtSeq = 0;

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: object = {}) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body);
  const cents = (s: string): number => Math.round(Number(s) * 100);

  /** Build, sign, and POST a Stripe event (badSig forges an invalid signature). */
  const fire = (type: string, object: Record<string, unknown>, opts?: { id?: string; badSig?: boolean }) => {
    const id = `${runNonce}_${opts?.id ?? `evt_${++evtSeq}`}`;
    const payload = JSON.stringify({ id, object: 'event', api_version: '2024-06-20', type, data: { object } });
    const signature = opts?.badSig ? 't=1,v1=deadbeef' : verifier.signTestPayload(payload);
    return request(app.getHttpServer()).post('/v1/webhooks/stripe').set('content-type', 'application/json').set('stripe-signature', signature).send(payload);
  };

  beforeAll(async () => {
    app = await createTestApp();
    verifier = app.get(StripeEventVerifier);
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    await tearDown(prisma);
    await seedFixture(prisma);
    const mint = async (where: { id?: string; phone?: string }): Promise<string> => {
      const user = await prisma.user.findFirstOrThrow({ where });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      return tokens.signAccess(user, roles, scope);
    };
    token.adminA = await mint({ id: USER_ADMIN_A });
    token.adminB = await mint({ id: USER_ADMIN_B });
    for (const [name, phone] of Object.entries(PHONES)) token[name] = await mint({ phone });
  }, 60000);

  afterAll(async () => {
    await tearDown(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  // ─────────────────────────── reads + tenancy ───────────────────────────

  it('lists ONLY the caller account’s invoices (account confinement)', async () => {
    const res = await get('/v1/invoices', 'adminA').expect(200);
    const ids = res.body.invoices.map((i: { id: string }) => i.id);
    expect(ids).toContain(INV_A);
    expect(ids).not.toContain(INV_B); // INV_B is a different account in the same org — invisible
  });

  it('returns the detail with lines + a cost-centre split that reconciles to the total', async () => {
    const res = await get(`/v1/invoices/${INV_A}`, 'adminA').expect(200);
    expect(res.body.status).toBe('ISSUED');
    expect(res.body.total).toBe('339.00');
    expect(res.body.lines).toHaveLength(2);
    const split = res.body.costCenterBreakdown as Array<{ subtotal: string; tax: string; total: string }>;
    expect(split.length).toBe(2);
    // every bucket: subtotal + tax === total; all buckets sum EXACTLY to the invoice totals (cents-exact).
    for (const b of split) expect(cents(b.subtotal) + cents(b.tax)).toBe(cents(b.total));
    expect(split.reduce((a, b) => a + cents(b.subtotal), 0)).toBe(cents(res.body.subtotal));
    expect(split.reduce((a, b) => a + cents(b.tax), 0)).toBe(cents(res.body.tax));
    expect(split.reduce((a, b) => a + cents(b.total), 0)).toBe(cents(res.body.total));
  });

  it('hides a cross-account invoice (404, not 403 — no existence leak on reads)', async () => {
    await get(`/v1/invoices/${INV_B}`, 'adminA').expect(404);
  });

  it('hides a cross-org invoice (404)', async () => {
    await get(`/v1/invoices/${INV_A}`, 'org2owner').expect(404);
    const list = await get('/v1/invoices', 'org2owner').expect(200);
    expect(list.body.invoices.map((i: { id: string }) => i.id)).not.toContain(INV_A);
  });

  it('lets OWNER/FINANCE support read; rejects non-read roles (403)', async () => {
    await get(`/v1/invoices/${INV_A}`, 'finance').expect(200);
    await get(`/v1/invoices/${INV_A}`, 'owner').expect(200);
    await get('/v1/invoices', 'driver').expect(403);
    await get('/v1/invoices', 'rita').expect(403);
  });

  it('streams a real PDF statement (account-scoped bytes)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/invoices/${INV_A}/statement.pdf`)
      .set('Authorization', `Bearer ${token.adminA}`)
      .buffer()
      .parse((response, cb) => {
        const data: Buffer[] = [];
        response.on('data', (c: Buffer) => data.push(Buffer.from(c)));
        response.on('end', () => cb(null, Buffer.concat(data)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const buf = res.body as Buffer;
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(1000);
    // cross-account PDF is hidden too
    await get(`/v1/invoices/${INV_B}/statement.pdf`, 'adminA').expect(404);
  });

  // ─────────────────────────── invoice-level pay ───────────────────────────

  let clientSecret = '';
  let piId = '';

  it('creates a PaymentIntent with the SERVER-computed amount, returning only the client secret', async () => {
    const res = await post(`/v1/invoices/${INV_A}/payment-intent`, 'adminA').expect(201);
    expect(res.body.clientSecret).toBeTruthy();
    expect(res.body.amount).toBe('339.00'); // = invoice.total incl. HST — never a client amount
    expect(res.body.status).toBe('PENDING');
    expect(res.body).not.toHaveProperty('secretKey');
    clientSecret = res.body.clientSecret;
    piId = clientSecret.split('_secret_')[0];
  });

  it('re-attempt reuses the SAME pending intent (no double-charge)', async () => {
    const res = await post(`/v1/invoices/${INV_A}/payment-intent`, 'adminA').expect(201);
    expect(res.body.clientSecret).toBe(clientSecret);
    const count = await prisma.payment.count({ where: { invoiceId: INV_A } });
    expect(count).toBe(1); // exactly one Payment row across both attempts
  });

  it('rejects a cross-account pay (403) and a cross-org pay (404)', async () => {
    await post(`/v1/invoices/${INV_A}/payment-intent`, 'adminB').expect(403); // same org, different account
    await post(`/v1/invoices/${INV_A}/payment-intent`, 'org2owner').expect(404); // different org
  });

  it('rejects a forged/unsigned webhook (400) and does NOT flip the invoice', async () => {
    await fire('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 33900, amount_received: 33900, currency: 'cad', status: 'succeeded', metadata: { orgId: ORG1, invoiceId: INV_A } }, { id: 'forged', badSig: true }).expect(400);
    const still = await get(`/v1/invoices/${INV_A}`, 'adminA').expect(200);
    expect(still.body.status).toBe('ISSUED'); // unchanged — the client can't settle the invoice
  });

  it('flips the invoice → PAID only on a SIGNED payment_intent.succeeded (+ payment SUCCEEDED)', async () => {
    await fire('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 33900, amount_received: 33900, currency: 'cad', status: 'succeeded', latest_charge: `${runNonce}_ch`, metadata: { orgId: ORG1, invoiceId: INV_A } }, { id: 'succ' }).expect(200);
    const inv = await get(`/v1/invoices/${INV_A}`, 'adminA').expect(200);
    expect(inv.body.status).toBe('PAID');
    expect(inv.body.paidAt).toBeTruthy();
    const pay = await get(`/v1/invoices/${INV_A}/payment`, 'adminA').expect(200);
    expect(pay.body.status).toBe('SUCCEEDED');
    expect(pay.body.capturedAmount).toBe('339.00');
  });

  it('is idempotent on a webhook redelivery (no-op; still one payment, still PAID)', async () => {
    await fire('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 33900, amount_received: 33900, currency: 'cad', status: 'succeeded', latest_charge: `${runNonce}_ch`, metadata: { orgId: ORG1, invoiceId: INV_A } }, { id: 'succ' }).expect(200);
    const inv = await get(`/v1/invoices/${INV_A}`, 'adminA').expect(200);
    expect(inv.body.status).toBe('PAID');
    expect(await prisma.payment.count({ where: { invoiceId: INV_A } })).toBe(1);
  });

  it('refuses to pay an already-paid invoice (409)', async () => {
    await post(`/v1/invoices/${INV_A}/payment-intent`, 'adminA').expect(409);
  });

  it('surfaces the paid invoice under the PAID status filter', async () => {
    const res = await get('/v1/invoices?status=PAID', 'adminA').expect(200);
    expect(res.body.invoices.map((i: { id: string }) => i.id)).toContain(INV_A);
  });

  it('does NOT mark an invoice PAID on an underpayment (captured < total); the payment still SUCCEEDED', async () => {
    const pay = await post(`/v1/invoices/${INV_B}/payment-intent`, 'adminB').expect(201);
    expect(pay.body.amount).toBe('113.00');
    const pid = pay.body.clientSecret.split('_secret_')[0];
    // A SIGNED succeeded event that captured only $100.00 of the $113.00 total.
    await fire('payment_intent.succeeded', { id: pid, object: 'payment_intent', amount: 11300, amount_received: 10000, currency: 'cad', status: 'succeeded', latest_charge: `${runNonce}_chB`, metadata: { orgId: ORG1, invoiceId: INV_B } }, { id: 'underpay' }).expect(200);
    const inv = await get(`/v1/invoices/${INV_B}`, 'adminB').expect(200);
    expect(inv.body.status).toBe('ISSUED'); // underpaid → invoice is NOT flipped to PAID
    const p = await get(`/v1/invoices/${INV_B}/payment`, 'adminB').expect(200);
    expect(p.body.status).toBe('SUCCEEDED');
    expect(p.body.capturedAmount).toBe('100.00');
  });
});
