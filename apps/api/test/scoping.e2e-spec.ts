import { RoleScope, RoleType } from '@blue-bee/shared';
import { PrismaClient } from '@prisma/client';
import { scopedPrisma } from '../src/prisma/scoped-prisma';
import type { RequestPrincipal } from '../src/auth/rbac/types';

// Seeded ids (must match prisma/seed.ts).
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const ORDER_A = '77777777-7777-4777-8777-777777777777';
const ORDER_B = 'e0000000-0000-4000-8000-0000000000b1';
const ORDER_O2 = 'e0000000-0000-4000-8000-0000000000c1';

const rita: RequestPrincipal = {
  userId: 'e1000000-0000-4000-8000-000000000006',
  orgId: ORG1,
  roles: [{ role: RoleType.RESIDENTIAL_CUSTOMER, scope: RoleScope.ACCOUNT, scopeId: ACCOUNT_A }],
  accountIds: [ACCOUNT_A],
  siteIds: [],
  jti: 'test',
  accessExp: 0,
};

const owner1: RequestPrincipal = {
  userId: '22222222-2222-4222-8222-222222222222',
  orgId: ORG1,
  roles: [{ role: RoleType.OWNER, scope: RoleScope.ORG, scopeId: null }],
  accountIds: [],
  siteIds: [],
  jti: 'test',
  accessExp: 0,
};

describe('Row-scoping via the scoped Prisma layer (PRD §8.1, §17.3)', () => {
  const prisma = new PrismaClient();
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── DoD #5 (horizontal) — account confinement ──
  it('RESIDENTIAL_CUSTOMER (Account A) sees only their account’s orders', async () => {
    const db = scopedPrisma(prisma, rita);
    const orders = await db.order.findMany({ select: { id: true } });
    const ids = orders.map((o) => o.id);
    expect(ids).toContain(ORDER_A);
    expect(ids).not.toContain(ORDER_B);
  });

  it('RESIDENTIAL_CUSTOMER cannot fetch Account B’s order by id (returns null), though it exists for B', async () => {
    const scoped = await scopedPrisma(prisma, rita).order.findUnique({ where: { id: ORDER_B } });
    expect(scoped).toBeNull();
    // ...but the row genuinely exists (unscoped base client finds it).
    const unscoped = await prisma.order.findUnique({ where: { id: ORDER_B } });
    expect(unscoped?.id).toBe(ORDER_B);
  });

  // ── DoD #5 (vertical org isolation) — org-wide staff still can't cross orgs ──
  it('Org-1 OWNER sees Org-1 orders (A + B) but not Org-2’s order', async () => {
    const db = scopedPrisma(prisma, owner1);
    const ids = (await db.order.findMany({ select: { id: true } })).map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([ORDER_A, ORDER_B]));
    expect(ids).not.toContain(ORDER_O2);
  });

  it('Org-1 OWNER cannot fetch an Org-2 order by id (returns null)', async () => {
    const scoped = await scopedPrisma(prisma, owner1).order.findUnique({ where: { id: ORDER_O2 } });
    expect(scoped).toBeNull();
    const unscoped = await prisma.order.findUnique({ where: { id: ORDER_O2 } });
    expect(unscoped?.id).toBe(ORDER_O2);
  });
});
