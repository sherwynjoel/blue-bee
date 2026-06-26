import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Cost-centre split-billing e2e (Track A Phase 2, PRD §B4.1/§A5.2/§B5.2). Boots the real app against the
 * real (migrated) Postgres + Redis. Proves the Definition of Done end-to-end:
 *   • Cost-centre CRUD under an account — create/list/patch; unique code → 409; cross-org → 404; RBAC 403.
 *   • Order attribution — attach/detach; a cost centre from another account → 400; cross-org order → 404.
 *   • Standing-order propagation — a standing order's cost centre is INHERITED by its generated orders.
 *   • Split billing — a batch invoice groups invoiced lines by cost centre; the breakdown sums EXACTLY
 *     to the invoice total (cents-exact); an explicit "Unassigned" bucket; InvoiceLines tagged; idempotent.
 *   • Report + CSV — per-cost-centre period totals reconcile; the §B5.2 export is real, account-scoped bytes.
 *
 * Self-contained fixture under Org-1 with deterministic `cc`-prefixed ids, created + torn down here.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';

// Fixture ids (cc = cost-centre e2e).
const ACCT_CC = 'cc000000-0000-4000-8000-000000000001'; // BATCH_PERIODIC condo (the split subject)
const ACCT_OTHER = 'cc000000-0000-4000-8000-000000000002'; // a second account (cross-account attribution probe)
const SITE_CC = 'cc000000-0000-4000-8000-000000000011';
const SVC_CC = 'cc000000-0000-4000-8000-000000000021';
// Five billable orders: 2 → Tower A, 1 → Tower B, 1 → Amenity, 1 → Unassigned.
const ORD = {
  a1: 'cc000000-0000-4000-8000-000000000301',
  a2: 'cc000000-0000-4000-8000-000000000302',
  b1: 'cc000000-0000-4000-8000-000000000303',
  amen: 'cc000000-0000-4000-8000-000000000304',
  unassigned: 'cc000000-0000-4000-8000-000000000305',
};

const WINDOW = { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' };
const PERIOD = '2026-06-cc-e2e';
const MON = '2026-06-15'; // a Monday — standing-order generation anchor
const MON_ASOF = '2026-06-15T09:00:00.000Z';

const PHONES = {
  owner: '+14165550001', // OWNER (Org 1)
  finance: '+14165550005', // FINANCE (Org 1)
  dispatcher: '+14165550002', // DISPATCHER (Org 1) — ops read/attribute, NOT finance writes
  driver: '+14165550006', // DRIVER — org staff but not ops/finance → 403
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER → 403
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org isolation probe
};

async function tearDown(prisma: PrismaClient): Promise<void> {
  const myAccts = [ACCT_CC, ACCT_OTHER];
  const stops = await prisma.routeStop.findMany({ where: { accountId: { in: myAccts } }, select: { routeId: true } });
  const routeIds = [...new Set(stops.map((s) => s.routeId))];
  await prisma.routeStop.deleteMany({ where: { accountId: { in: myAccts } } });
  if (routeIds.length) await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
  await prisma.invoice.deleteMany({ where: { accountId: { in: myAccts } } }); // cascades InvoiceLine
  await prisma.standingOrder.deleteMany({ where: { accountId: { in: myAccts } } }); // cascades occurrences
  await prisma.order.deleteMany({ where: { accountId: { in: myAccts } } });
  await prisma.costCenter.deleteMany({ where: { accountId: { in: myAccts } } });
  await prisma.site.deleteMany({ where: { id: SITE_CC } });
  await prisma.service.deleteMany({ where: { id: SVC_CC } });
  await prisma.account.deleteMany({ where: { id: { in: myAccts } } });
}

async function seedFixture(prisma: PrismaClient): Promise<void> {
  await prisma.account.createMany({
    data: [
      { id: ACCT_CC, orgId: ORG1, type: 'BUSINESS', name: 'CC E2E — Harbour Towers (batch)', billingMode: 'BATCH_PERIODIC', billingNetDays: 30 },
      { id: ACCT_OTHER, orgId: ORG1, type: 'BUSINESS', name: 'CC E2E — other building' },
    ],
  });
  await prisma.site.create({ data: { id: SITE_CC, orgId: ORG1, accountId: ACCT_CC, name: 'CC E2E — tower site' } });
  await prisma.service.create({ data: { id: SVC_CC, orgId: ORG1, vertical: 'LINEN', name: 'CC E2E linen', unit: 'PIECE', baseRate: '1.5000' } });
  // Five DELIVERED billable orders (with totals) created inside the June window. Attribution happens via
  // the API in the attribution test; here they all start UNassigned.
  const money: Record<string, { subtotal: string; tax: string; total: string }> = {
    [ORD.a1]: { subtotal: '100.00', tax: '13.00', total: '113.00' },
    [ORD.a2]: { subtotal: '50.05', tax: '6.51', total: '56.56' },
    [ORD.b1]: { subtotal: '200.00', tax: '26.00', total: '226.00' },
    [ORD.amen]: { subtotal: '75.25', tax: '9.78', total: '85.03' },
    [ORD.unassigned]: { subtotal: '40.40', tax: '5.25', total: '45.65' },
  };
  await prisma.order.createMany({
    data: Object.entries(money).map(([id, m]) => ({
      id,
      orgId: ORG1,
      accountId: ACCT_CC,
      siteId: SITE_CC,
      vertical: 'LINEN' as const,
      type: 'ROUTE_STOP_ORDER' as const,
      status: 'DELIVERED' as const,
      totals: { ...m, currency: 'CAD' },
      createdAt: new Date('2026-06-10T10:00:00.000Z'),
    })),
  });
}

describe('Cost-centre split-billing e2e (Track A Phase 2)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  // Cost-centre ids captured from the CRUD tests + reused downstream.
  let ccA = '';
  let ccB = '';
  let ccAmenity = '';
  let ccOther = '';

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: object) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body);
  const put = (path: string, who: string, body: object) => request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${token[who]}`).send(body);
  const patch = (path: string, who: string, body: object) => request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body);

  const cents = (s: string): number => Math.round(Number(s) * 100);

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

  // ─────────────────────────── CRUD ───────────────────────────

  describe('cost-centre CRUD', () => {
    it('FINANCE creates Tower A / Tower B / Amenity (201, audited); a re-used code → 409', async () => {
      const a = await post(`/v1/accounts/${ACCT_CC}/cost-centers`, 'finance', { code: 'TWR-A', name: 'Tower A', kind: 'WING' }).expect(201);
      expect(a.body).toMatchObject({ accountId: ACCT_CC, code: 'TWR-A', name: 'Tower A', kind: 'WING', active: true });
      ccA = a.body.id;
      ccB = (await post(`/v1/accounts/${ACCT_CC}/cost-centers`, 'finance', { code: 'TWR-B', name: 'Tower B', kind: 'WING' }).expect(201)).body.id;
      ccAmenity = (await post(`/v1/accounts/${ACCT_CC}/cost-centers`, 'finance', { code: 'AMEN', name: 'Amenity', kind: 'AMENITY' }).expect(201)).body.id;
      ccOther = (await post(`/v1/accounts/${ACCT_OTHER}/cost-centers`, 'finance', { code: 'OTH-1', name: 'Other building CC' }).expect(201)).body.id;

      expect(await prisma.auditLog.findFirst({ where: { entity: 'CostCenter', entityId: ccA, action: 'COST_CENTER_CREATED' } })).not.toBeNull();

      const dup = await post(`/v1/accounts/${ACCT_CC}/cost-centers`, 'finance', { code: 'TWR-A', name: 'Dup' }).expect(409);
      expect(dup.body.error ?? dup.body.title).toContain('duplicate_code');
    });

    it('RBAC: DISPATCHER / DRIVER / residential cannot CREATE (403)', async () => {
      const body = { code: 'NOPE', name: 'Nope' };
      await post(`/v1/accounts/${ACCT_CC}/cost-centers`, 'dispatcher', body).expect(403);
      await post(`/v1/accounts/${ACCT_CC}/cost-centers`, 'driver', body).expect(403);
      await post(`/v1/accounts/${ACCT_CC}/cost-centers`, 'rita', body).expect(403);
    });

    it('cross-org create → 404 (account not in the caller’s scope)', async () => {
      const res = await post(`/v1/accounts/${ACCT_CC}/cost-centers`, 'org2owner', { code: 'X', name: 'X' }).expect(404);
      expect(res.body.error ?? res.body.title).toContain('account_not_found');
    });

    it('a site from another account → 400 site_account_mismatch', async () => {
      const res = await post(`/v1/accounts/${ACCT_OTHER}/cost-centers`, 'finance', { code: 'BADSITE', name: 'Bad', siteId: SITE_CC }).expect(400);
      expect(res.body.error ?? res.body.title).toContain('site_account_mismatch');
    });

    it('FINANCE lists the account’s cost centres (DISPATCHER may read; DRIVER 403; cross-org 404)', async () => {
      const res = await get(`/v1/accounts/${ACCT_CC}/cost-centers`, 'finance').expect(200);
      const codes = res.body.costCenters.map((c: { code: string }) => c.code);
      expect(codes).toEqual(['AMEN', 'TWR-A', 'TWR-B']); // ordered by code asc
      await get(`/v1/accounts/${ACCT_CC}/cost-centers`, 'dispatcher').expect(200);
      await get(`/v1/accounts/${ACCT_CC}/cost-centers`, 'driver').expect(403);
      await get(`/v1/accounts/${ACCT_CC}/cost-centers`, 'org2owner').expect(404);
    });

    it('PATCH renames / re-classifies / deactivates (FINANCE, audited); DISPATCHER 403; cross-org 404', async () => {
      const res = await patch(`/v1/cost-centers/${ccB}`, 'finance', { name: 'Tower B (north)', kind: 'FLOOR' }).expect(200);
      expect(res.body).toMatchObject({ id: ccB, name: 'Tower B (north)', kind: 'FLOOR' });
      expect(await prisma.auditLog.findFirst({ where: { entity: 'CostCenter', entityId: ccB, action: 'COST_CENTER_UPDATED' } })).not.toBeNull();

      // active filter reflects a deactivation.
      await patch(`/v1/cost-centers/${ccOther}`, 'finance', { active: false }).expect(200);
      const activeOnly = await get(`/v1/accounts/${ACCT_OTHER}/cost-centers?active=true`, 'finance').expect(200);
      expect(activeOnly.body.costCenters.some((c: { id: string }) => c.id === ccOther)).toBe(false);

      await patch(`/v1/cost-centers/${ccB}`, 'dispatcher', { name: 'x' }).expect(403);
      await patch(`/v1/cost-centers/${ccA}`, 'org2owner', { name: 'x' }).expect(404);
    });
  });

  // ─────────────────────────── attribution ───────────────────────────

  describe('order attribution', () => {
    it('attributes the four orders (DISPATCHER allowed); a cost centre from another account → 400; detach works', async () => {
      await put(`/v1/orders/${ORD.a1}/cost-center`, 'finance', { costCenterId: ccA }).expect(200);
      const r = await put(`/v1/orders/${ORD.a2}/cost-center`, 'dispatcher', { costCenterId: ccA }).expect(200);
      expect(r.body).toMatchObject({ orderId: ORD.a2, accountId: ACCT_CC, costCenterId: ccA });
      await put(`/v1/orders/${ORD.b1}/cost-center`, 'finance', { costCenterId: ccB }).expect(200);
      await put(`/v1/orders/${ORD.amen}/cost-center`, 'finance', { costCenterId: ccAmenity }).expect(200);
      // ORD.unassigned stays unattributed.

      expect(await prisma.auditLog.findFirst({ where: { entity: 'Order', entityId: ORD.a1, action: 'ORDER_COST_CENTER_SET' } })).not.toBeNull();

      // A cost centre that belongs to ANOTHER account is rejected (tenancy within the org).
      const mismatch = await put(`/v1/orders/${ORD.a1}/cost-center`, 'finance', { costCenterId: ccOther }).expect(400);
      expect(mismatch.body.error ?? mismatch.body.title).toContain('account_mismatch');
      // …and the original attribution is untouched.
      expect((await prisma.order.findUniqueOrThrow({ where: { id: ORD.a1 } })).costCenterId).toBe(ccA);

      // Detach (null) then re-attach.
      await put(`/v1/orders/${ORD.a1}/cost-center`, 'finance', { costCenterId: null }).expect(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: ORD.a1 } })).costCenterId).toBeNull();
      await put(`/v1/orders/${ORD.a1}/cost-center`, 'finance', { costCenterId: ccA }).expect(200);
    });

    it('RBAC: DRIVER / residential cannot attribute (403); cross-org order → 404', async () => {
      await put(`/v1/orders/${ORD.b1}/cost-center`, 'driver', { costCenterId: ccB }).expect(403);
      await put(`/v1/orders/${ORD.b1}/cost-center`, 'rita', { costCenterId: ccB }).expect(403);
      await put(`/v1/orders/${ORD.b1}/cost-center`, 'org2owner', { costCenterId: null }).expect(404);
    });
  });

  // ─────────────────────────── split billing (the core) ───────────────────────────

  describe('split billing', () => {
    it('batches the orders into ONE invoice whose cost-centre breakdown SUMS EXACTLY to the total', async () => {
      const res = await post(`/v1/accounts/${ACCT_CC}/invoices/batch`, 'finance', { ...WINDOW, period: PERIOD }).expect(201);
      // 113.00 + 56.56 + 226.00 + 85.03 + 45.65 = 526.24; subtotal 465.70; tax 60.54.
      expect(res.body).toMatchObject({ status: 'ISSUED', subtotal: '465.70', tax: '60.54', total: '526.24' });

      const breakdown = res.body.costCenterBreakdown as Array<{ costCenterId: string | null; code: string; subtotal: string; tax: string; total: string }>;
      // Reconciliation (cents-exact): Σ splits == invoice subtotal/tax/total.
      expect(breakdown.reduce((a, e) => a + cents(e.subtotal), 0)).toBe(cents(res.body.subtotal));
      expect(breakdown.reduce((a, e) => a + cents(e.tax), 0)).toBe(cents(res.body.tax));
      expect(breakdown.reduce((a, e) => a + cents(e.total), 0)).toBe(cents(res.body.total));

      const byId = new Map(breakdown.map((e) => [e.costCenterId, e]));
      expect(byId.get(ccA)).toMatchObject({ code: 'TWR-A', subtotal: '150.05', tax: '19.51', total: '169.56' }); // 100.00+50.05
      expect(byId.get(ccB)).toMatchObject({ subtotal: '200.00', tax: '26.00', total: '226.00' });
      expect(byId.get(ccAmenity)).toMatchObject({ subtotal: '75.25', tax: '9.78', total: '85.03' });
      // The explicit Unassigned bucket — honest, never dropped, always last.
      expect(byId.get(null)).toMatchObject({ code: 'UNASSIGNED', subtotal: '40.40', tax: '5.25', total: '45.65' });
      expect(breakdown[breakdown.length - 1].costCenterId).toBeNull();

      // InvoiceLines are tagged with their order's cost centre (persisted, not just in the JSON).
      const invId = res.body.id as string;
      const taggedA = await prisma.invoiceLine.count({ where: { invoiceId: invId, costCenterId: ccA } });
      expect(taggedA).toBe(2);
      const untagged = await prisma.invoiceLine.count({ where: { invoiceId: invId, costCenterId: null } });
      expect(untagged).toBe(1);
    });

    it('idempotent re-run returns the SAME invoice with a STABLE breakdown (no double-charge)', async () => {
      const first = await post(`/v1/accounts/${ACCT_CC}/invoices/batch`, 'finance', { ...WINDOW, period: PERIOD }).expect(201);
      const again = await post(`/v1/accounts/${ACCT_CC}/invoices/batch`, 'finance', { ...WINDOW, period: PERIOD }).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.total).toBe('526.24');
      expect(again.body.costCenterBreakdown).toEqual(first.body.costCenterBreakdown);
      expect(await prisma.invoice.count({ where: { accountId: ACCT_CC, period: PERIOD } })).toBe(1);
    });

    it('HST is taken from the order totals (derived upstream) — never re-derived/hardcoded here', async () => {
      // The tax in the breakdown is exactly the sum of the orders' own tax fields (13.00+6.51+26.00+9.78+5.25).
      const res = await post(`/v1/accounts/${ACCT_CC}/invoices/batch`, 'finance', { ...WINDOW, period: PERIOD }).expect(201);
      expect(res.body.tax).toBe('60.54');
    });
  });

  // ─────────────────────────── report + CSV ───────────────────────────

  describe('period report + CSV export', () => {
    it('per-cost-centre totals reconcile to the grand total (DRIVER 403; cross-org 404)', async () => {
      const res = await get(`/v1/accounts/${ACCT_CC}/cost-centers/report?from=${WINDOW.from}&to=${WINDOW.to}`, 'finance').expect(200);
      expect(res.body.grandTotal).toMatchObject({ subtotal: '465.70', tax: '60.54', total: '526.24' });
      const rowSum = res.body.rows.reduce((a: number, r: { total: string }) => a + cents(r.total), 0);
      expect(rowSum).toBe(cents(res.body.grandTotal.total));
      const towerA = res.body.rows.find((r: { costCenterId: string | null }) => r.costCenterId === ccA);
      expect(towerA).toMatchObject({ code: 'TWR-A', orderCount: 2, total: '169.56' });
      expect(res.body.rows.some((r: { costCenterId: string | null }) => r.costCenterId === null)).toBe(true); // Unassigned bucket

      await get(`/v1/accounts/${ACCT_CC}/cost-centers/report?from=${WINDOW.from}&to=${WINDOW.to}`, 'driver').expect(403);
      await get(`/v1/accounts/${ACCT_CC}/cost-centers/report?from=${WINDOW.from}&to=${WINDOW.to}`, 'org2owner').expect(404);
    });

    it('CSV export returns real, account-scoped text/csv bytes (header + rows + TOTAL)', async () => {
      const res = await get(`/v1/accounts/${ACCT_CC}/cost-centers/report.csv?from=${WINDOW.from}&to=${WINDOW.to}`, 'finance').expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain(`cost-centers-${ACCT_CC}`);
      const lines = res.text.trim().split('\r\n');
      expect(lines[0]).toBe('cost_center_id,code,name,kind,order_count,subtotal,tax,total,currency');
      expect(res.text).toContain('TWR-A');
      expect(res.text).toContain('UNASSIGNED');
      const totalRow = lines[lines.length - 1].split(',');
      expect(totalRow[1]).toBe('TOTAL');
      expect(totalRow[7]).toBe('526.24'); // grand total
    });
  });

  // ─────────────────────────── standing-order propagation ───────────────────────────

  describe('standing-order cost-centre propagation', () => {
    it('a standing order carries a cost centre that its GENERATED orders inherit', async () => {
      const created = await post('/v1/standing-orders', 'owner', {
        accountId: ACCT_CC,
        siteId: SITE_CC,
        serviceId: SVC_CC,
        vertical: 'LINEN',
        cadence: 'WEEKLY',
        weekday: 1, // Monday
        pickupWindow: { start: '07:00', end: '09:00' },
        concierge: true,
        costCenterId: ccA,
        startsOn: MON,
      }).expect(201);
      expect(created.body.costCenterId).toBe(ccA);
      const soId: string = created.body.id;

      // A cost centre from another account is rejected at the source.
      await post('/v1/standing-orders', 'owner', {
        accountId: ACCT_CC,
        siteId: SITE_CC,
        serviceId: SVC_CC,
        vertical: 'LINEN',
        cadence: 'WEEKLY',
        weekday: 1,
        pickupWindow: { start: '07:00', end: '09:00' },
        costCenterId: ccOther,
        startsOn: MON,
      }).expect(400);

      const run = await post('/v1/standing-orders/run', 'owner', { asOf: MON_ASOF, standingOrderId: soId }).expect(200);
      expect(run.body).toMatchObject({ ordersCreated: 1 });

      const occ = await prisma.standingOrderOccurrence.findFirstOrThrow({ where: { standingOrderId: soId } });
      const order = await prisma.order.findUniqueOrThrow({ where: { id: occ.orderId! } });
      expect(order.costCenterId).toBe(ccA); // INHERITED
    });
  });
});
