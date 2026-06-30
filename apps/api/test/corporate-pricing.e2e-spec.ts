import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Corporate accounts + per-account rate cards + building-match pricing e2e (Increment 15). Boots the real
 * app against the real (migrated) Postgres + Redis and proves the Definition of Done end-to-end:
 *   • Owner/finance create a corporate account → building (real PostGIS geo + match radius) → per-pound (LB)
 *     and per-item (ITEM) rate card; the resolved rate is shown. RBAC: a member/dispatcher/driver can't
 *     manage or edit pricing (403); cross-org → 404; a non-corporate account → 400.
 *   • Building match (condo path): a resident booking INSIDE a corporate building is priced on the
 *     corporate rate card (LB and ITEM both) and PAYS INDIVIDUALLY (order under the resident account, no
 *     charge to the corporate account). A resident OUTSIDE falls back to default pricing cleanly.
 *   • Join code (TTC path): redeem grants a membership (idempotent; bad/expired code → 400); that member
 *     then gets corporate pricing with no service point.
 *   • Tenancy isolation: a member of corp A never sees corp B's data/pricing; memberships are user-scoped;
 *     a cross-org code is invalid.
 *   • No regression: a plain residential booking (no point, no membership) keeps default pricing.
 *
 * The corporate accounts are created via the API (testing the endpoints) and torn down by name prefix —
 * deleting a corporate account cascades its sites/rate-card/memberships and SET-NULLs any order's
 * pricing_account_id, so residential orders survive untouched. Residential fixtures are deterministic
 * upserts (idempotent across runs); their orders accumulate like the other order e2es.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';

// Deterministic fixture ids (ce = corporate-pricing e2e).
const SVC_LB = 'ce000000-0000-4000-8000-000000000001'; // per-pound wash & fold (baseRate 2.50 = retail default)
const SVC_ITEM = 'ce000000-0000-4000-8000-000000000002'; // per-item dry clean (baseRate 12.00 = retail default)
const RES_IN = { acct: 'ce000000-0000-4000-8000-000000000010', uid: 'ce000000-0000-4000-8000-000000000011', rid: 'ce000000-0000-4000-8000-000000000012', phone: '+14165559210' };
const RES_OUT = { acct: 'ce000000-0000-4000-8000-000000000020', uid: 'ce000000-0000-4000-8000-000000000021', rid: 'ce000000-0000-4000-8000-000000000022', phone: '+14165559211' };
const MEMBER = { acct: 'ce000000-0000-4000-8000-000000000030', uid: 'ce000000-0000-4000-8000-000000000031', rid: 'ce000000-0000-4000-8000-000000000032', phone: '+14165559212' };
const OTHER = { acct: 'ce000000-0000-4000-8000-000000000040', uid: 'ce000000-0000-4000-8000-000000000041', rid: 'ce000000-0000-4000-8000-000000000042', phone: '+14165559213' };

// Geo: corp A downtown; corp B ~25 km NE (so an in-A point never matches B).
const P_A = { lng: -79.40, lat: 43.65 };
const P_B = { lng: -79.20, lat: 43.80 };
const IN_A = { lng: -79.4001, lat: 43.6501 }; // ~14 m from P_A → inside the 300 m boundary
const OUTSIDE = { lng: -79.00, lat: 43.50 }; // ~35 km from both

const PHONES = {
  owner: '+14165550001',
  finance: '+14165550005',
  dispatcher: '+14165550002',
  csr: '+14165550003',
  plant: '+14165550004',
  driver: '+14165550006',
  rita: '+14165550010', // seeded RESIDENTIAL_CUSTOMER (Account A) — the no-regression probe
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org isolation
  resIn: RES_IN.phone,
  resOut: RES_OUT.phone,
  member: MEMBER.phone,
  other: OTHER.phone,
};

async function seedFixture(prisma: PrismaClient): Promise<void> {
  await prisma.service.upsert({ where: { id: SVC_LB }, update: {}, create: { id: SVC_LB, orgId: ORG1, vertical: 'WASHFOLD', name: 'CORP E2E wash&fold (per lb)', unit: 'LB', baseRate: '2.5000' } });
  await prisma.service.upsert({ where: { id: SVC_ITEM }, update: {}, create: { id: SVC_ITEM, orgId: ORG1, vertical: 'SPECIALTY', name: 'CORP E2E dry clean (per item)', unit: 'ITEM', baseRate: '12.0000' } });
  for (const r of [RES_IN, RES_OUT, MEMBER, OTHER]) {
    await prisma.account.upsert({ where: { id: r.acct }, update: {}, create: { id: r.acct, orgId: ORG1, type: 'RESIDENTIAL', name: `CORP E2E resident ${r.phone}` } });
    await prisma.user.upsert({ where: { id: r.uid }, update: { phone: r.phone }, create: { id: r.uid, orgId: ORG1, name: `CORP E2E ${r.phone}`, phone: r.phone, authProviders: ['phone'], status: 'ACTIVE' } });
    await prisma.userRole.upsert({ where: { id: r.rid }, update: {}, create: { id: r.rid, orgId: ORG1, userId: r.uid, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: r.acct } });
  }
}

async function tearDown(prisma: PrismaClient): Promise<void> {
  // Deleting the corporate accounts cascades sites + rate-card price lists + memberships, and SET-NULLs
  // any order's pricing_account_id (residential orders survive). Cleans stragglers from a prior failed run.
  await prisma.account.deleteMany({ where: { orgId: ORG1, name: { startsWith: 'CORP E2E — ' } } });
}

describe('Corporate pricing e2e (Increment 15 — corporate accounts + rate cards + building match)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  // Captured from the management tests, reused downstream.
  let corpA = '';
  let corpB = '';
  let codeA = '';
  let codeB = '';

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const put = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const patch = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

  const futureWindow = () => ({ start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 3 * 3600_000).toISOString() });

  function book(who: string, accountId: string, item: Record<string, unknown>, serviceGeo?: { lat: number; lng: number }) {
    const body: Record<string, unknown> = { accountId, pickupWindow: futureWindow(), items: [item] };
    if (serviceGeo) body.serviceGeo = serviceGeo;
    return post('/v1/orders', who, body);
  }

  /** Drive a freshly-booked order to QUOTED as staff and return the quote's first line + totals. */
  async function quoteFor(orderId: string, measurements: Record<string, unknown>): Promise<{ line: any; subtotal: string; tax: string; total: string }> {
    await post(`/v1/orders/${orderId}/schedule-pickup`, 'owner', { pickupWindow: futureWindow() }).expect(200);
    await post(`/v1/orders/${orderId}/received-at-plant`, 'owner', {}).expect(200);
    const order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    for (const item of order.items) {
      await post(`/v1/orders/${orderId}/items/${item.id}/inspection`, 'plant', { conditionCodes: [], measurements }).expect(201);
    }
    const quoted = (await post(`/v1/orders/${orderId}/quote`, 'csr', {}).expect(201)).body;
    const q = quoted.order.quotes[0];
    return { line: q.lines[0], subtotal: q.subtotal, tax: q.tax, total: q.total };
  }

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    await tearDown(prisma);
    await seedFixture(prisma);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
  }, 60000);

  afterAll(async () => {
    await tearDown(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  // ─────────────────────────── management + RBAC ───────────────────────────

  describe('corporate account + building + rate-card management', () => {
    it('FINANCE creates two corporate accounts (BUSINESS, PER_ORDER, corporate=true)', async () => {
      const a = await post('/v1/corporate/accounts', 'finance', { name: 'CORP E2E — Tower A' }).expect(201);
      expect(a.body).toMatchObject({ name: 'CORP E2E — Tower A', type: 'BUSINESS', billingMode: 'PER_ORDER', corporate: true });
      corpA = a.body.id;
      corpB = (await post('/v1/corporate/accounts', 'owner', { name: 'CORP E2E — Tower B' }).expect(201)).body.id;
      expect(await prisma.auditLog.findFirst({ where: { entity: 'Account', entityId: corpA, action: 'CORPORATE_ACCOUNT_CREATED' } })).not.toBeNull();
    });

    it('RBAC: dispatcher / driver / a member cannot create a corporate account (403)', async () => {
      await post('/v1/corporate/accounts', 'dispatcher', { name: 'CORP E2E — nope' }).expect(403);
      await post('/v1/corporate/accounts', 'driver', { name: 'CORP E2E — nope' }).expect(403);
      await post('/v1/corporate/accounts', 'resIn', { name: 'CORP E2E — nope' }).expect(403);
    });

    it('FINANCE adds the buildings with a real PostGIS geo point + 300 m match radius', async () => {
      const ba = await post(`/v1/corporate/accounts/${corpA}/buildings`, 'finance', { name: 'CORP E2E — Tower A bldg', address: '1 A St', geo: P_A, matchRadiusM: 300 }).expect(201);
      expect(ba.body).toMatchObject({ accountId: corpA, matchRadiusM: 300 });
      expect(ba.body.geo.lat).toBeCloseTo(P_A.lat, 4);
      expect(ba.body.geo.lng).toBeCloseTo(P_A.lng, 4);
      await post(`/v1/corporate/accounts/${corpB}/buildings`, 'finance', { name: 'CORP E2E — Tower B bldg', geo: P_B, matchRadiusM: 300 }).expect(201);
      // The building is listed back with its geo + radius.
      const list = await get(`/v1/corporate/accounts/${corpA}/buildings`, 'finance').expect(200);
      expect(list.body.buildings).toHaveLength(1);
    });

    it('FINANCE sets the per-pound + per-item rate card; the RESOLVED rate is shown', async () => {
      const lb = await put(`/v1/corporate/accounts/${corpA}/rate-card/items/${SVC_LB}`, 'finance', { rate: 1.8 }).expect(200);
      expect(lb.body).toMatchObject({ serviceId: SVC_LB, unit: 'LB', accountRate: '1.8000', baseRate: '2.5000', effectiveRate: '1.8000', source: 'account_list' });
      const item = await put(`/v1/corporate/accounts/${corpA}/rate-card/items/${SVC_ITEM}`, 'finance', { rate: 9 }).expect(200);
      expect(item.body).toMatchObject({ serviceId: SVC_ITEM, unit: 'ITEM', accountRate: '9.0000', effectiveRate: '9.0000', source: 'account_list' });
      // Corp B is pricier — used below to prove a corp-A member never gets corp-B pricing.
      await put(`/v1/corporate/accounts/${corpB}/rate-card/items/${SVC_LB}`, 'finance', { rate: 5 }).expect(200);

      const card = await get(`/v1/corporate/accounts/${corpA}/rate-card`, 'finance').expect(200);
      const lbRow = card.body.items.find((i: { serviceId: string }) => i.serviceId === SVC_LB);
      expect(lbRow).toMatchObject({ accountRate: '1.8000', effectiveRate: '1.8000', source: 'account_list' });
      expect(await prisma.auditLog.findFirst({ where: { entity: 'PriceList', action: 'RATE_CARD_ITEM_SET' } })).not.toBeNull();
    });

    it('RBAC: a member cannot edit pricing (403); cross-org → 404; a non-corporate account → 400', async () => {
      await put(`/v1/corporate/accounts/${corpA}/rate-card/items/${SVC_LB}`, 'rita', { rate: 0.01 }).expect(403);
      await get(`/v1/corporate/accounts/${corpA}`, 'org2owner').expect(404);
      await post(`/v1/corporate/accounts/${corpA}/buildings`, 'org2owner', { name: 'x', geo: P_A, matchRadiusM: 300 }).expect(404);
      // A residential (non-corporate) account → 400 not_corporate.
      const res = await post(`/v1/corporate/accounts/${RES_IN.acct}/buildings`, 'finance', { name: 'x', geo: P_A, matchRadiusM: 300 }).expect(400);
      expect(res.body.error ?? res.body.title).toContain('not_corporate');
    });
  });

  // ─────────────────────────── building match (condo path) ───────────────────────────

  describe('building-match pricing — member pays individually', () => {
    it('a resident INSIDE a corporate building is priced on the corporate rate card (per pound)', async () => {
      const order = (await book('resIn', RES_IN.acct, { kind: 'GARMENT', serviceId: SVC_LB, estimatedMeasure: 20 }, IN_A).expect(201)).body;
      // The payer is the resident; the pricing account is the corporate account.
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.accountId).toBe(RES_IN.acct);
      expect(row.pricingAccountId).toBe(corpA);

      const { line, subtotal, tax, total } = await quoteFor(order.id, { weightLb: 20 });
      expect(line.amount).toBe('36.00'); // 20 lb × $1.80 (corporate) — NOT 20 × $2.50 retail
      expect(line.rateSource).toBe('account_list');
      expect(Number(subtotal)).toBe(36); // 20 × 1.80
      expect(Number(tax)).toBeCloseTo(4.68); // 36 × 0.13 HST
      expect(Number(total)).toBeCloseTo(40.68);

      // Pays individually: no charge ever lands on the corporate account.
      expect(await prisma.payment.count({ where: { accountId: corpA } })).toBe(0);
      expect(await prisma.invoice.count({ where: { accountId: corpA } })).toBe(0);
    });

    it('the per-item (dry clean) rate also resolves corporate inside the building', async () => {
      const order = (await book('resIn', RES_IN.acct, { kind: 'GARMENT', serviceId: SVC_ITEM, estimatedMeasure: 1 }, IN_A).expect(201)).body;
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pricingAccountId).toBe(corpA);
      const { line } = await quoteFor(order.id, { count: 1 });
      expect(line.amount).toBe('9.00'); // 1 × $9.00 (corporate) — NOT $12.00 retail
    });

    it('a resident OUTSIDE every corporate building falls back to default pricing cleanly', async () => {
      const order = (await book('resOut', RES_OUT.acct, { kind: 'GARMENT', serviceId: SVC_LB, estimatedMeasure: 20 }, OUTSIDE).expect(201)).body;
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pricingAccountId).toBeNull();
      const { line, subtotal } = await quoteFor(order.id, { weightLb: 20 });
      expect(line.amount).toBe('50.00'); // 20 lb × $2.50 (retail/base) — no corporate override
      expect(line.rateSource).toBe('service_base');
      expect(Number(subtotal)).toBe(50);
    });
  });

  // ─────────────────────────── join code (TTC path) ───────────────────────────

  describe('join code — generate, redeem, membership pricing', () => {
    it('FINANCE generates a join code for each corporate account', async () => {
      codeA = (await post(`/v1/corporate/accounts/${corpA}/join-code`, 'finance', {}).expect(201)).body.joinCode;
      codeB = (await post(`/v1/corporate/accounts/${corpB}/join-code`, 'finance', {}).expect(201)).body.joinCode;
      expect(codeA).toMatch(/^[A-Z0-9]{8}$/);
      expect(codeA).not.toBe(codeB);
    });

    it('a member redeems the code (idempotent); a bad code → 400', async () => {
      const r1 = await post('/v1/corporate/redeem', 'member', { code: codeA }).expect(200);
      expect(r1.body).toMatchObject({ accountId: corpA, status: 'ACTIVE', source: 'JOIN_CODE', alreadyMember: false });
      const r2 = await post('/v1/corporate/redeem', 'member', { code: codeA.toLowerCase() }).expect(200); // case-insensitive + idempotent
      expect(r2.body.alreadyMember).toBe(true);
      const bad = await post('/v1/corporate/redeem', 'member', { code: 'NOTACODE' }).expect(400);
      expect(bad.body.error ?? bad.body.title).toContain('invalid_join_code');
      expect(await prisma.corporateMembership.count({ where: { userId: MEMBER.uid, accountId: corpA, status: 'ACTIVE' } })).toBe(1);
    });

    it('the redeemed member then gets corporate pricing with NO service point (membership path)', async () => {
      const order = (await book('member', MEMBER.acct, { kind: 'GARMENT', serviceId: SVC_LB, estimatedMeasure: 20 }).expect(201)).body;
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pricingAccountId).toBe(corpA);
      const { line } = await quoteFor(order.id, { weightLb: 20 });
      expect(line.amount).toBe('36.00'); // corporate (corp A) — via membership, not geo
    });

    it('an expired code → 400 (the code is preserved, not deleted)', async () => {
      await prisma.account.update({ where: { id: corpB }, data: { joinCodeExpiresAt: new Date(Date.now() - 1000) } });
      const res = await post('/v1/corporate/redeem', 'resOut', { code: codeB }).expect(400);
      expect(res.body.error ?? res.body.title).toContain('join_code_expired');
    });
  });

  // ─────────────────────────── tenancy isolation ───────────────────────────

  describe('tenancy isolation (lens 1)', () => {
    it('memberships are user-scoped — a member sees only their OWN memberships', async () => {
      await prisma.account.update({ where: { id: corpB }, data: { joinCodeExpiresAt: null } }); // un-expire for this probe
      await post('/v1/corporate/redeem', 'other', { code: codeB }).expect(200);

      const mine = await get('/v1/corporate/memberships', 'member').expect(200);
      expect(mine.body.memberships.map((m: { accountId: string }) => m.accountId)).toEqual([corpA]);
      const theirs = await get('/v1/corporate/memberships', 'other').expect(200);
      expect(theirs.body.memberships.map((m: { accountId: string }) => m.accountId)).toEqual([corpB]);
    });

    it('a corp-A member is priced on corp A, never corp B (even with corp B pricier)', async () => {
      // `member` belongs to corp A only; corp B's LB is $5.00. The booking must price at corp A's $1.80.
      const order = (await book('member', MEMBER.acct, { kind: 'GARMENT', serviceId: SVC_LB, estimatedMeasure: 20 }).expect(201)).body;
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pricingAccountId).toBe(corpA);
      const { line } = await quoteFor(order.id, { weightLb: 20 });
      expect(line.amount).toBe('36.00');
    });

    it('a cross-org code is invalid (never leaks another org); a member cannot use the management surface', async () => {
      await post('/v1/corporate/redeem', 'org2owner', { code: codeA }).expect(400);
      await get('/v1/corporate/accounts', 'member').expect(403); // members can't list/manage corporate accounts
    });
  });

  // ─────────────────────────── no regression ───────────────────────────

  describe('no regression — plain residential booking keeps default pricing', () => {
    it('a residential booking with no point + no membership prices on the default rate (unchanged)', async () => {
      const order = (await book('resOut', RES_OUT.acct, { kind: 'GARMENT', serviceId: SVC_LB, estimatedMeasure: 10 }).expect(201)).body;
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pricingAccountId).toBeNull();
      const { line } = await quoteFor(order.id, { weightLb: 10 });
      expect(line.amount).toBe('25.00'); // 10 lb × $2.50 retail — corporate pricing never leaked in
    });
  });
});
