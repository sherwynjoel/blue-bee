import { INestApplication } from '@nestjs/common';
import { OrderStatus, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { RATING_ERRORS } from '@blue-bee/shared';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

// ── Seeded ids (must match prisma/seed.ts) ──
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_B = 'e0000000-0000-4000-8000-0000000000b0';
const ORDER_O2 = 'e0000000-0000-4000-8000-0000000000c1'; // Org-2 order (cross-org target)

const PHONES = {
  owner: '+14165550001', // OWNER (org-wide) — staff, cannot rate
  csr: '+14165550003', // CSR (org-wide) — staff, cannot rate
  finance: '+14165550005', // FINANCE (org-wide)
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
  acctBAdmin: '+14165550020', // ACCOUNT_ADMIN, Account B
};

/**
 * Inc-32 — post-delivery ratings / CSAT, proven end-to-end against the real seeded Postgres. Orders are
 * inserted directly at a status (the POD-gated delivery PATH to DELIVERED is proven in pod.e2e-spec.ts;
 * here we isolate the rating surface): eligibility (delivered-or-later), customer-ownership + scope
 * (403/404), one-per-order (409) + idempotent replay, the original-submitter-only PATCH gate, staff-cannot
 * -rate, and the now-real CSAT analytics (commercial + account scorecard).
 */
describe('Ratings e2e — Increment 32 (/v1/orders/:id/rating + CSAT analytics · A6.3)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const userId: Record<string, string> = {};
  const runNonce = randomUUID().slice(0, 8);

  const post = (path: string, who: string, body: unknown = {}, key?: string) => {
    let req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`);
    if (key) req = req.set('Idempotency-Key', key);
    return req.send(body as object);
  };
  const patch = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

  /** Insert an order directly at the given status (isolates the rating surface from the delivery path). */
  async function makeOrder(accountId: string, status: OrderStatus): Promise<string> {
    const o = await prisma.order.create({ data: { orgId: ORG1, accountId, status } });
    return o.id;
  }

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
    await prisma.$disconnect();
    await app.close();
  });

  // ───────────────────────── happy path — create + read ─────────────────────────

  it('a customer rates a DELIVERED order → 201 + a scoped row; getOrder + GET embed it', async () => {
    const orderId = await makeOrder(ACCOUNT_A, OrderStatus.DELIVERED);
    const res = await post(`/v1/orders/${orderId}/rating`, 'rita', { score: 5, comment: '  Spotless!  ' }).expect(201);
    expect(res.body.score).toBe(5);
    expect(res.body.comment).toBe('Spotless!'); // trimmed
    expect(res.body.submittedByUserId).toBe(userId.rita);
    expect(res.body.editable).toBe(true);

    const row = await prisma.rating.findUnique({ where: { orderId } });
    expect(row).toMatchObject({ orgId: ORG1, orderId, score: 5, comment: 'Spotless!', submittedByUserId: userId.rita });

    // Embedded on the order read AND available via the dedicated GET.
    expect((await get(`/v1/orders/${orderId}`, 'rita').expect(200)).body.rating.score).toBe(5);
    expect((await get(`/v1/orders/${orderId}/rating`, 'rita').expect(200)).body.score).toBe(5);
    // OWNER may read it for the console.
    expect((await get(`/v1/orders/${orderId}/rating`, 'owner').expect(200)).body.score).toBe(5);
  });

  it('rating an order that has not reached DELIVERED → 409 order_not_rateable', async () => {
    const orderId = await makeOrder(ACCOUNT_A, OrderStatus.QUOTE_APPROVED);
    const res = await post(`/v1/orders/${orderId}/rating`, 'rita', { score: 4 }).expect(409);
    expect(res.body.title).toBe(RATING_ERRORS.ORDER_NOT_RATEABLE);
    expect(await prisma.rating.findUnique({ where: { orderId } })).toBeNull();
    // an INVOICED order (delivered-or-later) IS rateable.
    const invoiced = await makeOrder(ACCOUNT_A, OrderStatus.INVOICED);
    await post(`/v1/orders/${invoiced}/rating`, 'rita', { score: 4 }).expect(201);
  });

  it('one rating per order: a second create → 409; the same idempotency key replays the first', async () => {
    const orderId = await makeOrder(ACCOUNT_A, OrderStatus.DELIVERED);
    const key = `rate-${runNonce}-${orderId}`;
    const first = await post(`/v1/orders/${orderId}/rating`, 'rita', { score: 4 }, key).expect(201);
    // same key → the interceptor replays the first response (no duplicate, no 409).
    const replay = await post(`/v1/orders/${orderId}/rating`, 'rita', { score: 4 }, key).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    // a genuinely new request on an already-rated order → 409.
    const dup = await post(`/v1/orders/${orderId}/rating`, 'rita', { score: 2 }).expect(409);
    expect(dup.body.title).toBe(RATING_ERRORS.RATING_ALREADY_EXISTS);
    expect((await prisma.rating.findUnique({ where: { orderId } }))!.score).toBe(4); // unchanged
  });

  // ───────────────────────── PATCH — original submitter only ─────────────────────────

  it('the original submitter may PATCH; a non-submitter may not (403 not_yours)', async () => {
    const orderId = await makeOrder(ACCOUNT_A, OrderStatus.DELIVERED);
    await post(`/v1/orders/${orderId}/rating`, 'rita', { score: 3, comment: 'ok' }).expect(201);
    const upd = await patch(`/v1/orders/${orderId}/rating`, 'rita', { score: 5, comment: 'better than I thought' }).expect(200);
    expect(upd.body.score).toBe(5);
    expect(upd.body.comment).toBe('better than I thought');
    expect((await prisma.rating.findUnique({ where: { orderId } }))!.score).toBe(5);

    // A rating whose submitter is someone else — the acting customer cannot edit it (the ownership gate,
    // distinct from cross-account: this order IS in scope, but the rating is not theirs).
    const otherOrder = await makeOrder(ACCOUNT_A, OrderStatus.DELIVERED);
    await prisma.rating.create({ data: { orgId: ORG1, orderId: otherOrder, score: 2, submittedByUserId: userId.owner, createdBy: userId.owner } });
    const forbidden = await patch(`/v1/orders/${otherOrder}/rating`, 'rita', { score: 5 }).expect(403);
    expect(forbidden.body.title).toBe(RATING_ERRORS.RATING_NOT_YOURS);
    expect((await prisma.rating.findUnique({ where: { orderId: otherOrder } }))!.score).toBe(2); // untouched
  });

  // ───────────────────────── scope + RBAC ─────────────────────────

  it('scope: ACCOUNT_ADMIN rates own order (201); cross-account → 403; cross-org → 404; staff → 403', async () => {
    // ACCOUNT_B admin rates their own delivered order → 201 (ACCOUNT_ADMIN is a rating role).
    const bOrder = await makeOrder(ACCOUNT_B, OrderStatus.DELIVERED);
    await post(`/v1/orders/${bOrder}/rating`, 'acctBAdmin', { score: 4 }).expect(201);

    // rita (Account A) rating an Account B order → 403 cross_account_forbidden (no existence leak of content).
    const bOrder2 = await makeOrder(ACCOUNT_B, OrderStatus.DELIVERED);
    expect((await post(`/v1/orders/${bOrder2}/rating`, 'rita', { score: 5 }).expect(403)).body.title).toBe('cross_account_forbidden');

    // cross-org (an Org-2 order) → 404 order_not_found.
    expect((await post(`/v1/orders/${ORDER_O2}/rating`, 'rita', { score: 5 }).expect(404)).body.title).toBe('order_not_found');

    // OWNER / CSR (staff) cannot rate → 403 forbidden_role (customer-side action only).
    const aOrder = await makeOrder(ACCOUNT_A, OrderStatus.DELIVERED);
    expect((await post(`/v1/orders/${aOrder}/rating`, 'owner', { score: 5 }).expect(403)).body.title).toBe('forbidden_role');
    expect((await post(`/v1/orders/${aOrder}/rating`, 'csr', { score: 5 }).expect(403)).body.title).toBe('forbidden_role');
    expect(await prisma.rating.findUnique({ where: { orderId: aOrder } })).toBeNull(); // nothing written
  });

  // ───────────────────────── analytics (CSAT is real now) ─────────────────────────

  it('analytics: account scorecard avgRatingScore = mean of the account ratings; commercial csat is real', async () => {
    // A FRESH account isolates the scorecard average from ratings other runs left on the persistent dev DB.
    const acct = await prisma.account.create({ data: { orgId: ORG1, type: 'RESIDENTIAL', name: `Ratings Analytics ${runNonce}` } });
    const o1 = await makeOrder(acct.id, OrderStatus.DELIVERED);
    const o2 = await makeOrder(acct.id, OrderStatus.DELIVERED);
    await prisma.rating.create({ data: { orgId: ORG1, orderId: o1, score: 5, submittedByUserId: userId.rita, createdBy: userId.rita } });
    await prisma.rating.create({ data: { orgId: ORG1, orderId: o2, score: 3, submittedByUserId: userId.rita, createdBy: userId.rita } });

    const sc = (await get(`/v1/analytics/accounts/${acct.id}/scorecard`, 'owner').expect(200)).body;
    expect(sc.metrics.avgRatingScore.status).toBe('ok');
    expect(sc.metrics.avgRatingScore.value).toBe(4); // (5 + 3) / 2
    expect(sc.metrics.avgRatingScore.rowCount).toBe(2);

    // Commercial CSAT is now a REAL metric (was Phase-2 `deferred`). Org-wide + persistent DB ⇒ assert it's
    // computed & sane (not an exact value): status ok, a 1–5 mean, and at least the ratings we just added.
    const comm = (await get('/v1/analytics/commercial', 'owner').expect(200)).body;
    expect(comm.metrics.csat.status).toBe('ok');
    expect(typeof comm.metrics.csat.value).toBe('number');
    expect(comm.metrics.csat.value).toBeGreaterThanOrEqual(1);
    expect(comm.metrics.csat.value).toBeLessThanOrEqual(5);
    expect(comm.metrics.csat.rowCount).toBeGreaterThanOrEqual(2);
  });
});
