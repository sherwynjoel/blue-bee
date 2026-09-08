import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { OrderStatus, QuoteStatus } from '@blue-bee/shared';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { CreditsService } from '../src/credits/credits.service';

/**
 * Credits + Home e2e (Increment 37) — the referral REWARD Inc-34 deferred, now real MONEY. This proves the
 * ledger cannot lie:
 *
 *   • **No reward until the founder funds one.** With the reward unset, a delivered referred order grants
 *     NOTHING and `GET /v1/home` reports `reward.enabled: false` — so the app is contractually unable to
 *     promise anything (the Inc-34 honesty firewall, preserved).
 *   • **Earn is real and once-only.** Funding the reward and delivering the referred friend's FIRST order
 *     credits the REFERRER exactly once; a second delivered order for the same friend grants nothing (the
 *     DB unique index, not application luck).
 *   • **Spend is real and once-only.** Credit is applied server-side at PaymentIntent time: the card is
 *     charged the REMAINDER, and a retried intent reuses the SAME redemption (no double-spend).
 *   • **Credit can cover the whole bill.** Then there is no Stripe intent at all: `clientSecret: null`, the
 *     payment is SUCCEEDED with method CREDIT, and the order is marked PAID — no card was charged.
 *   • **Stripe's minimum is respected.** A split that would strand an uncharge­able remainder (< 50¢) holds
 *     credit back so the card sees a chargeable amount; the customer keeps the difference.
 *   • **Balance can never go negative** — an overdrawing console deduction is refused.
 *   • **Home content round-trips.** The founder's block reaches the customer's Home; an edit reaches it too.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
// Rita's account is RESOLVED from her RESIDENTIAL_CUSTOMER grant, never hard-coded (seed ids drift).

// c9 = credits e2e fixtures
const FRIEND = 'c9000000-0000-4000-8000-000000000001'; // referred BY Rita
const FRIEND_ACCT = 'c9000000-0000-4000-8000-000000000002';
const FRIEND_ROLE = 'c9000000-0000-4000-8000-000000000003';
const FRIEND_ORDER_1 = 'c9000000-0000-4000-8000-000000000011';
const FRIEND_ORDER_2 = 'c9000000-0000-4000-8000-000000000012';

const PHONES = { rita: '+14165550010', owner: '+14165550001' };

describe('Credits + Home e2e — the real referral reward (Inc-37)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let credits: CreditsService;
  const token: Record<string, string> = {};
  let ritaId = '';
  let ritaAccount = '';
  const createdBlocks: string[] = [];
  const createdOrders: string[] = [];

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const put = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

  /** An order with an APPROVED quote — the payable precondition (mirrors payments.e2e). */
  async function makeApprovedOrder(total: string, status: OrderStatus = OrderStatus.QUOTE_APPROVED): Promise<string> {
    const order = await prisma.order.create({
      data: { orgId: ORG1, accountId: ritaAccount, vertical: 'SPECIALTY', type: 'JOB', status, totals: { total, currency: 'CAD' }, createdBy: ritaId },
    });
    await prisma.quote.create({
      data: { orgId: ORG1, orderId: order.id, status: QuoteStatus.APPROVED, subtotal: total, tax: '0.00', total, lines: [], adjustments: [], approvedBy: ritaId, approvedAt: new Date() },
    });
    createdOrders.push(order.id);
    return order.id;
  }

  /** The founder's funded reward (null/0 = OFF ⇒ nothing granted, nothing promised). */
  const setReward = (amount: number | null) => put('/v1/admin/referral-reward', 'owner', { amount }).expect(200);
  const balanceOf = async (): Promise<string> => (await get('/v1/account/credits', 'rita').expect(200)).body.balance;

  async function cleanup(): Promise<void> {
    await prisma.creditEntry.deleteMany({ where: { orgId: ORG1, OR: [{ userId: ritaId || undefined }, { referredUserId: FRIEND }] } });
    await prisma.payment.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.quote.deleteMany({ where: { orderId: { in: [...createdOrders, FRIEND_ORDER_1, FRIEND_ORDER_2] } } });
    await prisma.order.deleteMany({ where: { id: { in: [...createdOrders, FRIEND_ORDER_1, FRIEND_ORDER_2] } } });
    await prisma.homeBlock.deleteMany({ where: { id: { in: createdBlocks } } });
    await prisma.userRole.deleteMany({ where: { userId: FRIEND } });
    await prisma.user.deleteMany({ where: { id: FRIEND } });
    await prisma.account.deleteMany({ where: { id: FRIEND_ACCT } });
    createdOrders.length = 0;
    createdBlocks.length = 0;
  }

  beforeAll(async () => {
    app = await createTestApp();
    credits = app.get(CreditsService, { strict: false });
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);

    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      if (name === 'rita') {
        ritaId = user.id;
        const grant = await prisma.userRole.findFirstOrThrow({ where: { userId: user.id, role: 'RESIDENTIAL_CUSTOMER' }, select: { scopeId: true } });
        ritaAccount = grant.scopeId!;
      }
      const roles = await principals.loadGrants(user.id);
      token[name] = tokens.signAccess(user, roles, await principals.deriveScope(roles));
    }

    await cleanup();

    // A friend Rita referred, with their own account + two orders (so we can prove the grant fires ONCE).
    await prisma.account.create({ data: { id: FRIEND_ACCT, orgId: ORG1, type: 'RESIDENTIAL', name: 'Credits e2e — friend account' } });
    await prisma.user.create({
      data: { id: FRIEND, orgId: ORG1, name: 'Credits E2E Friend', phone: '+14165559911', status: 'ACTIVE', authProviders: ['otp'], referredByUserId: ritaId },
    });
    await prisma.userRole.create({ data: { id: FRIEND_ROLE, orgId: ORG1, userId: FRIEND, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: FRIEND_ACCT } });
    for (const id of [FRIEND_ORDER_1, FRIEND_ORDER_2]) {
      await prisma.order.create({
        data: { id, orgId: ORG1, accountId: FRIEND_ACCT, vertical: 'SPECIALTY', type: 'JOB', status: OrderStatus.DELIVERED, totals: {}, createdBy: FRIEND },
      });
    }
    await setReward(null); // start from the honest default: NO reward funded
  }, 60000);

  afterAll(async () => {
    await setReward(null).catch(() => undefined); // leave the org as we found it
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ─────────────────────────── the honesty firewall ───────────────────────────

  it('with NO reward funded: a delivered referred order grants NOTHING, and Home promises nothing', async () => {
    const res = await credits.grantReferralForDeliveredOrder(ORG1, FRIEND_ORDER_1);
    expect(res.granted).toBe(false); // nothing to pay — the founder has funded no reward

    expect(await balanceOf()).toBe('0.00');
    const home = (await get('/v1/home', 'rita').expect(200)).body;
    expect(home.reward.enabled).toBe(false); // ⇒ the app is required to show NO reward claim
    expect(home.reward.amount).toBeNull();
    expect(home.credits.balance).toBe('0.00');
  });

  // ─────────────────────────── EARN ───────────────────────────

  it('the founder funds the reward → the friend’s FIRST delivery credits the REFERRER, exactly once', async () => {
    const terms = (await setReward(10)).body;
    expect(terms).toMatchObject({ enabled: true, amount: '10.00', earnedWhen: 'referred_friend_first_order_delivered' });

    // First delivery → Rita (the referrer) is paid.
    expect(await credits.grantReferralForDeliveredOrder(ORG1, FRIEND_ORDER_1)).toEqual({ granted: true, amount: '10.00' });
    expect(await balanceOf()).toBe('10.00');

    // The SAME friend's SECOND delivered order pays nothing more — one grant per friend, ever.
    expect((await credits.grantReferralForDeliveredOrder(ORG1, FRIEND_ORDER_2)).granted).toBe(false);
    // …and even re-running the FIRST delivery's hook (a retry) is a no-op.
    expect((await credits.grantReferralForDeliveredOrder(ORG1, FRIEND_ORDER_1)).granted).toBe(false);
    expect(await balanceOf()).toBe('10.00');

    // The ledger says WHY, and names the friend.
    const ledger = (await get('/v1/account/credits', 'rita').expect(200)).body;
    const earn = ledger.entries.find((e: { kind: string }) => e.kind === 'REFERRAL_EARN');
    expect(earn).toMatchObject({ amount: '10.00', referredName: 'Credits E2E Friend' });
  });

  // ─────────────────────────── SPEND ───────────────────────────

  it('credit is applied at payment: the card is charged the REMAINDER, and a retry never double-spends', async () => {
    const orderId = await makeApprovedOrder('25.00');

    const pi = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body;
    expect(pi.orderTotal).toBe('25.00');
    expect(pi.creditApplied).toBe('10.00'); // her whole balance
    expect(pi.amount).toBe('15.00'); // the card sees only the remainder
    expect(pi.clientSecret).toBeTruthy(); // a real charge is still required
    expect(await balanceOf()).toBe('0.00'); // spent

    // Retrying the intent must reuse the SAME redemption — never spend the credit twice.
    const retry = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body;
    expect(retry.creditApplied).toBe('10.00');
    expect(retry.amount).toBe('15.00');
    expect(await balanceOf()).toBe('0.00'); // NOT -10.00

    const redemptions = await prisma.creditEntry.count({ where: { orgId: ORG1, kind: 'REDEMPTION', orderId } });
    expect(redemptions).toBe(1); // the DB unique index is the real guard
  });

  it('when credit covers the WHOLE bill there is no card charge at all (no Stripe intent, method CREDIT)', async () => {
    await post(`/v1/admin/customers/${ritaId}/credits/adjust`, 'owner', { amount: 50, note: 'e2e — fund a full cover' }).expect(201);
    expect(await balanceOf()).toBe('50.00');

    const orderId = await makeApprovedOrder('20.00');
    const pi = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body;

    expect(pi.clientSecret).toBeNull(); // ← the app must NOT open PaymentSheet
    expect(pi.amount).toBe('0.00');
    expect(pi.creditApplied).toBe('20.00');
    expect(pi.status).toBe('SUCCEEDED');
    expect(await balanceOf()).toBe('30.00'); // 50 − 20

    // Settled for real: a SUCCEEDED CREDIT payment, and the order marked paid — with no card involved.
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId, orgId: ORG1 } });
    expect(payment.method).toBe('CREDIT');
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.stripePaymentIntentId).toBeNull();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect((order.totals as { paymentStatus?: string }).paymentStatus).toBe('PAID');
  });

  it('never strands an uncharge­able remainder — credit is held back so the card sees Stripe’s minimum', async () => {
    // Balance 30.00 vs a 30.20 bill ⇒ a naive split leaves 20¢, which Stripe would reject. We apply 29.70 and
    // charge the 50¢ minimum; the customer KEEPS the 30¢ difference as credit.
    const orderId = await makeApprovedOrder('30.20');
    const pi = (await post(`/v1/orders/${orderId}/payment-intent`, 'rita').expect(201)).body;

    expect(pi.amount).toBe('0.50'); // exactly the minimum chargeable amount
    expect(pi.creditApplied).toBe('29.70');
    expect(pi.clientSecret).toBeTruthy();
    expect(await balanceOf()).toBe('0.30'); // the held-back remainder is still theirs
  });

  // ─────────────────────────── console control ───────────────────────────

  it('a console deduction can never overdraw the balance', async () => {
    const before = await balanceOf(); // 0.30
    const res = await post(`/v1/admin/customers/${ritaId}/credits/adjust`, 'owner', { amount: -99, note: 'e2e overdraw attempt' }).expect(400);
    expect(res.body.title).toBe('credit.insufficient_balance');
    expect(await balanceOf()).toBe(before); // untouched
  });

  // ─────────────────────────── Home content round-trip ───────────────────────────

  it('the founder’s Home block reaches the customer’s Home — and an edit reaches it too', async () => {
    // Nothing authored yet ⇒ no promo area at all (never a hard-coded placeholder).
    expect((await get('/v1/home', 'rita').expect(200)).body.blocks).toEqual([]);

    const created = (
      await post('/v1/admin/home-blocks', 'owner', {
        title: 'Invite your friends',
        body: 'Share your code — when a friend’s first order is delivered, you earn credit.',
        ctaLabel: 'Invite',
        ctaTarget: 'refer',
      }).expect(201)
    ).body;
    createdBlocks.push(created.id);

    const home = (await get('/v1/home', 'rita').expect(200)).body;
    expect(home.blocks).toHaveLength(1);
    expect(home.blocks[0]).toMatchObject({ title: 'Invite your friends', ctaTarget: 'refer' });

    // Edit in the console → the app sees the new copy on its next read.
    await request(app.getHttpServer())
      .patch(`/v1/admin/home-blocks/${created.id}`)
      .set('Authorization', `Bearer ${token.owner}`)
      .send({ title: 'Invite your family & friends' })
      .expect(200);
    expect((await get('/v1/home', 'rita').expect(200)).body.blocks[0].title).toBe('Invite your family & friends');

    // Deactivating it removes it from the customer's Home (without deleting the copy).
    await request(app.getHttpServer())
      .patch(`/v1/admin/home-blocks/${created.id}`)
      .set('Authorization', `Bearer ${token.owner}`)
      .send({ active: false })
      .expect(200);
    expect((await get('/v1/home', 'rita').expect(200)).body.blocks).toEqual([]);
  });

  it('Home carries the customer’s REAL account + orders (never placeholders)', async () => {
    const home = (await get('/v1/home', 'rita').expect(200)).body;
    expect(home.account.name).toBeTruthy();
    expect(typeof home.orderCount).toBe('number');
    expect(Array.isArray(home.recentOrders)).toBe(true);
    // The balance on Home is the SAME number the ledger endpoint reports — one source of truth.
    expect(home.credits.balance).toBe(await balanceOf());
  });
});

/**
 * Credits admin-adjust idempotency (fix for the 2026-09-08 review finding: the console manual
 * grant/deduct endpoint was the only money-moving mutation in the codebase with no Idempotency-Key
 * protection, so a retried/double-clicked adjustment could double-grant or double-deduct real credit).
 */
describe('Credits e2e — admin adjust idempotency', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const userId: Record<string, string> = {};

  const PHONES = {
    finance: '+14165550005', // FINANCE (org-wide)
    rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
  };

  const post = (path: string, who: string, body: unknown = {}, key?: string) => {
    let req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`);
    if (key) req = req.set('Idempotency-Key', key);
    return req.send(body as object);
  };

  const adjustmentCount = () => prisma.creditEntry.count({ where: { orgId: ORG1, userId: userId.rita, kind: 'ADJUSTMENT' } });

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
      userId[name] = user.id;
    }
  }, 60000);

  afterAll(async () => {
    await prisma.creditEntry.deleteMany({ where: { orgId: ORG1, userId: userId.rita, kind: 'ADJUSTMENT' } });
    await prisma.$disconnect();
    await app.close();
  });

  it('replaying the same Idempotency-Key does not double-grant credit', async () => {
    const key = `adjust-${Date.now()}`;
    const before = await adjustmentCount();

    const a = await post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 10, note: 'Goodwill credit' }, key).expect(201);
    const b = await post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 10, note: 'Goodwill credit' }, key).expect(201);

    expect(b.body.balance).toBe(a.body.balance); // replay returns the cached response, not a second grant
    expect((await adjustmentCount()) - before).toBe(1); // exactly one entry written
  });

  it('is concurrency-safe: two CONCURRENT same-key adjustments write exactly one entry', async () => {
    const key = `adjust-concurrent-${Date.now()}`;
    const before = await adjustmentCount();

    const [a, b] = await Promise.all([
      post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 5, note: 'Concurrent test' }, key),
      post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 5, note: 'Concurrent test' }, key),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.balance).toBe(b.body.balance);
    expect((await adjustmentCount()) - before).toBe(1);
  });

  it('without an Idempotency-Key, two distinct requests both apply (no accidental de-dup of real adjustments)', async () => {
    const before = await adjustmentCount();
    await post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 1, note: 'No key A' }).expect(201);
    await post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 1, note: 'No key B' }).expect(201);
    expect((await adjustmentCount()) - before).toBe(2);
  });
});
