import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Account directory reads e2e (Track-A B2B account console). Boots the real app against the real
 * (seeded) Postgres. Proves GET /v1/accounts + GET /v1/accounts/:id over the SEED's real accounts:
 *   • the list returns the org's real accounts with correct site + active-standing-order counts;
 *   • detail 200 for a real account; RBAC 403 (DRIVER/residential); org-scoping (Org-2 owner can't
 *     see Org-1's account → list excludes it, detail → 404). No invented data.
 */
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444'; // Demo — Rita (residential)
const ACCOUNT_B = 'e0000000-0000-4000-8000-0000000000b0'; // Demo — Harbourview Condos (BUSINESS, the B2B demo)

const PHONES = {
  owner: '+14165550001', // OWNER (Org 1)
  finance: '+14165550005', // FINANCE (Org 1)
  driver: '+14165550006', // DRIVER — org staff but not an accounts consumer → 403
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER → 403
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org isolation probe
};

describe('Accounts directory reads e2e (Track-A B2B console)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

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
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /v1/accounts', () => {
    it('lists the org\'s real accounts with correct counts (Account B = the B2B condo demo)', async () => {
      const res = await get('/v1/accounts?limit=100', 'owner').expect(200);
      expect(Array.isArray(res.body.accounts)).toBe(true);
      expect(typeof res.body.hasMore).toBe('boolean');

      const a = res.body.accounts.find((x: { id: string }) => x.id === ACCOUNT_A);
      const b = res.body.accounts.find((x: { id: string }) => x.id === ACCOUNT_B);
      expect(a).toBeDefined();
      // Account A (residential) — proves the PER_ORDER mode is returned distinctly from BATCH_PERIODIC.
      expect(a).toMatchObject({ type: 'RESIDENTIAL', billingMode: 'PER_ORDER', billingNetDays: 0 });
      expect(b).toBeDefined();
      expect(b).toMatchObject({
        type: 'BUSINESS',
        billingMode: 'BATCH_PERIODIC',
        billingNetDays: 30,
        siteCount: 1, // the seeded Harbourview condo building
        activeStandingOrderCount: 1, // the WEEKLY-Monday concierge standing order
      });
    });

    it('FINANCE can read the directory; DRIVER and a residential customer are 403', async () => {
      await get('/v1/accounts', 'finance').expect(200);
      await get('/v1/accounts', 'driver').expect(403);
      await get('/v1/accounts', 'rita').expect(403);
    });

    it('org-scoping: an Org-2 owner\'s list never includes an Org-1 account', async () => {
      const res = await get('/v1/accounts?limit=100', 'org2owner').expect(200);
      expect(res.body.accounts.some((x: { id: string }) => x.id === ACCOUNT_B)).toBe(false);
    });
  });

  describe('GET /v1/accounts/:accountId', () => {
    it('returns the account detail header (Account B)', async () => {
      const res = await get(`/v1/accounts/${ACCOUNT_B}`, 'owner').expect(200);
      expect(res.body).toMatchObject({
        id: ACCOUNT_B,
        type: 'BUSINESS',
        billingMode: 'BATCH_PERIODIC',
        billingNetDays: 30,
        siteCount: 1,
        activeStandingOrderCount: 1,
      });
      expect(Array.isArray(res.body.sites)).toBe(true);
      expect(res.body.sites.length).toBe(1);
      expect(typeof res.body.createdAt).toBe('string');
    });

    it('org-scoping: an Org-2 owner gets 404 for an Org-1 account (not a cross-tenant read)', async () => {
      await get(`/v1/accounts/${ACCOUNT_B}`, 'org2owner').expect(404);
    });

    it('RBAC: a DRIVER is 403 on detail', async () => {
      await get(`/v1/accounts/${ACCOUNT_B}`, 'driver').expect(403);
    });
  });
});
