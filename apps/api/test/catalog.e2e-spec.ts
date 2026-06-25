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
const SITE_CITY_HALL = '55555555-5555-4555-8555-555555555555';

const PHONES = {
  owner: '+14165550001', // OWNER, org-wide (Org 1)
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
  acctBAdmin: '+14165550020', // ACCOUNT_ADMIN, Account B (no sites seeded)
  org2owner: '+14165559001', // OWNER of Org 2 (cross-org isolation target)
};

/**
 * Catalog e2e (Increment 11) — the thin, additive, customer-self-scoped booking-context reads the
 * customer app consumes: GET /v1/services (org catalog) + GET /v1/sites (the caller's own sites).
 * Locks the row-scoping (org-isolated services, account-isolated sites) and that the ids returned
 * actually book.
 */
describe('Catalog e2e — Increment 11 (GET /v1/services + /v1/sites, customer-self-scoped)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

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
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /v1/services', () => {
    it('returns the org catalog with the seeded specialty service (customer-readable)', async () => {
      const res = await get('/v1/services', 'rita').expect(200);
      const svc = (res.body.services as Array<{ id: string; vertical: string; unit: string; baseRate: string; name: string }>).find(
        (s) => s.id === SERVICE,
      );
      expect(svc).toBeDefined();
      expect(svc?.vertical).toBe('SPECIALTY');
      expect(svc?.unit).toBe('SQFT');
      expect(svc?.baseRate).toBe('6.5'); // Decimal(12,4) "6.5000" → "6.5" via Decimal.toString()
      expect(typeof svc?.name).toBe('string');
    });

    it('is org-isolated: an Org-2 user does NOT see Org-1 services', async () => {
      const res = await get('/v1/services', 'org2owner').expect(200);
      const ids = (res.body.services as Array<{ id: string }>).map((s) => s.id);
      expect(ids).not.toContain(SERVICE);
    });
  });

  describe('GET /v1/sites', () => {
    it("returns ONLY the customer's own account sites (row-scoped)", async () => {
      const res = await get('/v1/sites', 'rita').expect(200);
      const sites = res.body.sites as Array<{ id: string; accountId: string }>;
      expect(sites.length).toBeGreaterThan(0);
      expect(sites.every((s) => s.accountId === ACCOUNT_A)).toBe(true); // never another account's
      expect(sites.map((s) => s.id)).toContain(SITE_CITY_HALL);
    });

    it('a different-account customer never sees Account-A sites (no cross-account leak)', async () => {
      const res = await get('/v1/sites', 'acctBAdmin').expect(200);
      const sites = res.body.sites as Array<{ id: string; accountId: string }>;
      expect(sites.some((s) => s.accountId === ACCOUNT_A)).toBe(false);
      expect(sites.some((s) => s.id === SITE_CITY_HALL)).toBe(false);
    });

    it('org-wide staff see all the org account sites (incl. Account A)', async () => {
      const res = await get('/v1/sites', 'owner').expect(200);
      const sites = res.body.sites as Array<{ id: string; accountId: string }>;
      expect(sites.some((s) => s.accountId === ACCOUNT_A)).toBe(true);
    });
  });

  it('the catalog ids actually book: GET /services + /sites → POST /orders (201)', async () => {
    const services = (await get('/v1/services', 'rita').expect(200)).body.services as Array<{ id: string }>;
    const sites = (await get('/v1/sites', 'rita').expect(200)).body.sites as Array<{ id: string }>;
    const serviceId = services.find((s) => s.id === SERVICE)!.id;
    const siteId = sites[0]!.id;

    const res = await post('/v1/orders', 'rita', {
      accountId: ACCOUNT_A,
      siteId,
      items: [{ kind: 'RUG', serviceId, estimatedMeasure: 30 }],
    }).expect(201);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.siteId).toBe(siteId);
    expect(res.body.totals?.estimateRange).toBeTruthy(); // estimatedMeasure → a rough range
  });
});
