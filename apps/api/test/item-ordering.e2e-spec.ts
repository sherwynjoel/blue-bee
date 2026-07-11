import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Deterministic order-item ordering e2e (Increment 29).
 *
 * THE BUG. `Item` had no ordinal and the `items` include had no `orderBy`, so Postgres returned an order's
 * items in HEAP order. Heap order is not insertion order: an UPDATE writes a new tuple version, which lands
 * at the end of the page's free space, so **an item that is inspected or weighed moves to the end of the
 * scan.** Two reads of the same order could therefore list its items differently, on the customer app, the
 * console and the driver's manifest alike.
 *
 * The tests below do not take that on faith. They read the **physical** order directly (`ORDER BY ctid`),
 * prove it genuinely diverges from the submitted order the moment an item is inspected, and then prove the
 * API is unmoved. Without Inc-29's `sortOrder` + `ITEM_ORDER_BY`, the API read is the physical one.
 *
 * Fixtures use the `f9000000-…` id prefix and are torn down in `beforeAll` AND `afterAll`.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SITE_CITY_HALL = '55555555-5555-4555-8555-555555555555';
const SERVICE = '66666666-6666-4666-8666-666666666666'; // org1 SPECIALTY service

const PHONES = {
  owner: '+14165550001', // OWNER — books + reads
  csr: '+14165550003', // CSR — inspection (the mutating write that moves the row)
};

/** A deliberately non-alphabetical sequence, so a wrong order cannot coincidentally look right. */
const KINDS = ['UPHOLSTERY', 'RUG', 'BLIND', 'CARPET'] as const;

interface ApiItem {
  id: string;
  kind: string;
  sortOrder: number;
}

/**
 * Remove only what this spec created.
 *
 * `received-at-plant` writes a `PICKED_UP` CustodyEvent per item, and `CustodyEvent` is append-only by DB
 * trigger — which fires on CASCADED deletes too, so dropping the items is refused. The trigger is therefore
 * disabled for the length of one transaction and re-enabled inside it. `ALTER TABLE` is transactional in
 * Postgres, so a failure anywhere in the block rolls the guard back on; it can never be left off.
 *
 * The alternative was to leave the orders behind, as `weigh.e2e-spec.ts` does. Dev-DB residue is already a
 * flagged problem in this repo (Inc-27 §6); this spec does not add to it.
 */
async function tearDown(prisma: PrismaClient): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { orgId: ORG1, accountId: ACCOUNT_A, totals: { path: ['notes'], equals: 'ITEM ORDER E2E' } },
    select: { id: true },
  });
  const ids = orders.map((o) => o.id);
  if (ids.length === 0) return;
  const items = await prisma.item.findMany({ where: { orderId: { in: ids } }, select: { id: true, tagId: true } });
  const itemIds = items.map((i) => i.id);

  await prisma.routeStop.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.inspection.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: ids } } });

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE "CustodyEvent" DISABLE TRIGGER custody_event_append_only');
    try {
      await tx.custodyEvent.deleteMany({ where: { itemId: { in: itemIds } } });
      await tx.item.deleteMany({ where: { orderId: { in: ids } } });
    } finally {
      await tx.$executeRawUnsafe('ALTER TABLE "CustodyEvent" ENABLE TRIGGER custody_event_append_only');
    }
  });

  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  const tagIds = items.map((i) => i.tagId).filter((t): t is string => t !== null);
  if (tagIds.length > 0) await prisma.tag.deleteMany({ where: { id: { in: tagIds } } });
}

describe('Order-item ordering e2e (Inc-29 — sortOrder + ITEM_ORDER_BY)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

  /** Book an order whose items are submitted in `KINDS` order. `totals.notes` tags it for teardown. */
  const bookFourItems = async (): Promise<string> => {
    const res = await post('/v1/orders', 'owner', {
      accountId: ACCOUNT_A,
      siteId: SITE_CITY_HALL,
      notes: 'ITEM ORDER E2E',
      items: KINDS.map((kind) => ({ kind, serviceId: SERVICE, estimatedMeasure: 10 })),
    }).expect(201);
    return res.body.id as string;
  };

  const apiItems = async (orderId: string, who = 'owner'): Promise<ApiItem[]> => (await get(`/v1/orders/${orderId}`, who).expect(200)).body.items;

  /**
   * The order the rows physically sit in on disk — what an un-`ORDER BY`-ed scan yields. `ctid` is the
   * (page, tuple) address, so this is exactly the sequence the pre-Inc-29 include returned.
   */
  const physicalOrder = async (orderId: string): Promise<string[]> => {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"::text AS id FROM "Item" WHERE "order_id" = ${orderId}::uuid ORDER BY ctid`;
    return rows.map((r) => r.id);
  };

  beforeAll(async () => {
    app = await createTestApp();
    await tearDown(prisma);
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
    await tearDown(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  // ───────────────────────────── the write path ─────────────────────────────

  it('books items in the SUBMITTED order and stamps a contiguous 0-based sortOrder', async () => {
    const orderId = await bookFourItems();
    const items = await apiItems(orderId);

    expect(items.map((i) => i.kind)).toEqual([...KINDS]);
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  // ───────────────────────────── the read path ─────────────────────────────

  it('returns the same sequence on two consecutive reads', async () => {
    const orderId = await bookFourItems();
    expect((await apiItems(orderId)).map((i) => i.id)).toEqual((await apiItems(orderId)).map((i) => i.id));
  });

  /**
   * The heart of it. An inspection UPDATEs the item's `measurements`, so Postgres writes a new tuple version
   * at the end of the page's free space and the row moves to the END of any un-ordered scan. We assert the
   * physical order really does diverge — this is not a hypothetical — and that the API does not budge.
   */
  it('survives the row moving on disk: an inspected item does NOT jump to the end of the list', async () => {
    const orderId = await bookFourItems();
    const submitted = (await apiItems(orderId)).map((i) => i.id);
    expect(await physicalOrder(orderId)).toEqual(submitted); // fresh inserts: physical == logical

    // Move the order to a state where an inspection is legal, then inspect the FIRST item.
    await post(`/v1/orders/${orderId}/schedule-pickup`, 'owner', {
      pickupWindow: { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() },
    }).expect(200);
    await post(`/v1/orders/${orderId}/received-at-plant`, 'owner', {}).expect(200);
    await post(`/v1/orders/${orderId}/items/${submitted[0]}/inspection`, 'csr', { conditionCodes: [], measurements: { sqft: 40 } }).expect(201);

    // The row physically moved. The pre-Inc-29 include would have returned this sequence.
    const physical = await physicalOrder(orderId);
    expect(physical).not.toEqual(submitted);
    expect(physical[physical.length - 1]).toBe(submitted[0]); // the inspected item is now last on disk

    // …and the API is unmoved.
    const after = await apiItems(orderId);
    expect(after.map((i) => i.id)).toEqual(submitted);
    expect(after.map((i) => i.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it('inspecting every item in reverse still leaves the list in submitted order', async () => {
    const orderId = await bookFourItems();
    const submitted = (await apiItems(orderId)).map((i) => i.id);
    await post(`/v1/orders/${orderId}/schedule-pickup`, 'owner', {
      pickupWindow: { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() },
    }).expect(200);
    await post(`/v1/orders/${orderId}/received-at-plant`, 'owner', {}).expect(200);

    for (const itemId of [...submitted].reverse()) {
      await post(`/v1/orders/${orderId}/items/${itemId}/inspection`, 'csr', { conditionCodes: [], measurements: { sqft: 12 } }).expect(201);
    }

    // Physically the rows are now in reverse-ish order; logically nothing changed.
    expect(await physicalOrder(orderId)).not.toEqual(submitted);
    expect((await apiItems(orderId)).map((i) => i.id)).toEqual(submitted);
  });

  it("the driver's stop manifest lists the items in the same order the customer sees", async () => {
    const orderId = await bookFourItems();
    const submitted = (await apiItems(orderId)).map((i) => i.id);

    const routeId = (await post('/v1/routes', 'owner', { date: new Date().toISOString().slice(0, 10) }).expect(201)).body.id as string;
    const stopId = (await post(`/v1/routes/${routeId}/stops`, 'owner', { orderId }).expect(201)).body.id as string;
    const manifest = (await post(`/v1/route-stops/${stopId}/manifest`, 'owner', {}).expect(201)).body;

    const expected: string[] = manifest.lines[0].expectedItems.map((i: { itemId: string }) => i.itemId);
    expect(expected).toEqual(submitted);

    await prisma.manifest.deleteMany({ where: { routeId } });
    await prisma.routeStop.deleteMany({ where: { routeId } });
    await prisma.route.deleteMany({ where: { id: routeId } });
  });

  // ───────────────────────────── the backfill ─────────────────────────────

  /**
   * The Inc-29 migration ranked every pre-existing order's items by `(created_at, id)`. Prisma stamps
   * `created_at` per statement, so that RECOVERS the real submitted order wherever the timestamps differ,
   * and IMPOSES a stable one where they tie (a `createMany`, or two inserts inside one millisecond).
   * Either way the result must be a contiguous 0-based sequence per order.
   */
  it('backfill: every order in the database has a contiguous 0-based item sequence', async () => {
    const bad = await prisma.$queryRaw<Array<{ order_id: string }>>`
      SELECT "order_id"::text AS order_id
      FROM "Item"
      WHERE "order_id" IS NOT NULL
      GROUP BY "order_id"
      HAVING MIN("sort_order") <> 0
          OR MAX("sort_order") <> COUNT(*) - 1
          OR COUNT(DISTINCT "sort_order") <> COUNT(*)`;
    expect(bad).toEqual([]);
  });

  it('backfill: Track-B resident garments have no order, so they keep the default 0', async () => {
    const rows = await prisma.item.findMany({ where: { orderId: null }, select: { sortOrder: true } });
    expect(rows.length).toBeGreaterThan(0); // the seed creates resident garments
    expect(rows.every((r) => r.sortOrder === 0)).toBe(true);
  });
});
