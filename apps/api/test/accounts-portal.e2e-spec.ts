import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DisputeStatus, OrderStatus, OrderType, OrderVertical, PaymentStatus, RouteStopStatus } from '@blue-bee/shared';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Account portal reads e2e (Track-A B2B console — the Orders / Manifests / Exceptions tabs). Boots the
 * real app against the seeded Postgres and proves, over the SEED's real data + a couple of test-only
 * exception fixtures (created here, cleaned up after — never in the seed):
 *   • Orders — GET /v1/accounts/:id/orders returns ONLY that account's orders (every row scoped);
 *   • Manifests — the account's real load-sheet manifest (CONCIERGE pickup, 2 amenity-linen items);
 *   • Exceptions — the account's feed includes ITS held order and NEVER another account's (isolation);
 *   • RBAC — DRIVER + residential → 403; cross-org id → 404 (not a cross-tenant read).
 */
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444'; // Demo — Rita (residential, Org 1)
const ACCOUNT_B = 'e0000000-0000-4000-8000-0000000000b0'; // Demo — Account B (BUSINESS condo, Org 1)
const A6_STOP1 = 'a6000000-0000-4000-8000-000000000201'; // CONCIERGE pickup stop (Account B)
const A6_ORDER1 = 'a6000000-0000-4000-8000-000000000101'; // its order

const A6_ROUTE = 'a6000000-0000-4000-8000-000000000010'; // the seeded COMPLETED demo route
const ACCOUNT_A_ORDER = '77777777-7777-4777-8777-777777777777'; // the seeded specialty order (Account A)

// Test-only exception fixtures (created in beforeAll, cleaned up in afterAll — NEVER in the seed). They
// exercise EVERY arm of the account-attribution OR-clauses so cross-account isolation is proven, not
// assumed: the simple direct-accountId path (ORDER_HELD), the stop/payment direct-accountId arm, and —
// the leak-prone part — the "attributed via the related ORDER" arm for stops, payments, and disputes.
const HELD_B = 'a6000000-0000-4000-8000-0000000005b0'; // ON_HOLD order, accountId = B
const HELD_A = 'a6000000-0000-4000-8000-0000000005a0'; // ON_HOLD order, accountId = A
const STOP_FAIL_B_VIA = 'a6000000-0000-4000-8000-0000000006b1'; // FAILED stop, accountId=null, order = B's
const STOP_FAIL_A_VIA = 'a6000000-0000-4000-8000-0000000006a1'; // FAILED stop, accountId=null, order = A's
const STOP_FAIL_B_DIRECT = 'a6000000-0000-4000-8000-0000000006b2'; // FAILED stop, accountId = B directly
const PAY_FAIL_B_VIA = 'a6000000-0000-4000-8000-0000000007b1'; // FAILED payment, accountId=null, order = B's
const PAY_FAIL_A_VIA = 'a6000000-0000-4000-8000-0000000007a1'; // FAILED payment, accountId=null, order = A's
const DISPUTE_B_VIA = 'a6000000-0000-4000-8000-0000000008b1'; // OPEN dispute on a payment whose order = B's

const PHONES = {
  owner: '+14165550001', // OWNER (Org 1)
  finance: '+14165550005', // FINANCE (Org 1)
  driver: '+14165550006', // DRIVER — org staff but not a portal consumer → 403
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER → 403
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org isolation probe
};

describe('Accounts portal reads e2e (Track-A B2B — Orders / Manifests / Exceptions)', () => {
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

    // Held-order exception fixtures (one per account, same org) — direct-accountId ORDER_HELD path.
    const orgId = (await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_B } })).orgId;
    for (const [id, accountId] of [
      [HELD_B, ACCOUNT_B],
      [HELD_A, ACCOUNT_A],
    ] as const) {
      await prisma.order.upsert({
        where: { id },
        update: { status: OrderStatus.ON_HOLD, heldFrom: OrderStatus.REQUESTED },
        create: { id, orgId, accountId, vertical: OrderVertical.SPECIALTY, type: OrderType.JOB, status: OrderStatus.ON_HOLD, heldFrom: OrderStatus.REQUESTED, totals: { currency: 'CAD' } },
      });
    }

    // FAILED stops — the order-attribution arm (accountId NULL on the stop; the account comes from the
    // linked order) + one direct-accountId stop. seq 91-93 avoid the seeded route's seqs 1-4.
    await prisma.routeStop.createMany({
      data: [
        { id: STOP_FAIL_B_VIA, orgId, routeId: A6_ROUTE, seq: 91, accountId: null, orderId: A6_ORDER1, status: RouteStopStatus.FAILED, exceptionReason: 'qc-fixture: B via order' },
        { id: STOP_FAIL_A_VIA, orgId, routeId: A6_ROUTE, seq: 92, accountId: null, orderId: ACCOUNT_A_ORDER, status: RouteStopStatus.FAILED, exceptionReason: 'qc-fixture: A via order' },
        { id: STOP_FAIL_B_DIRECT, orgId, routeId: A6_ROUTE, seq: 93, accountId: ACCOUNT_B, orderId: null, status: RouteStopStatus.FAILED, exceptionReason: 'qc-fixture: B direct' },
      ],
      skipDuplicates: true,
    });

    // FAILED payments — order-attribution arm (accountId NULL; account from the linked order).
    await prisma.payment.createMany({
      data: [
        { id: PAY_FAIL_B_VIA, orgId, accountId: null, orderId: A6_ORDER1, amount: '50.00', currency: 'CAD', status: PaymentStatus.FAILED, lastError: 'qc-fixture: B via order' },
        { id: PAY_FAIL_A_VIA, orgId, accountId: null, orderId: ACCOUNT_A_ORDER, amount: '40.00', currency: 'CAD', status: PaymentStatus.FAILED, lastError: 'qc-fixture: A via order' },
      ],
      skipDuplicates: true,
    });

    // OPEN dispute — attributed via its payment → order (payment.accountId NULL; order = B's). Reuses
    // the B payment above so the dispute's payment.order resolves to Account B.
    await prisma.dispute.upsert({
      where: { id: DISPUTE_B_VIA },
      update: { status: DisputeStatus.OPEN },
      create: { id: DISPUTE_B_VIA, orgId, paymentId: PAY_FAIL_B_VIA, stripeDisputeId: 'qc-fixture-dispute-b', amount: '50.00', currency: 'CAD', status: DisputeStatus.OPEN, reason: 'qc-fixture: B via payment order' },
    });
  }, 60000);

  afterAll(async () => {
    await prisma.dispute.deleteMany({ where: { id: { in: [DISPUTE_B_VIA] } } });
    await prisma.payment.deleteMany({ where: { id: { in: [PAY_FAIL_B_VIA, PAY_FAIL_A_VIA] } } });
    await prisma.routeStop.deleteMany({ where: { id: { in: [STOP_FAIL_B_VIA, STOP_FAIL_A_VIA, STOP_FAIL_B_DIRECT] } } });
    await prisma.order.deleteMany({ where: { id: { in: [HELD_B, HELD_A] } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /v1/accounts/:accountId/orders', () => {
    it("returns ONLY Account B's orders (every row account-scoped; includes the seeded condo orders)", async () => {
      const res = await get(`/v1/accounts/${ACCOUNT_B}/orders?limit=100`, 'owner').expect(200);
      expect(Array.isArray(res.body.orders)).toBe(true);
      expect(typeof res.body.hasMore).toBe('boolean');
      // Scope: not one returned order belongs to another account.
      expect(res.body.orders.every((o: { accountId: string }) => o.accountId === ACCOUNT_B)).toBe(true);
      const ids = res.body.orders.map((o: { id: string }) => o.id);
      expect(ids).toContain(A6_ORDER1); // a seeded DELIVERED condo order
      expect(ids).toContain(HELD_B); // the held fixture
    });

    it("Account A's orders never include Account B's (the listing is confined, not global)", async () => {
      const res = await get(`/v1/accounts/${ACCOUNT_A}/orders?limit=100`, 'owner').expect(200);
      expect(res.body.orders.every((o: { accountId: string }) => o.accountId === ACCOUNT_A)).toBe(true);
      const ids = res.body.orders.map((o: { id: string }) => o.id);
      expect(ids).not.toContain(A6_ORDER1);
      expect(ids).not.toContain(HELD_B);
    });
  });

  describe('GET /v1/accounts/:accountId/manifests', () => {
    it("returns Account B's real CONCIERGE load-sheet manifest (2 expected amenity-linen items)", async () => {
      const res = await get(`/v1/accounts/${ACCOUNT_B}/manifests`, 'owner').expect(200);
      expect(Array.isArray(res.body.manifests)).toBe(true);
      const m = res.body.manifests.find((x: { routeStopId: string }) => x.routeStopId === A6_STOP1);
      expect(m).toBeDefined();
      expect(m).toMatchObject({
        stopSeq: 1,
        stopKind: 'PICKUP',
        stopStatus: 'COMPLETED',
        orderId: A6_ORDER1,
        expectedItemCount: 2,
      });
      expect(typeof m.siteName).toBe('string');
      expect(m.siteName).toContain('Harbourview');
    });

    it("Account A has no manifests for Account B's stop (no leak)", async () => {
      const res = await get(`/v1/accounts/${ACCOUNT_A}/manifests`, 'owner').expect(200);
      expect(res.body.manifests.some((x: { routeStopId: string }) => x.routeStopId === A6_STOP1)).toBe(false);
    });
  });

  describe('GET /v1/accounts/:accountId/exceptions (account-scoped feed)', () => {
    it("Account B's feed includes B's held order and EXCLUDES A's", async () => {
      const res = await get(`/v1/accounts/${ACCOUNT_B}/exceptions`, 'owner').expect(200);
      const ids = res.body.exceptions.map((x: { id: string }) => x.id);
      expect(ids).toContain(HELD_B);
      expect(ids).not.toContain(HELD_A);
      const held = res.body.exceptions.find((x: { id: string }) => x.id === HELD_B);
      expect(held.kind).toBe('ORDER_HELD');
    });

    it("Account A's feed includes A's held order and EXCLUDES B's (isolation both ways)", async () => {
      const res = await get(`/v1/accounts/${ACCOUNT_A}/exceptions`, 'owner').expect(200);
      const ids = res.body.exceptions.map((x: { id: string }) => x.id);
      expect(ids).toContain(HELD_A);
      expect(ids).not.toContain(HELD_B);
    });

    it('attributes stops/payments/disputes via the related ORDER (the leak-prone OR-arm) — B sees B, never A', async () => {
      const res = await get(`/v1/accounts/${ACCOUNT_B}/exceptions`, 'owner').expect(200);
      const byId = new Map(res.body.exceptions.map((x: { id: string; kind: string }) => [x.id, x.kind]));
      // The order-attribution arm (stop/payment.accountId is NULL — the account comes from the order):
      expect(byId.get(STOP_FAIL_B_VIA)).toBe('STOP_FAILED');
      expect(byId.get(PAY_FAIL_B_VIA)).toBe('PAYMENT_FAILED');
      expect(byId.get(DISPUTE_B_VIA)).toBe('PAYMENT_DISPUTE'); // dispute → payment → order = B
      // The direct-accountId arm also surfaces:
      expect(byId.get(STOP_FAIL_B_DIRECT)).toBe('STOP_FAILED');
      // And NONE of Account A's order-attributed exceptions leak into B's feed:
      expect(byId.has(STOP_FAIL_A_VIA)).toBe(false);
      expect(byId.has(PAY_FAIL_A_VIA)).toBe(false);
    });

    it("the same order-attributed exceptions land in A's feed and NEVER in B's (isolation both ways)", async () => {
      const res = await get(`/v1/accounts/${ACCOUNT_A}/exceptions`, 'owner').expect(200);
      const ids: string[] = res.body.exceptions.map((x: { id: string }) => x.id);
      expect(ids).toContain(STOP_FAIL_A_VIA);
      expect(ids).toContain(PAY_FAIL_A_VIA);
      // B's order-attributed stop/payment/dispute must be absent from A's feed.
      expect(ids).not.toContain(STOP_FAIL_B_VIA);
      expect(ids).not.toContain(PAY_FAIL_B_VIA);
      expect(ids).not.toContain(DISPUTE_B_VIA);
      expect(ids).not.toContain(STOP_FAIL_B_DIRECT);
    });
  });

  describe('RBAC + org-scoping', () => {
    it('FINANCE can read all three tabs', async () => {
      await get(`/v1/accounts/${ACCOUNT_B}/orders`, 'finance').expect(200);
      await get(`/v1/accounts/${ACCOUNT_B}/manifests`, 'finance').expect(200);
      await get(`/v1/accounts/${ACCOUNT_B}/exceptions`, 'finance').expect(200);
    });

    it('a DRIVER and a residential customer are 403 on every tab', async () => {
      for (const who of ['driver', 'rita'] as const) {
        await get(`/v1/accounts/${ACCOUNT_B}/orders`, who).expect(403);
        await get(`/v1/accounts/${ACCOUNT_B}/manifests`, who).expect(403);
        await get(`/v1/accounts/${ACCOUNT_B}/exceptions`, who).expect(403);
      }
    });

    it('an Org-2 owner gets 404 (cross-org id), not a cross-tenant read, on every tab', async () => {
      await get(`/v1/accounts/${ACCOUNT_B}/orders`, 'org2owner').expect(404);
      await get(`/v1/accounts/${ACCOUNT_B}/manifests`, 'org2owner').expect(404);
      await get(`/v1/accounts/${ACCOUNT_B}/exceptions`, 'org2owner').expect(404);
    });
  });
});
