import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

// ── Seeded ids (must match prisma/seed.ts) ──
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_CITY_HALL = '55555555-5555-4555-8555-555555555555';

const PHONES = {
  owner: '+14165550001', // OWNER, org-wide (Org 1)
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A (RBAC negative — not an owner)
  org2owner: '+14165559001', // OWNER of Org 2 (cross-org isolation target)
};

/**
 * Owner cockpit e2e (Increment 14a) — locks the three thin OWNER-scoped reads the owner app renders:
 * GET /v1/owner/today (§7C C2), /owner/approvals (§7C C3), /owner/exceptions (§7C C4). Proves: the
 * reads aggregate real order/quote/stop rows, an owner can act on a pending approval (via the proven
 * quote:approve), the feed surfaces held orders, the whole surface is OWNER-gated (a customer → 403),
 * and it is org-scoped (an Org-2 owner never sees Org-1 rows).
 */
describe('Owner e2e — Increment 14a (GET /v1/owner/today|approvals|exceptions, OWNER-scoped)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

  /** Book a fresh REQUESTED order (as owner) and return its id. */
  async function bookOrder(measure = 40): Promise<string> {
    const res = await post('/v1/orders', 'owner', {
      accountId: ACCOUNT_A,
      siteId: SITE_CITY_HALL,
      items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: measure }],
    }).expect(201);
    return res.body.id as string;
  }

  /** Drive a fresh order book → QUOTED (all steps an OWNER may perform) and return its id. */
  async function driveToQuoted(): Promise<string> {
    const orderId = await bookOrder();
    const received = await post(`/v1/orders/${orderId}/received-at-plant`, 'owner', {}).expect(200);
    const itemId = received.body.items[0].id as string;
    await post(`/v1/orders/${orderId}/items/${itemId}/inspection`, 'owner', {
      conditionCodes: ['frayed'],
      measurements: { sqft: 40 },
      preexistingDamage: false,
    }).expect(201);
    const quoted = await post(`/v1/orders/${orderId}/quote`, 'owner', {}).expect(201);
    expect(quoted.body.order.status).toBe('QUOTED');
    return orderId;
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
    }
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /v1/owner/today', () => {
    it('returns the glanceable day numbers (server-aggregated, real fields)', async () => {
      await bookOrder(); // ensure ≥1 order booked today
      const res = await get('/v1/owner/today', 'owner').expect(200);
      const b = res.body;
      expect(typeof b.dayStart).toBe('string');
      expect(b.timezone).toBe('America/Toronto');
      expect(b.currency).toBe('CAD');
      expect(b.ordersToday).toBeGreaterThanOrEqual(1);
      expect(typeof b.activeOrders).toBe('number');
      expect(typeof b.completedToday).toBe('number');
      expect(typeof b.pendingApprovals).toBe('number');
      expect(typeof b.openExceptions).toBe('number');
      expect(b.revenueToday).toMatch(/^\d+\.\d{2}$/); // fixed-2 dollar string
      expect(b.collectedToday).toMatch(/^\d+\.\d{2}$/);
      expect(b.onTimePercent === null || typeof b.onTimePercent === 'number').toBe(true);
    });

    it('a non-owner (customer) token → 403', async () => {
      await get('/v1/owner/today', 'rita').expect(403);
    });
  });

  describe('GET /v1/owner/approvals', () => {
    it('lists a pending QUOTED order, and approving it removes it from the feed', async () => {
      const orderId = await driveToQuoted();

      const before = await get('/v1/owner/approvals', 'owner').expect(200);
      const mine = (before.body.approvals as Array<{ orderId: string; quoteId: string; total: string }>).find(
        (a) => a.orderId === orderId,
      );
      expect(mine).toBeDefined();
      expect(mine!.quoteId).toBeTruthy();
      expect(mine!.total).toMatch(/^\d+\.\d{2}$/);

      // today.pendingApprovals reflects at least this pending approval
      const today = await get('/v1/owner/today', 'owner').expect(200);
      expect(today.body.pendingApprovals).toBeGreaterThanOrEqual(1);

      // act via the proven quote:approve, then it's gone from the pending feed
      await post(`/v1/orders/${orderId}/quote:approve`, 'owner', {}).expect(200);
      const after = await get('/v1/owner/approvals', 'owner').expect(200);
      expect((after.body.approvals as Array<{ orderId: string }>).some((a) => a.orderId === orderId)).toBe(false);
    });

    it('a non-owner (customer) token → 403', async () => {
      await get('/v1/owner/approvals', 'rita').expect(403);
    });
  });

  describe('GET /v1/owner/exceptions', () => {
    it('surfaces a held order as an ORDER_HELD exception with a deep-link orderId', async () => {
      const orderId = await bookOrder();
      await post(`/v1/orders/${orderId}/hold`, 'owner', { reason: 'awaiting customer callback' }).expect(200);

      const res = await get('/v1/owner/exceptions', 'owner').expect(200);
      const exceptions = res.body.exceptions as Array<{ kind: string; orderId: string | null; occurredAt: string }>;
      const held = exceptions.find((e) => e.kind === 'ORDER_HELD' && e.orderId === orderId);
      expect(held).toBeDefined();
      // feed is sorted newest-first
      const times = exceptions.map((e) => e.occurredAt);
      expect([...times].sort((a, b) => (a < b ? 1 : -1))).toEqual(times);
    });

    it('a non-owner (customer) token → 403', async () => {
      await get('/v1/owner/exceptions', 'rita').expect(403);
    });
  });

  describe('org-scoping (tenancy)', () => {
    it('an Org-2 owner gets 200 but never sees Org-1 approvals/exceptions', async () => {
      const org1Quoted = await driveToQuoted();
      const org1Held = await bookOrder();
      await post(`/v1/orders/${org1Held}/hold`, 'owner', { reason: 'tenancy probe' }).expect(200);

      const approvals = await get('/v1/owner/approvals', 'org2owner').expect(200);
      expect((approvals.body.approvals as Array<{ orderId: string }>).some((a) => a.orderId === org1Quoted)).toBe(false);

      const exceptions = await get('/v1/owner/exceptions', 'org2owner').expect(200);
      expect((exceptions.body.exceptions as Array<{ orderId: string | null }>).some((e) => e.orderId === org1Held)).toBe(
        false,
      );
    });
  });
});
