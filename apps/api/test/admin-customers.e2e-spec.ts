import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Console customer-360 e2e (Increment 27). Boots the real app against the real (migrated) Postgres +
 * PostGIS + Redis and proves the whole read surface:
 *
 *   • `GET /v1/admin/customers` — lists ONLY users holding RESIDENTIAL_CUSTOMER; cursor pagination walks
 *     the whole set with no duplicates; search matches name / phone / email case-insensitively; a bad
 *     limit or cursor is a 400, and blank query params are simply absent.
 *   • `GET /v1/admin/customers/:id` — the aggregate: identity + grants, saved addresses (with the Inc-26
 *     PostGIS point and the three-state coverage answer), account order history with honest per-order
 *     attribution, invoices, payments, devices (token MASKED), memberships, notification config.
 *   • RBAC: OWNER and CSR pass; DISPATCHER / DRIVER / FINANCE / a residential customer are 403.
 *   • Confinement: a STAFF user's id → 404 (this must never become a staff-PII read); an ACCOUNT_ADMIN →
 *     404; a cross-org customer → 404.
 *   • Accountability: reading one 360 writes exactly one `CUSTOMER_360_VIEWED` AuditLog row naming the
 *     staff actor; listing writes none.
 *   • Honesty: a customer with no addresses/orders/devices returns empty arrays, never invented rows; an
 *     unpriced order reports `total: null`; a customer with no NotificationPreference reports
 *     `configured: false`; with no active service zones every address reports `checked: false`.
 *
 * Fixtures are created by this spec (id prefix `c7000000-`) and torn down in beforeAll AND afterAll, so
 * ORG1 is left exactly as found (in particular: ZERO active service zones, which every other spec relies on).
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ORG2 = 'e0000000-0000-4000-8000-000000000002';

// Deterministic fixture ids (c7 = customer-360 e2e).
const ACCT = 'c7000000-0000-4000-8000-000000000001'; // the rich customer's account
const BARE_ACCT = 'c7000000-0000-4000-8000-000000000002'; // a customer with nothing
const ORG2_ACCT = 'c7000000-0000-4000-8000-000000000003';
const SVC = 'c7000000-0000-4000-8000-000000000004';
const ZONE = 'c7000000-0000-4000-8000-000000000005';

const RICH = { uid: 'c7000000-0000-4000-8000-000000000010', rid: 'c7000000-0000-4000-8000-000000000011', phone: '+14165557010', name: 'C360 E2E Zara Rich', email: 'zara.rich@c360.example' };
const BARE = { uid: 'c7000000-0000-4000-8000-000000000020', rid: 'c7000000-0000-4000-8000-000000000021', phone: '+14165557020', name: 'C360 E2E Yusuf Bare', email: 'yusuf.bare@c360.example' };
const ORG2_CUST = { uid: 'c7000000-0000-4000-8000-000000000030', rid: 'c7000000-0000-4000-8000-000000000031', phone: '+14165557030', name: 'C360 E2E Org2 Customer', email: 'org2@c360.example' };

const SITE_A = 'c7000000-0000-4000-8000-000000000040'; // default, has a point (downtown Toronto)
const SITE_B = 'c7000000-0000-4000-8000-000000000041'; // non-default, has a point
const SITE_GONE = 'c7000000-0000-4000-8000-000000000042'; // deactivated → must NOT appear
const SITE_NOGEO = 'c7000000-0000-4000-8000-000000000043'; // no PostGIS point → serviceability null

const ORDER_PRICED = 'c7000000-0000-4000-8000-000000000050';
const ORDER_UNPRICED = 'c7000000-0000-4000-8000-000000000051';
const ORDER_NOCREATOR = 'c7000000-0000-4000-8000-000000000052';
const INVOICE = 'c7000000-0000-4000-8000-000000000060';
const PAYMENT = 'c7000000-0000-4000-8000-000000000061';
const DEVICE = 'c7000000-0000-4000-8000-000000000070';

const IN_ZONE = { lng: -79.3832, lat: 43.6532 }; // Toronto city hall — inside ZONE_BOX
const OUT_ZONE = { lng: -75.6972, lat: 45.4215 }; // Ottawa — far outside
const ZONE_BOX = {
  type: 'Polygon' as const,
  coordinates: [[[-79.45, 43.6], [-79.3, 43.6], [-79.3, 43.72], [-79.45, 43.72], [-79.45, 43.6]]],
};

const PHONES = {
  owner: '+14165550001',
  csr: '+14165550003',
  dispatcher: '+14165550002',
  driver: '+14165550006',
  finance: '+14165550005',
  org2owner: '+14165559001',
  rich: RICH.phone,
  careAdmin: '+14165550030', // ACCOUNT_ADMIN — a real user, but NOT a residential customer
};

async function tearDown(prisma: PrismaClient): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { action: 'CUSTOMER_360_VIEWED', entityId: { in: [RICH.uid, BARE.uid] } } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { id: PAYMENT } });
  await prisma.invoice.deleteMany({ where: { id: INVOICE } });
  await prisma.order.deleteMany({ where: { id: { in: [ORDER_PRICED, ORDER_UNPRICED, ORDER_NOCREATOR] } } });
  await prisma.device.deleteMany({ where: { id: DEVICE } });
  await prisma.site.deleteMany({ where: { id: { in: [SITE_A, SITE_B, SITE_GONE, SITE_NOGEO] } } });
  await prisma.userRole.deleteMany({ where: { id: { in: [RICH.rid, BARE.rid, ORG2_CUST.rid] } } });
  await prisma.user.deleteMany({ where: { id: { in: [RICH.uid, BARE.uid, ORG2_CUST.uid] } } });
  await prisma.account.deleteMany({ where: { id: { in: [ACCT, BARE_ACCT, ORG2_ACCT] } } });
  await prisma.service.deleteMany({ where: { id: SVC } });
  await prisma.serviceZone.deleteMany({ where: { id: ZONE } });
}

async function seedFixture(prisma: PrismaClient): Promise<void> {
  await prisma.account.create({ data: { id: ACCT, orgId: ORG1, type: 'RESIDENTIAL', name: 'C360 E2E — Zara account' } });
  await prisma.account.create({ data: { id: BARE_ACCT, orgId: ORG1, type: 'RESIDENTIAL', name: 'C360 E2E — Yusuf account' } });
  await prisma.account.create({ data: { id: ORG2_ACCT, orgId: ORG2, type: 'RESIDENTIAL', name: 'C360 E2E — org2 account' } });
  await prisma.service.create({ data: { id: SVC, orgId: ORG1, vertical: 'SPECIALTY', name: 'C360 E2E service', unit: 'ITEM', baseRate: '10.0000' } });

  for (const [f, orgId, acct] of [
    [RICH, ORG1, ACCT],
    [BARE, ORG1, BARE_ACCT],
    [ORG2_CUST, ORG2, ORG2_ACCT],
  ] as const) {
    await prisma.user.create({ data: { id: f.uid, orgId, name: f.name, phone: f.phone, email: f.email, authProviders: ['phone'], status: 'ACTIVE' } });
    await prisma.userRole.create({ data: { id: f.rid, orgId, userId: f.uid, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: acct } });
  }

  // Saved addresses (Inc-26). Two active with points, one deactivated, one active with no point.
  await prisma.site.create({ data: { id: SITE_A, orgId: ORG1, accountId: ACCT, name: 'Home', address: '100 Queen St W', unit: '12B', buzzer: '1204', notes: 'Side door', isDefault: true, active: true } });
  await prisma.site.create({ data: { id: SITE_B, orgId: ORG1, accountId: ACCT, name: 'Cottage', address: '111 Wellington St, Ottawa', isDefault: false, active: true } });
  await prisma.site.create({ data: { id: SITE_GONE, orgId: ORG1, accountId: ACCT, name: 'Old place', address: '1 Removed Rd', isDefault: false, active: false } });
  await prisma.site.create({ data: { id: SITE_NOGEO, orgId: ORG1, accountId: ACCT, name: 'No pin', address: 'Unresolved', isDefault: false, active: true } });
  await prisma.$executeRaw`UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${IN_ZONE.lng}, ${IN_ZONE.lat}), 4326)::geography WHERE id = ${SITE_A}::uuid`;
  await prisma.$executeRaw`UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${OUT_ZONE.lng}, ${OUT_ZONE.lat}), 4326)::geography WHERE id = ${SITE_B}::uuid`;

  // Orders on the ACCOUNT: one priced+booked by the customer, one unpriced booked by staff, one with no creator.
  await prisma.order.create({ data: { id: ORDER_PRICED, orgId: ORG1, accountId: ACCT, siteId: SITE_A, status: 'INVOICED', vertical: 'SPECIALTY', totals: { total: '158.20', currency: 'CAD' }, createdBy: RICH.uid } });
  await prisma.order.create({ data: { id: ORDER_UNPRICED, orgId: ORG1, accountId: ACCT, siteId: SITE_A, status: 'REQUESTED', vertical: 'SPECIALTY', totals: {}, createdBy: '22222222-2222-4222-8222-222222222222' } });
  await prisma.order.create({ data: { id: ORDER_NOCREATOR, orgId: ORG1, accountId: ACCT, status: 'REQUESTED', vertical: 'SPECIALTY', totals: {}, createdBy: null } });

  await prisma.invoice.create({ data: { id: INVOICE, orgId: ORG1, accountId: ACCT, orderId: ORDER_PRICED, number: 'C360-E2E-1', subtotal: '140.00', tax: '18.20', total: '158.20', currency: 'CAD', status: 'ISSUED', issuedAt: new Date() } });
  await prisma.payment.create({ data: { id: PAYMENT, orgId: ORG1, accountId: ACCT, orderId: ORDER_PRICED, invoiceId: INVOICE, method: 'CARD', amount: '158.20', currency: 'CAD', status: 'SUCCEEDED' } });

  await prisma.device.create({ data: { id: DEVICE, orgId: ORG1, userId: RICH.uid, platform: 'IOS', pushToken: 'ExponentPushToken[SUPERSECRETTAIL9876]', lastSeen: new Date() } });
}

describe('Console customer-360 e2e (Increment 27 — /v1/admin/customers)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

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

  // ─────────────────────────── RBAC ───────────────────────────

  describe('RBAC — OWNER + CSR only (this route reads consumer PII)', () => {
    it('OWNER and CSR may list and read a 360', async () => {
      await get('/v1/admin/customers?limit=5', 'owner').expect(200);
      await get('/v1/admin/customers?limit=5', 'csr').expect(200);
      await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      await get(`/v1/admin/customers/${RICH.uid}`, 'csr').expect(200);
    });

    it('DISPATCHER, DRIVER, FINANCE and a residential customer are 403 on both routes', async () => {
      for (const who of ['dispatcher', 'driver', 'finance', 'rich'] as const) {
        await get('/v1/admin/customers', who).expect(403);
        await get(`/v1/admin/customers/${RICH.uid}`, who).expect(403);
      }
    });
  });

  // ─────────────────────────── confinement ───────────────────────────

  describe('confinement — never a staff-PII read, never cross-org', () => {
    it("a STAFF user's id → 404, not their profile", async () => {
      const driver = await prisma.user.findFirstOrThrow({ where: { phone: PHONES.driver } });
      const res = await get(`/v1/admin/customers/${driver.id}`, 'owner').expect(404);
      expect(res.body.title).toBe('admin.customer_not_found');
      expect(JSON.stringify(res.body)).not.toContain('Demo Driver');
    });

    it('an ACCOUNT_ADMIN (a real user, not a residential customer) → 404', async () => {
      const careAdmin = await prisma.user.findFirstOrThrow({ where: { phone: PHONES.careAdmin } });
      await get(`/v1/admin/customers/${careAdmin.id}`, 'owner').expect(404);
    });

    it("an ORG-2 customer is invisible to ORG-1's owner (404), and vice versa", async () => {
      await get(`/v1/admin/customers/${ORG2_CUST.uid}`, 'owner').expect(404);
      await get(`/v1/admin/customers/${RICH.uid}`, 'org2owner').expect(404);
    });

    it("org-2's owner never sees org-1's customers in the list", async () => {
      const res = await get('/v1/admin/customers?limit=100', 'org2owner').expect(200);
      const ids = res.body.customers.map((c: { userId: string }) => c.userId);
      expect(ids).toContain(ORG2_CUST.uid);
      expect(ids).not.toContain(RICH.uid);
      expect(ids).not.toContain(BARE.uid);
    });

    it('a malformed id is a 400, not a 404 scan', async () => {
      await get('/v1/admin/customers/not-a-uuid', 'owner').expect(400);
    });
  });

  // ─────────────────────────── list + search + pagination ───────────────────────────

  describe('list', () => {
    it('lists only RESIDENTIAL_CUSTOMERs — no staff, no account admins', async () => {
      const res = await get('/v1/admin/customers?limit=100', 'owner').expect(200);
      const ids: string[] = res.body.customers.map((c: { userId: string }) => c.userId);
      expect(ids).toContain(RICH.uid);
      expect(ids).toContain(BARE.uid);

      const driver = await prisma.user.findFirstOrThrow({ where: { phone: PHONES.driver } });
      const careAdmin = await prisma.user.findFirstOrThrow({ where: { phone: PHONES.careAdmin } });
      expect(ids).not.toContain(driver.id);
      expect(ids).not.toContain(careAdmin.id);
    });

    it('reports ACCOUNT-level order stats and ACTIVE saved-address counts (a removed address is not counted)', async () => {
      const res = await get(`/v1/admin/customers?search=${encodeURIComponent(RICH.name)}`, 'owner').expect(200);
      expect(res.body.customers).toHaveLength(1);
      const c = res.body.customers[0];
      expect(c).toMatchObject({ userId: RICH.uid, phone: RICH.phone, email: RICH.email, status: 'ACTIVE' });
      expect(c.accountOrderCount).toBe(3);
      expect(c.lastAccountOrderAt).not.toBeNull();
      expect(c.savedAddressCount).toBe(3); // SITE_A + SITE_B + SITE_NOGEO; SITE_GONE is deactivated
      expect(c.accounts).toEqual([{ id: ACCT, name: 'C360 E2E — Zara account', type: 'RESIDENTIAL' }]);
    });

    it('a customer with nothing reports zeroes and an empty account list — never invented activity', async () => {
      const res = await get(`/v1/admin/customers?search=${encodeURIComponent(BARE.name)}`, 'owner').expect(200);
      const c = res.body.customers[0];
      expect(c.accountOrderCount).toBe(0);
      expect(c.lastAccountOrderAt).toBeNull();
      expect(c.savedAddressCount).toBe(0);
    });

    it('search matches name, phone and email — case-insensitively', async () => {
      for (const q of ['zara rich', 'ZARA RICH', '5557010', 'ZARA.RICH@c360.EXAMPLE']) {
        const res = await get(`/v1/admin/customers?search=${encodeURIComponent(q)}`, 'owner').expect(200);
        expect(res.body.customers.map((c: { userId: string }) => c.userId)).toContain(RICH.uid);
      }
      const none = await get('/v1/admin/customers?search=zzz-no-such-customer', 'owner').expect(200);
      expect(none.body.customers).toHaveLength(0);
      expect(none.body.hasMore).toBe(false);
      expect(none.body.nextCursor).toBeNull();
    });

    it('cursor pagination walks the whole set with no duplicates and terminates', async () => {
      const all = await get('/v1/admin/customers?limit=100', 'owner').expect(200);
      const total: number = all.body.customers.length;
      expect(all.body.hasMore).toBe(false);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url: string = `/v1/admin/customers?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await get(url, 'owner').expect(200);
        seen.push(...res.body.customers.map((c: { userId: string }) => c.userId));
        cursor = res.body.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(60); // never loop forever
      } while (cursor);

      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total); // no row served twice
    });

    it('rejects an out-of-range limit or a malformed cursor (400), and treats blank params as absent (200)', async () => {
      await get('/v1/admin/customers?limit=0', 'owner').expect(400);
      await get('/v1/admin/customers?limit=999', 'owner').expect(400);
      await get('/v1/admin/customers?cursor=not-a-uuid', 'owner').expect(400);
      await get('/v1/admin/customers?search=&cursor=&limit=', 'owner').expect(200);
    });
  });

  // ─────────────────────────── the 360 aggregate ───────────────────────────

  describe('the 360 aggregate', () => {
    it('returns identity, grants and accounts', async () => {
      const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      expect(res.body.customer).toMatchObject({
        userId: RICH.uid,
        name: RICH.name,
        phone: RICH.phone,
        email: RICH.email,
        status: 'ACTIVE',
        authProviders: ['phone'],
      });
      expect(res.body.customer.roles).toEqual([{ role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: ACCT }]);
      expect(res.body.accounts).toEqual([{ id: ACCT, name: 'C360 E2E — Zara account', type: 'RESIDENTIAL' }]);
    });

    it('lists only ACTIVE saved addresses, default first, with the real PostGIS point', async () => {
      const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      const ids = res.body.addresses.map((a: { id: string }) => a.id);
      expect(ids).not.toContain(SITE_GONE); // soft-deleted → gone from the console too
      expect(ids[0]).toBe(SITE_A); // isDefault sorts first

      const home = res.body.addresses.find((a: { id: string }) => a.id === SITE_A);
      expect(home).toMatchObject({ name: 'Home', address: '100 Queen St W', unit: '12B', buzzer: '1204', notes: 'Side door', isDefault: true });
      expect(home.geo.lng).toBeCloseTo(IN_ZONE.lng, 5);
      expect(home.geo.lat).toBeCloseTo(IN_ZONE.lat, 5);
    });

    it('an address with NO point reports geo null and serviceability null — nothing to test, nothing claimed', async () => {
      const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      const noPin = res.body.addresses.find((a: { id: string }) => a.id === SITE_NOGEO);
      expect(noPin.geo).toBeNull();
      expect(noPin.serviceability).toBeNull();
    });

    it('with NO active zones every address reports checked:false — an inert gate is not evidence of coverage', async () => {
      const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      for (const a of res.body.addresses.filter((x: { geo: unknown }) => x.geo !== null)) {
        expect(a.serviceability).toEqual({ checked: false, serviceable: false, coverageRequestId: null });
      }
    });

    it('with an ACTIVE zone, coverage is answered per address from the same PostGIS gate as booking', async () => {
      await prisma.serviceZone.create({ data: { id: ZONE, orgId: ORG1, name: 'C360 E2E zone', active: true, sortOrder: 99 } });
      await prisma.$executeRaw`UPDATE "ServiceZone" SET area = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(ZONE_BOX)}), 4326)::geography WHERE id = ${ZONE}::uuid`;
      try {
        const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
        const home = res.body.addresses.find((a: { id: string }) => a.id === SITE_A);
        const cottage = res.body.addresses.find((a: { id: string }) => a.id === SITE_B);
        expect(home.serviceability).toEqual({ checked: true, serviceable: true, coverageRequestId: null });
        expect(cottage.serviceability).toEqual({ checked: true, serviceable: false, coverageRequestId: null });
      } finally {
        await prisma.serviceZone.deleteMany({ where: { id: ZONE } });
      }
    });

    it('reading a 360 NEVER captures out-of-area demand (it is a read, not a booking)', async () => {
      await prisma.serviceZone.create({ data: { id: ZONE, orgId: ORG1, name: 'C360 E2E zone', active: true, sortOrder: 99 } });
      await prisma.$executeRaw`UPDATE "ServiceZone" SET area = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(ZONE_BOX)}), 4326)::geography WHERE id = ${ZONE}::uuid`;
      const before = await prisma.coverageRequest.count({ where: { orgId: ORG1 } });
      try {
        await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200); // SITE_B is out of the zone
        expect(await prisma.coverageRequest.count({ where: { orgId: ORG1 } })).toBe(before);
      } finally {
        await prisma.serviceZone.deleteMany({ where: { id: ZONE } });
      }
    });

    it('order history is ACCOUNT-scoped, newest first, with honest per-order attribution', async () => {
      const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      expect(res.body.accountOrderCount).toBe(3);

      const byId = new Map(res.body.orders.map((o: { id: string }) => [o.id, o]));
      expect(byId.get(ORDER_PRICED)).toMatchObject({ total: '158.20', currency: 'CAD', status: 'INVOICED', bookedByThisCustomer: true });
      // Booked by staff → false. Unpriced → total null, never "0".
      expect(byId.get(ORDER_UNPRICED)).toMatchObject({ total: null, bookedByThisCustomer: false });
      // `createdBy` unset → we do not know. NULL, never a fabricated false.
      expect(byId.get(ORDER_NOCREATOR)).toMatchObject({ bookedByThisCustomer: null });
    });

    it('surfaces invoices and payments for the account', async () => {
      const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      expect(res.body.invoices).toHaveLength(1);
      expect(res.body.invoices[0]).toMatchObject({ id: INVOICE, number: 'C360-E2E-1', status: 'ISSUED', total: '158.20', currency: 'CAD', orderId: ORDER_PRICED });
      expect(res.body.payments).toHaveLength(1);
      expect(res.body.payments[0]).toMatchObject({ id: PAYMENT, status: 'SUCCEEDED', method: 'CARD', amount: '158.20', orderId: ORDER_PRICED, invoiceId: INVOICE });
    });

    it('MASKS the device push token — the full token never crosses the wire', async () => {
      const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      expect(res.body.devices).toHaveLength(1);
      // `maskPushToken` keeps the last 4 characters only — here the tail of "…TAIL9876]".
      expect(res.body.devices[0].pushTokenMasked).toBe('…876]');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('SUPERSECRETTAIL');
      expect(body).not.toContain('ExponentPushToken');
    });

    it('a customer with no NotificationPreference reports configured:false (a default is not a choice)', async () => {
      const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      expect(res.body.notifications).toMatchObject({ configured: false, pushEnabled: true, smsEnabled: true, emailEnabled: true });
    });

    it('never surfaces chat — the driver↔customer thread is staff-invisible by design', async () => {
      const res = await get(`/v1/admin/customers/${RICH.uid}`, 'owner').expect(200);
      expect(Object.keys(res.body)).not.toContain('chat');
      expect(Object.keys(res.body)).not.toContain('messages');
    });

    it('a customer with nothing returns empty arrays, not invented rows', async () => {
      const res = await get(`/v1/admin/customers/${BARE.uid}`, 'owner').expect(200);
      expect(res.body.addresses).toEqual([]);
      expect(res.body.orders).toEqual([]);
      expect(res.body.accountOrderCount).toBe(0);
      expect(res.body.invoices).toEqual([]);
      expect(res.body.payments).toEqual([]);
      expect(res.body.devices).toEqual([]);
      expect(res.body.memberships).toEqual([]);
    });
  });

  // ─────────────────────────── accountability ───────────────────────────

  describe('audit — staff reading consumer PII is accountable (§8.7)', () => {
    it('reading a 360 writes exactly one CUSTOMER_360_VIEWED row naming the staff actor', async () => {
      const csr = await prisma.user.findFirstOrThrow({ where: { phone: PHONES.csr } });
      const where = { action: 'CUSTOMER_360_VIEWED', entity: 'User', entityId: BARE.uid } as const;
      const before = await prisma.auditLog.count({ where });

      await get(`/v1/admin/customers/${BARE.uid}`, 'csr').expect(200);

      const rows = await prisma.auditLog.findMany({ where, orderBy: { at: 'desc' } });
      expect(rows.length).toBe(before + 1);
      expect(rows[0]?.actorId).toBe(csr.id);
    });

    it('LISTING customers writes no audit row (a directory read is not a PII drill-down)', async () => {
      const before = await prisma.auditLog.count({ where: { action: 'CUSTOMER_360_VIEWED' } });
      await get('/v1/admin/customers?limit=50', 'owner').expect(200);
      await get('/v1/admin/customers?search=zara', 'owner').expect(200);
      expect(await prisma.auditLog.count({ where: { action: 'CUSTOMER_360_VIEWED' } })).toBe(before);
    });

    it('a 403 or a 404 never writes an audit row (nothing was read)', async () => {
      const before = await prisma.auditLog.count({ where: { action: 'CUSTOMER_360_VIEWED' } });
      await get(`/v1/admin/customers/${RICH.uid}`, 'driver').expect(403);
      await get(`/v1/admin/customers/${ORG2_CUST.uid}`, 'owner').expect(404);
      expect(await prisma.auditLog.count({ where: { action: 'CUSTOMER_360_VIEWED' } })).toBe(before);
    });
  });
});
