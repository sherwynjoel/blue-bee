import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { OptimizerService } from '../src/logistics/optimizer.service';

/**
 * Track-A recurring/standing-order + per-account-billing e2e (condo B2B foundation). Boots the real
 * app against the real (migrated) Postgres + Redis. Proves the Definition of Done:
 *   • A StandingOrder → `run` materializes a REAL Order → a Route with a CONCIERGE stop (real rows).
 *   • A SECOND run generates NOTHING new (idempotent — the occurrence ledger's unique constraint).
 *   • DEGRADATION — a forced PostGIS-sequencer failure leaves the generated Order intact (never lost).
 *   • RBAC — a non-ops role (DRIVER / residential) → 403; org-scoping — an Org-2 owner can't see Org-1's.
 *   • Per-account BATCH_PERIODIC terms → one periodic invoice batches many orders (net-days due), idempotent.
 *
 * Self-contained fixture under Org-1 with deterministic ids (prefix a7), created + torn down here. Runs
 * are scoped by `standingOrderId` so they never touch the seed's demo standing order.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';

// Fixture ids (a7 = Track-A recurring e2e).
const ACCT_SO = 'a7000000-0000-4000-8000-000000000001'; // standing-order account
const ACCT_BILL = 'a7000000-0000-4000-8000-000000000002'; // batch-billing account
const ACCT_PERORDER = 'a7000000-0000-4000-8000-000000000003'; // a PER_ORDER account (batch must reject)
const SITE_SO = 'a7000000-0000-4000-8000-000000000011';
const SITE_DEG = 'a7000000-0000-4000-8000-000000000012';
const SVC = 'a7000000-0000-4000-8000-000000000021';
const BILL_ORDERS = [
  'a7000000-0000-4000-8000-000000000301',
  'a7000000-0000-4000-8000-000000000302',
  'a7000000-0000-4000-8000-000000000303',
];

const PHONES = {
  owner: '+14165550001', // OWNER (Org 1)
  finance: '+14165550005', // FINANCE (Org 1)
  dispatcher: '+14165550002', // DISPATCHER (Org 1)
  driver: '+14165550006', // DRIVER — org staff but NOT ops/recurring → 403
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER → 403
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org isolation probe
};

// 2026-06-15 is a Monday; run asOf = that Monday ⇒ exactly ONE occurrence (startsOn clamps the window).
const MON = '2026-06-15';
const MON_ASOF = '2026-06-15T09:00:00.000Z';
const TUE = '2026-06-16'; // Tuesday — the degradation standing order
const TUE_ASOF = '2026-06-16T09:00:00.000Z';

async function tearDown(prisma: PrismaClient): Promise<void> {
  const myAccts = [ACCT_SO, ACCT_BILL, ACCT_PERORDER];
  const stops = await prisma.routeStop.findMany({ where: { accountId: { in: myAccts } }, select: { routeId: true } });
  const routeIds = [...new Set(stops.map((s) => s.routeId))];
  await prisma.routeStop.deleteMany({ where: { accountId: { in: myAccts } } });
  if (routeIds.length) await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
  await prisma.invoice.deleteMany({ where: { accountId: { in: myAccts } } });
  await prisma.standingOrder.deleteMany({ where: { accountId: { in: myAccts } } }); // cascades occurrences
  await prisma.order.deleteMany({ where: { accountId: { in: myAccts } } });
  await prisma.site.deleteMany({ where: { id: { in: [SITE_SO, SITE_DEG] } } });
  await prisma.service.deleteMany({ where: { id: SVC } });
  await prisma.account.deleteMany({ where: { id: { in: myAccts } } });
}

async function seedFixture(prisma: PrismaClient): Promise<void> {
  await prisma.account.createMany({
    data: [
      { id: ACCT_SO, orgId: ORG1, type: 'BUSINESS', name: 'TrackA E2E — SO condo', billingMode: 'PER_ORDER' },
      { id: ACCT_BILL, orgId: ORG1, type: 'BUSINESS', name: 'TrackA E2E — batch condo', billingMode: 'BATCH_PERIODIC', billingNetDays: 15 },
      { id: ACCT_PERORDER, orgId: ORG1, type: 'BUSINESS', name: 'TrackA E2E — per-order condo', billingMode: 'PER_ORDER' },
    ],
  });
  await prisma.site.createMany({
    data: [
      { id: SITE_SO, orgId: ORG1, accountId: ACCT_SO, name: 'TrackA E2E — condo A' },
      { id: SITE_DEG, orgId: ORG1, accountId: ACCT_SO, name: 'TrackA E2E — condo B (degradation)' },
    ],
  });
  // Real PostGIS points so the sequencer has coordinates (downtown + midtown Toronto).
  await prisma.$executeRaw`UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(-79.3925, 43.6410), 4326)::geography WHERE id = ${SITE_SO}::uuid`;
  await prisma.$executeRaw`UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(-79.4000, 43.7000), 4326)::geography WHERE id = ${SITE_DEG}::uuid`;
  await prisma.service.create({
    data: { id: SVC, orgId: ORG1, vertical: 'LINEN', name: 'TrackA E2E linen', unit: 'PIECE', baseRate: '1.5000' },
  });
  // Three DELIVERED billable orders (with totals) for the batch account, created in June 2026.
  const MONEY = [
    { subtotal: '100.00', tax: '13.00', total: '113.00' },
    { subtotal: '200.00', tax: '26.00', total: '226.00' },
    { subtotal: '50.00', tax: '6.50', total: '56.50' },
  ];
  await prisma.order.createMany({
    data: BILL_ORDERS.map((id, i) => ({
      id,
      orgId: ORG1,
      accountId: ACCT_BILL,
      siteId: SITE_SO,
      vertical: 'LINEN' as const,
      type: 'ROUTE_STOP_ORDER' as const,
      status: 'DELIVERED' as const,
      totals: { ...MONEY[i], currency: 'CAD' },
      createdAt: new Date('2026-06-10T10:00:00.000Z'),
    })),
  });
}

describe('Track-A recurring/standing-orders + per-account billing e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  let standingOrderId: string; // the weekly-Monday concierge SO created in the create test

  const post = (path: string, who: string, body: object) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body);
  const put = (path: string, who: string, body: object, key?: string) => {
    let req = request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${token[who]}`);
    if (key) req = req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
    await tearDown(prisma);
    await seedFixture(prisma);
  }, 60000);

  afterAll(async () => {
    await tearDown(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  const createBody = (over: Record<string, unknown> = {}) => ({
    accountId: ACCT_SO,
    siteId: SITE_SO,
    serviceId: SVC,
    vertical: 'LINEN',
    cadence: 'WEEKLY',
    weekday: 1, // Monday
    pickupWindow: { start: '07:00', end: '09:00' },
    concierge: true,
    startsOn: MON,
    ...over,
  });

  // ─────────────────────────── RBAC + validation on create ───────────────────────────

  describe('create standing order — RBAC + validation', () => {
    it('a DRIVER (org staff, not ops) and a residential customer are 403', async () => {
      await post('/v1/standing-orders', 'driver', createBody()).expect(403);
      await post('/v1/standing-orders', 'rita', createBody()).expect(403);
    });

    it('cross-account site → 400 site_account_mismatch; unknown account → 404', async () => {
      const r1 = await post('/v1/standing-orders', 'owner', createBody({ accountId: ACCT_BILL })).expect(400);
      expect(r1.body.error ?? r1.body.title).toContain('site_account_mismatch');
      await post('/v1/standing-orders', 'owner', createBody({ accountId: '00000000-0000-4000-8000-0000000000ff' })).expect(404);
    });

    it('OWNER creates the weekly-Monday CONCIERGE standing order (201, audited)', async () => {
      const res = await post('/v1/standing-orders', 'owner', createBody()).expect(201);
      expect(res.body).toMatchObject({ accountId: ACCT_SO, cadence: 'WEEKLY', weekday: 1, concierge: true, active: true, startsOn: MON });
      standingOrderId = res.body.id;
      const audit = await prisma.auditLog.findFirst({ where: { entity: 'StandingOrder', entityId: standingOrderId, action: 'STANDING_ORDER_CREATED' } });
      expect(audit).not.toBeNull();
    });
  });

  // ─────────────────────────── generation → order → route → concierge stop ───────────────────────────

  describe('generation: standing order → real Order → Route with a CONCIERGE stop', () => {
    it('a run materializes exactly one Order + one Route (with a CONCIERGE pickup stop)', async () => {
      const res = await post('/v1/standing-orders/run', 'owner', { asOf: MON_ASOF, standingOrderId }).expect(200);
      expect(res.body).toMatchObject({ standingOrdersConsidered: 1, occurrencesCreated: 1, ordersCreated: 1, routesCreated: 1, routeFailures: 0 });

      const occ = await prisma.standingOrderOccurrence.findFirstOrThrow({ where: { standingOrderId } });
      expect(occ.periodKey).toBe(MON);
      expect(occ.orderId).not.toBeNull();
      expect(occ.routeId).not.toBeNull();

      const order = await prisma.order.findFirstOrThrow({ where: { id: occ.orderId! } });
      expect(order.type).toBe('ROUTE_STOP_ORDER');
      expect(order.status).toBe('REQUESTED');
      expect(order.accountId).toBe(ACCT_SO);

      const stops = await prisma.routeStop.findMany({ where: { routeId: occ.routeId! } });
      expect(stops).toHaveLength(1);
      expect(stops[0].stopKind).toBe('CONCIERGE');
      expect(stops[0].kind).toBe('PICKUP');
      expect(stops[0].orderId).toBe(occ.orderId);

      // generation is audited (system actor).
      expect(await prisma.auditLog.findFirst({ where: { entity: 'Order', entityId: order.id, action: 'ORDER_GENERATED_FROM_STANDING_ORDER' } })).not.toBeNull();
      expect(await prisma.auditLog.findFirst({ where: { entity: 'Route', entityId: occ.routeId!, action: 'ROUTE_GENERATED_FROM_STANDING_ORDERS' } })).not.toBeNull();
    });

    it('a SECOND run with the same asOf generates NOTHING new (idempotent)', async () => {
      const before = {
        occ: await prisma.standingOrderOccurrence.count({ where: { standingOrderId } }),
        orders: await prisma.order.count({ where: { accountId: ACCT_SO } }),
      };
      const res = await post('/v1/standing-orders/run', 'owner', { asOf: MON_ASOF, standingOrderId }).expect(200);
      expect(res.body).toMatchObject({ occurrencesCreated: 0, ordersCreated: 0, routesCreated: 0 });
      expect(await prisma.standingOrderOccurrence.count({ where: { standingOrderId } })).toBe(before.occ);
      expect(await prisma.order.count({ where: { accountId: ACCT_SO } })).toBe(before.orders);
    });

    it('the generated order/route surface on the account "generated" feed', async () => {
      const res = await get(`/v1/accounts/${ACCT_SO}/generated`, 'dispatcher').expect(200);
      expect(res.body.orderCount).toBeGreaterThanOrEqual(1);
      expect(res.body.routeCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────── degradation: sequencer failure must not lose orders ───────────────────────────

  describe('graceful degradation', () => {
    it('a forced PostGIS-sequencer failure leaves the generated Order intact (route stands unoptimized)', async () => {
      // A fresh Tuesday standing order on a different site so this run claims a brand-new occurrence.
      const deg = await post('/v1/standing-orders', 'owner', createBody({ siteId: SITE_DEG, weekday: 2, startsOn: TUE, concierge: false })).expect(201);
      const degId: string = deg.body.id;

      const optimizer = app.get(OptimizerService);
      const spy = jest.spyOn(optimizer, 'sequence').mockRejectedValueOnce(new Error('simulated PostGIS sequencer failure'));
      try {
        const res = await post('/v1/standing-orders/run', 'owner', { asOf: TUE_ASOF, standingOrderId: degId }).expect(200);
        expect(res.body).toMatchObject({ ordersCreated: 1 });
      } finally {
        spy.mockRestore();
      }

      const occ = await prisma.standingOrderOccurrence.findFirstOrThrow({ where: { standingOrderId: degId } });
      // The Order was committed BEFORE routing — it must survive the sequencer failure.
      const order = await prisma.order.findUnique({ where: { id: occ.orderId! } });
      expect(order).not.toBeNull();
      expect(order!.status).toBe('REQUESTED');
      // The route + stops still exist (created before sequencing), just not optimized.
      const route = await prisma.route.findUnique({ where: { id: occ.routeId! } });
      expect(route).not.toBeNull();
      expect(route!.optimized).toBe(false);
    });
  });

  // ─────────────────────────── org-scoping ───────────────────────────

  describe('org-scoping', () => {
    it('an Org-2 owner cannot read an Org-1 standing order (404) and does not list it', async () => {
      await get(`/v1/standing-orders/${standingOrderId}`, 'org2owner').expect(404);
      const list = await get('/v1/standing-orders?limit=100', 'org2owner').expect(200);
      expect(list.body.standingOrders.some((s: { id: string }) => s.id === standingOrderId)).toBe(false);
    });

    it("an Org-2 owner's run cannot generate for an Org-1 standing order (tenant-confined generation)", async () => {
      // A later Monday: if generation were NOT org-confined, this Org-2 run targeting the Org-1
      // standingOrderId WOULD materialize a new 2026-06-22 occurrence for it. It must not.
      const LATER_MON = '2026-06-22';
      const before = await prisma.standingOrderOccurrence.count({ where: { standingOrderId } });
      const res = await post('/v1/standing-orders/run', 'org2owner', { asOf: `${LATER_MON}T09:00:00.000Z`, standingOrderId }).expect(200);
      expect(res.body).toMatchObject({ standingOrdersConsidered: 0, occurrencesCreated: 0, ordersCreated: 0 });
      expect(await prisma.standingOrderOccurrence.count({ where: { standingOrderId } })).toBe(before);
      expect(await prisma.standingOrderOccurrence.findFirst({ where: { standingOrderId, periodKey: LATER_MON } })).toBeNull();
    });
  });

  // ─────────────────────────── per-account billing terms + batch invoicing ───────────────────────────

  describe('per-account billing terms + batch invoicing', () => {
    it('FINANCE sets billing terms (BATCH_PERIODIC, net-15) — audited; DISPATCHER is 403', async () => {
      await put(`/v1/accounts/${ACCT_BILL}/billing-terms`, 'dispatcher', { billingMode: 'BATCH_PERIODIC', netDays: 15 }).expect(403);
      const res = await put(`/v1/accounts/${ACCT_BILL}/billing-terms`, 'finance', { billingMode: 'BATCH_PERIODIC', netDays: 15 }).expect(200);
      expect(res.body).toMatchObject({ accountId: ACCT_BILL, billingMode: 'BATCH_PERIODIC', billingNetDays: 15 });
      expect(await prisma.auditLog.findFirst({ where: { entity: 'Account', entityId: ACCT_BILL, action: 'BILLING_TERMS_SET' } })).not.toBeNull();
    });

    it('batches the period\'s billable orders into ONE periodic invoice (sum + net-days due), idempotently', async () => {
      const body = { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z', period: '2026-06' };
      const res = await post(`/v1/accounts/${ACCT_BILL}/invoices/batch`, 'finance', body).expect(201);
      // 113.00 + 226.00 + 56.50 = 395.50; subtotal 350.00; tax 45.50.
      expect(res.body).toMatchObject({ orderId: null, status: 'ISSUED', subtotal: '350.00', tax: '45.50', total: '395.50' });
      expect(res.body.lines).toHaveLength(3);
      // due = issued + 15 days.
      const due = new Date(res.body.dueAt).getTime() - new Date(res.body.issuedAt).getTime();
      expect(Math.round(due / 86_400_000)).toBe(15);
      expect(await prisma.auditLog.findFirst({ where: { entity: 'Invoice', entityId: res.body.id, action: 'BATCH_INVOICE_GENERATED' } })).not.toBeNull();

      // Idempotent: a re-run returns the SAME invoice (no duplicate).
      const again = await post(`/v1/accounts/${ACCT_BILL}/invoices/batch`, 'finance', body).expect(201);
      expect(again.body.id).toBe(res.body.id);
      expect(await prisma.invoice.count({ where: { accountId: ACCT_BILL } })).toBe(1);
    });

    it('a PER_ORDER account rejects batch invoicing (400 not_batch_account)', async () => {
      const res = await post(`/v1/accounts/${ACCT_PERORDER}/invoices/batch`, 'finance', { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' }).expect(400);
      expect(res.body.error ?? res.body.title).toContain('not_batch_account');
    });
  });

  // ─────────────────────────── idempotency (replay safety) ───────────────────────────

  describe('idempotency', () => {
    it('replaying the same Idempotency-Key does not double-apply a billing-terms change', async () => {
      const key = `set-terms-${Date.now()}`;
      const first = await put(`/v1/accounts/${ACCT_PERORDER}/billing-terms`, 'finance', { billingMode: 'PER_ORDER', netDays: 5 }, key).expect(200);
      const second = await put(`/v1/accounts/${ACCT_PERORDER}/billing-terms`, 'finance', { billingMode: 'PER_ORDER', netDays: 99 }, key).expect(200);
      expect(second.body).toEqual(first.body); // the cached response, not a fresh update with netDays=99
      expect(first.body.billingNetDays).toBe(5);
      expect((await prisma.account.findUniqueOrThrow({ where: { id: ACCT_PERORDER } })).billingNetDays).toBe(5); // NOT 99
    });
  });
});
