import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

// ── Seeded ids (must match prisma/seed.ts) ──
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_B = 'e0000000-0000-4000-8000-0000000000b0';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const ORDER_O2 = 'e0000000-0000-4000-8000-0000000000c1'; // Org-2 order (cross-org target)
const MEDIA = 'https://bluebee-media.s3.ca-central-1.amazonaws.com/intake/test-rug.jpg';

const PHONES = {
  owner: '+14165550001',
  dispatcher: '+14165550002',
  csr: '+14165550003',
  plant: '+14165550004',
  finance: '+14165550005',
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
  acctBAdmin: '+14165550020', // ACCOUNT_ADMIN, Account B
};

describe('Orders e2e — Increment 3 (book → intake → quote → approve · §5.1/§8.3/§17.3)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const userId: Record<string, string> = {};

  const futureWindow = () => ({
    start: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    end: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  });

  const post = (path: string, who: string, body: unknown = {}, key?: string) => {
    let req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`);
    if (key) req = req.set('Idempotency-Key', key);
    return req.send(body as object);
  };
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

  const bookItem = (over: Record<string, unknown> = {}) => ({ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40, ...over });

  // NOTE: not `async` — returns the supertest Test (a thenable) so callers can chain
  // `.expect(...)` before awaiting (an async fn would unwrap the Test into a Response).
  function book(who: string, accountId: string, items = [bookItem()], key?: string) {
    return post('/v1/orders', who, { accountId, pickupWindow: futureWindow(), items }, key);
  }

  /** Drive an order book→QUOTED as staff. Asserts 201 on the quote and returns its Response. */
  async function driveToQuoted(
    orderId: string,
    opts: { measurements?: Record<string, unknown>; quoteBody?: Record<string, unknown>; damage?: boolean } = {},
  ) {
    await post(`/v1/orders/${orderId}/schedule-pickup`, 'owner', { pickupWindow: futureWindow() }).expect(200);
    await post(`/v1/orders/${orderId}/received-at-plant`, 'owner', {}).expect(200);
    const order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    const insp: Record<string, unknown> = {
      conditionCodes: ['MINOR_FRINGE_WEAR'],
      measurements: opts.measurements ?? { sqft: 40 },
    };
    if (opts.damage) Object.assign(insp, { preexistingDamage: true, customerAck: true, damagePhotoUrl: MEDIA });
    for (const item of order.items) {
      await post(`/v1/orders/${orderId}/items/${item.id}/inspection`, 'plant', insp).expect(201);
    }
    return post(`/v1/orders/${orderId}/quote`, 'csr', opts.quoteBody ?? {}).expect(201);
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    // Mint real access tokens directly via the app's TokenService (the same signer the
    // OTP flow uses) — deterministic and not subject to OTP rate limits across runs.
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

  // ───────────────────────── DoD #1 — book + idempotency ─────────────────────────

  it('books a specialty order (REQUESTED) with items + tags + estimate range', async () => {
    const res = await book('owner', ACCOUNT_A).expect(201);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.accountId).toBe(ACCOUNT_A);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].tag).toBeTruthy();
    expect(res.body.items[0].tag.code).toMatch(/^BB-/);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.totals.estimateRange).toBeTruthy();
    expect(res.body.totals.estimateRange.currency).toBe('CAD');
  });

  it('idempotency: same Idempotency-Key returns the same order (no duplicate); a new key creates a new order', async () => {
    const key = `book-${Date.now()}`;
    const a = await book('owner', ACCOUNT_A, [bookItem()], key).expect(201);
    const b = await book('owner', ACCOUNT_A, [bookItem()], key).expect(201);
    expect(b.body.id).toBe(a.body.id);
    const c = await book('owner', ACCOUNT_A, [bookItem()], `${key}-other`).expect(201);
    expect(c.body.id).not.toBe(a.body.id);
  });

  it('idempotency is concurrency-safe: two CONCURRENT same-key bookings → one order, no duplicate', async () => {
    const key = `book-concurrent-${Date.now()}`;
    const [a, b] = await Promise.all([
      book('owner', ACCOUNT_A, [bookItem()], key),
      book('owner', ACCOUNT_A, [bookItem()], key),
    ]);
    // both succeed (one runs the handler, the other waits and returns the same cached body)
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id); // a duplicate would have produced a different id
  });

  // ───────────────────────── DoD #2 — state machine ─────────────────────────

  it('rejects an illegal transition (REQUESTED → QUOTE_APPROVED) with 409 problem+json', async () => {
    const order = (await book('owner', ACCOUNT_A).expect(201)).body;
    const res = await post(`/v1/orders/${order.id}/quote:approve`, 'rita', {}).expect(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.title).toBe('illegal_transition');
    // building a quote before intake is also illegal
    await post(`/v1/orders/${order.id}/quote`, 'csr', {}).expect(409);
  });

  it('ON_HOLD → resume returns to the held-from state', async () => {
    const order = (await book('owner', ACCOUNT_A).expect(201)).body;
    const held = await post(`/v1/orders/${order.id}/hold`, 'csr', { reason: 'awaiting customer callback' }).expect(200);
    expect(held.body.status).toBe('ON_HOLD');
    expect(held.body.heldFrom).toBe('REQUESTED');
    const resumed = await post(`/v1/orders/${order.id}/resume`, 'csr', {}).expect(200);
    expect(resumed.body.status).toBe('REQUESTED');
    expect(resumed.body.heldFrom).toBeNull();
  });

  // ───────────────── DoD #3 + #4 + #5 — intake, quote (default rate), approve ─────────────────

  it('full happy path: book → receive → inspect (+photo, +custody) → quote → owner-customer approves', async () => {
    const order = (await book('owner', ACCOUNT_A).expect(201)).body;
    await post(`/v1/orders/${order.id}/schedule-pickup`, 'owner', { pickupWindow: futureWindow() }).expect(200);
    const received = await post(`/v1/orders/${order.id}/received-at-plant`, 'owner', {}).expect(200);
    expect(received.body.status).toBe('PICKED_UP');

    const itemId = received.body.items[0].id;
    const insp = await post(`/v1/orders/${order.id}/items/${itemId}/inspection`, 'plant', {
      conditionCodes: ['MINOR_FRINGE_WEAR'],
      measurements: { sqft: 40, fiber: 'wool' },
    }).expect(201);
    expect(insp.body.status).toBe('INTAKE_INSPECTED');
    const inspItem = insp.body.items.find((i: { id: string }) => i.id === itemId);
    expect(inspItem.status).toBe('INSPECTED');
    expect(inspItem.inspections).toHaveLength(1);
    // custody chain includes PICKED_UP → INTAKE → INSPECTED (PICKED_UP first; INTAKE/INSPECTED may tie on ms)
    const stages = inspItem.custodyEvents.map((c: { stage: string }) => c.stage);
    expect(stages).toEqual(expect.arrayContaining(['PICKED_UP', 'INTAKE', 'INSPECTED']));
    expect(stages).toHaveLength(3);
    expect(stages[0]).toBe('PICKED_UP');

    const photo = await post(`/v1/orders/${order.id}/items/${itemId}/photos`, 'plant', { url: MEDIA, kind: 'INTAKE' }).expect(201);
    expect(photo.body.url).toBe(MEDIA);
    expect(photo.body.kind).toBe('INTAKE');

    const quoted = await post(`/v1/orders/${order.id}/quote`, 'csr', {}).expect(201);
    expect(quoted.body.order.status).toBe('QUOTED');
    const o = quoted.body.order;
    const quote = o.quotes[0];
    expect(quote.status).toBe('SENT');
    // formatted money via order.totals (jsonb, cents preserved) + numeric via the Decimal columns
    expect(o.totals).toMatchObject({ subtotal: '260.00', tax: '33.80', total: '293.80', taxRate: 0.13 });
    expect(quote.lines[0].amount).toBe('260.00'); // 40 sqft × $6.50
    expect(Number(quote.subtotal)).toBe(260);
    expect(Number(quote.tax)).toBe(33.8);
    expect(Number(quote.total)).toBe(293.8);
    expect(quote.expiresAt).toBeTruthy();

    const approved = await post(`/v1/orders/${order.id}/quote:approve`, 'rita', {}).expect(200);
    expect(approved.body.status).toBe('QUOTE_APPROVED');
    expect(approved.body.quotes[0].approvedBy).toBe(userId.rita);
    expect(approved.body.quotes[0].approvedAt).toBeTruthy();
  });

  it('rejects approval of an EXPIRED quote (409 quote_expired) and marks it EXPIRED', async () => {
    const order = (await book('owner', ACCOUNT_A).expect(201)).body;
    await driveToQuoted(order.id);
    // Force expiry directly (simulates the quote lapsing before approval).
    await prisma.quote.updateMany({ where: { orderId: order.id, status: 'SENT' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await post(`/v1/orders/${order.id}/quote:approve`, 'rita', {}).expect(409);
    expect(res.body.title).toBe('quote_expired');
    const q = await prisma.quote.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
    expect(q!.status).toBe('EXPIRED');
    // the order stays QUOTED (not advanced to QUOTE_APPROVED)
    const o = await prisma.order.findUnique({ where: { id: order.id } });
    expect(o!.status).toBe('QUOTED');
  });

  // ───────────────────────── DoD #4 — per-account override ─────────────────────────

  it('applies the Account-B per-account override rate ($5.00) instead of the base ($6.50)', async () => {
    const order = (await book('csr', ACCOUNT_B).expect(201)).body;
    await driveToQuoted(order.id);
    const full = (await get(`/v1/orders/${order.id}`, 'owner').expect(200)).body;
    const quote = full.quotes[0];
    expect(full.totals).toMatchObject({ subtotal: '200.00', tax: '26.00', total: '226.00' });
    expect(Number(quote.subtotal)).toBe(200);
    expect(Number(quote.total)).toBe(226);
    expect(quote.lines[0].rateSource).toBe('account_override');
    expect(quote.lines[0].rate).toBe(5);
  });

  // ───────────────────────── DoD #4 — manual adjustment (audited) ─────────────────────────

  it('persists a manual adjustment with {reason, actor} and writes an audit log', async () => {
    const order = (await book('owner', ACCOUNT_A).expect(201)).body;
    await driveToQuoted(order.id, { quoteBody: { manualAdjustment: { reason: 'loyalty discount', amount: -50 } } });
    const full = (await get(`/v1/orders/${order.id}`, 'owner').expect(200)).body;
    const quote = full.quotes[0];
    expect(full.totals.subtotal).toBe('210.00'); // 260 - 50 (formatted, jsonb)
    expect(Number(quote.subtotal)).toBe(210);
    expect(quote.adjustments[0].reason).toBe('loyalty discount');
    expect(quote.adjustments[0].before).toBe('260.00');
    expect(quote.adjustments[0].after).toBe('210.00');
    const audit = await prisma.auditLog.findFirst({ where: { entity: 'Quote', entityId: quote.id, action: 'QUOTE_ADJUSTED' } });
    expect(audit).toBeTruthy();
    expect((audit!.after as Record<string, unknown>).reason).toBe('loyalty discount');
  });

  // ───────────────────────── DoD #2 — pre-existing damage branch ─────────────────────────

  it('records the DAMAGE_PREEXISTING_FLAGGED branch (photo + ack) and still quotes', async () => {
    const order = (await book('owner', ACCOUNT_A).expect(201)).body;
    await post(`/v1/orders/${order.id}/schedule-pickup`, 'owner', { pickupWindow: futureWindow() }).expect(200);
    const received = await post(`/v1/orders/${order.id}/received-at-plant`, 'owner', {}).expect(200);
    const itemId = received.body.items[0].id;
    const insp = await post(`/v1/orders/${order.id}/items/${itemId}/inspection`, 'plant', {
      conditionCodes: ['STAIN', 'PREEXISTING_TEAR'],
      measurements: { sqft: 40 },
      preexistingDamage: true,
      customerAck: true,
      damagePhotoUrl: MEDIA,
    }).expect(201);
    expect(insp.body.status).toBe('DAMAGE_PREEXISTING_FLAGGED');
    const item = insp.body.items.find((i: { id: string }) => i.id === itemId);
    expect(item.inspections[0].preexistingDamage).toBe(true);
    expect(item.inspections[0].ackBy).toBeTruthy();
    expect(item.photos.some((p: { kind: string }) => p.kind === 'INTAKE')).toBe(true);
    // quote continues from the damage branch
    const quoted = await post(`/v1/orders/${order.id}/quote`, 'csr', {}).expect(201);
    expect(quoted.body.order.status).toBe('QUOTED');

    // a flagged inspection WITHOUT ack/photo is rejected (400)
    const order2 = (await book('owner', ACCOUNT_A).expect(201)).body;
    await post(`/v1/orders/${order2.id}/schedule-pickup`, 'owner', { pickupWindow: futureWindow() }).expect(200);
    const r2 = await post(`/v1/orders/${order2.id}/received-at-plant`, 'owner', {}).expect(200);
    await post(`/v1/orders/${order2.id}/items/${r2.body.items[0].id}/inspection`, 'plant', {
      measurements: { sqft: 40 },
      preexistingDamage: true,
    }).expect(400);
  });

  // ───────────────────────── DoD #5 — decline → CLOSED_NO_WORK ─────────────────────────

  it('decline → QUOTE_DECLINED → schedule return → CLOSED_NO_WORK', async () => {
    const order = (await book('owner', ACCOUNT_A).expect(201)).body;
    await driveToQuoted(order.id);
    const declined = await post(`/v1/orders/${order.id}/quote:decline`, 'rita', { reason: 'too expensive', returnWindow: futureWindow() }).expect(200);
    expect(declined.body.status).toBe('CLOSED_NO_WORK');
    expect(declined.body.quotes[0].status).toBe('DECLINED');
  });

  // ───────────────────────── DoD #6 — write-scope (carried forward) ─────────────────────────

  it('Account A user cannot approve Account B order, and vice-versa (403 cross_account); cross-org → 404', async () => {
    // an Account A order at QUOTED
    const aOrder = (await book('owner', ACCOUNT_A).expect(201)).body;
    await driveToQuoted(aOrder.id);
    // an Account B order at QUOTED
    const bOrder = (await book('csr', ACCOUNT_B).expect(201)).body;
    await driveToQuoted(bOrder.id);

    // Account B admin approving Account A's order → 403 (same org, different account)
    const x1 = await post(`/v1/orders/${aOrder.id}/quote:approve`, 'acctBAdmin', {}).expect(403);
    expect(x1.body.title).toBe('cross_account_forbidden');
    // Rita (Account A) approving Account B's order → 403
    const x2 = await post(`/v1/orders/${bOrder.id}/quote:approve`, 'rita', {}).expect(403);
    expect(x2.body.title).toBe('cross_account_forbidden');

    // Rita booking for Account B → 403
    await book('rita', ACCOUNT_B).expect(403);

    // Cross-org child write: Org-1 CSR building a quote / inspecting on an Org-2 order → 404
    const x3 = await post(`/v1/orders/${ORDER_O2}/quote`, 'csr', {}).expect(404);
    expect(x3.body.title).toBe('order_not_found');
    await post(`/v1/orders/${ORDER_O2}/items/${ORDER_O2}/inspection`, 'plant', { measurements: { sqft: 1 } }).expect(404);

    // ...and the legitimate owner still succeeds.
    const ok = await post(`/v1/orders/${aOrder.id}/quote:approve`, 'rita', {}).expect(200);
    expect(ok.body.status).toBe('QUOTE_APPROVED');
  });

  // ───────────────────────── DoD #7 — RBAC (§17.3) ─────────────────────────

  it('RBAC: non-OWNER/CSR/PLANT cannot intake/quote; DISPATCHER cannot book', async () => {
    const order = (await book('owner', ACCOUNT_A).expect(201)).body;
    await post(`/v1/orders/${order.id}/schedule-pickup`, 'owner', { pickupWindow: futureWindow() }).expect(200);
    const received = await post(`/v1/orders/${order.id}/received-at-plant`, 'owner', {}).expect(200);
    const itemId = received.body.items[0].id;

    // FINANCE (org-wide read, NOT in intake/inspect/quote row) → 403
    const f = await post(`/v1/orders/${order.id}/items/${itemId}/inspection`, 'finance', { measurements: { sqft: 40 } }).expect(403);
    expect(f.body.title).toBe('forbidden_role');
    // DISPATCHER cannot build a quote (intake/inspect/quote = OWNER/CSR/PLANT)
    await post(`/v1/orders/${order.id}/items/${itemId}/inspection`, 'plant', { measurements: { sqft: 40 } }).expect(201);
    await post(`/v1/orders/${order.id}/quote`, 'dispatcher', {}).expect(403);
    // DISPATCHER cannot book (book = OWNER/CSR/RESIDENTIAL)
    await book('dispatcher', ACCOUNT_A).expect(403);
  });

  // ───────────────────────── QC #6 — concurrent approve race ─────────────────────────

  it('concurrent approves on one QUOTED order: exactly one 200, one 409', async () => {
    const order = (await book('owner', ACCOUNT_A).expect(201)).body;
    await driveToQuoted(order.id);
    const results = await Promise.all([
      post(`/v1/orders/${order.id}/quote:approve`, 'rita', {}),
      post(`/v1/orders/${order.id}/quote:approve`, 'rita', {}),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
  });

  // ───────────────────────── read/list scoping + cursor pagination ─────────────────────────

  it('list is row-scoped (Account A user sees only Account A orders) and cursor-paginates', async () => {
    const list = (await get('/v1/orders', 'rita').expect(200)).body;
    expect(Array.isArray(list.orders)).toBe(true);
    expect(list.orders.length).toBeGreaterThan(0);
    for (const o of list.orders) expect(o.accountId).toBe(ACCOUNT_A);

    const page1 = (await get('/v1/orders?limit=1', 'rita').expect(200)).body;
    expect(page1.orders).toHaveLength(1);
    expect(typeof page1.hasMore).toBe('boolean');
    if (page1.hasMore) {
      expect(page1.nextCursor).toBeTruthy();
      const page2 = (await get(`/v1/orders?limit=1&cursor=${page1.nextCursor}`, 'rita').expect(200)).body;
      expect(page2.orders[0].id).not.toBe(page1.orders[0].id);
    }
  });

  it('a different account’s order is 404 on read (scoped)', async () => {
    const bOrder = (await book('csr', ACCOUNT_B).expect(201)).body;
    await get(`/v1/orders/${bOrder.id}`, 'rita').expect(404);
    await get(`/v1/orders/${bOrder.id}`, 'owner').expect(200); // org-wide staff can read it
  });

  // ───────────────────────── OpenAPI surface ─────────────────────────

  it('OpenAPI documents the new order endpoints', async () => {
    const doc = (await http.get('/v1/docs-json').expect(200)).body;
    const paths = Object.keys(doc.paths);
    expect(paths).toContain('/v1/orders');
    expect(paths.some((p) => p.includes('/quote'))).toBe(true);
    expect(paths.some((p) => p.includes('received-at-plant'))).toBe(true);
  });
});
