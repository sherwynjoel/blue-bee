import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Dry-clean visual catalog e2e (Increment 17). Boots the real app against the real (migrated) Postgres +
 * Redis + MinIO and proves the Definition of Done end-to-end:
 *   • Category CRUD (create / rename / reorder / deactivate) — OWNER/FINANCE only; RBAC 403; cross-org 404.
 *   • Item CRUD with a REAL image: presign a catalog image → PUT real PNG bytes to MinIO → create the item
 *     with that storageKey → the item's signed imageUrl serves the SAME bytes back. Edit + deactivate.
 *     A non-ITEM (wash&fold LB) service → 400 (catalog admin manages dry-clean ITEM only).
 *   • Per-account override (the existing Inc-15 rate-card mechanism) → the customer picker price changes:
 *     a plain resident sees the BASE price; a corporate member sees the OVERRIDE price.
 *   • The catalog item is a real bookable Service (its serviceId books through the existing order path).
 *
 * Self-contained fixture under Org-1 (name-prefixed `CAT E2E`), created via the API + torn down here.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
const LB_SERVICE = 'c0000000-0000-4000-8000-000000000002'; // seeded wash&fold (unit LB) — the non-ITEM probe
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';

const PHONES = {
  owner: '+14165550001',
  finance: '+14165550005',
  dispatcher: '+14165550002',
  driver: '+14165550006',
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER (Account A) — base-price + RBAC-403 probe
  priya: '+14165550110', // RESIDENTIAL_CUSTOMER (residential-specialty seed) — the corporate member
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org isolation
};

async function tearDown(prisma: PrismaClient): Promise<void> {
  // Corp accounts cascade their rate-card PriceLists + memberships; then remove the catalog items, their
  // category, and the seeded-here media rows. Order: accounts → item services → category → media uploads.
  await prisma.account.deleteMany({ where: { orgId: ORG1, name: { startsWith: 'CAT E2E — ' } } });
  await prisma.service.deleteMany({ where: { orgId: ORG1, name: { startsWith: 'CAT E2E ' } } });
  await prisma.serviceCategory.deleteMany({ where: { orgId: ORG1, name: { startsWith: 'CAT E2E ' } } });
}

describe('Dry-clean visual catalog e2e (Increment 17)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  let categoryId = '';
  let itemId = '';
  let corpId = '';
  let joinCode = '';
  let imageUrl = '';

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const patch = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const put = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

  /** PUT real bytes to a presigned URL (the client upload — global fetch, not supertest). */
  async function putBytes(url: string, bytes: Buffer, contentType: string): Promise<number> {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes) });
    return res.status;
  }

  /** Find an item in a dryclean catalog response (flattened across categories). */
  const itemInCatalog = (body: { categories: Array<{ items: Array<{ id: string; name: string; price: string; priceSource: string; imageUrl: string | null }> }> }, id: string) =>
    body.categories.flatMap((c) => c.items).find((i) => i.id === id);

  beforeAll(async () => {
    const live = await fetch('http://localhost:9000/minio/health/live').then((r) => r.status).catch(() => 0);
    if (live !== 200) throw new Error('MinIO not reachable at http://localhost:9000 — run `npm run infra:up` (the catalog image e2e needs it).');
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    const residentUserIds: string[] = [];
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
      if (name === 'rita' || name === 'priya') residentUserIds.push(user.id);
    }
    await tearDown(prisma);
    // Clear any membership the base/member residents carry from other e2es/proofs, so this suite owns the
    // pricing state: rita = a plain resident (no corporate pricing), priya = the member it redeems below.
    await prisma.corporateMembership.deleteMany({ where: { userId: { in: residentUserIds } } });
  }, 60000);

  afterAll(async () => {
    await tearDown(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  // ─────────────────────────── category CRUD + RBAC ───────────────────────────

  describe('category management', () => {
    it('FINANCE creates a category (audited); dispatcher/driver/member cannot (403)', async () => {
      const res = await post('/v1/catalog/categories', 'finance', { name: 'CAT E2E Shirts', sortOrder: 1 }).expect(201);
      expect(res.body).toMatchObject({ name: 'CAT E2E Shirts', sortOrder: 1, active: true, itemCount: 0 });
      categoryId = res.body.id;
      expect(await prisma.auditLog.findFirst({ where: { entity: 'ServiceCategory', entityId: categoryId, action: 'CATALOG_CATEGORY_CREATED' } })).not.toBeNull();

      await post('/v1/catalog/categories', 'dispatcher', { name: 'CAT E2E nope' }).expect(403);
      await post('/v1/catalog/categories', 'driver', { name: 'CAT E2E nope' }).expect(403);
      await post('/v1/catalog/categories', 'rita', { name: 'CAT E2E nope' }).expect(403);
    });

    it('FINANCE renames + reorders a category; a cross-org owner cannot see or patch it', async () => {
      const res = await patch(`/v1/catalog/categories/${categoryId}`, 'finance', { name: 'CAT E2E Shirts & Tops', sortOrder: 2 }).expect(200);
      expect(res.body).toMatchObject({ id: categoryId, name: 'CAT E2E Shirts & Tops', sortOrder: 2 });
      await patch(`/v1/catalog/categories/${categoryId}`, 'org2owner', { name: 'x' }).expect(404);
      const list = await get('/v1/catalog/categories', 'org2owner').expect(200);
      expect(list.body.categories.find((c: { id: string }) => c.id === categoryId)).toBeUndefined();
    });
  });

  // ─────────────────────────── item CRUD + real image upload ───────────────────────────

  describe('catalog item management (with a real MinIO image)', () => {
    it('presign → PUT real PNG bytes to MinIO → create the item; its signed imageUrl serves the SAME bytes', async () => {
      const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(200).fill(7)]); // PNG signature + real bytes
      const pre = (await post('/v1/catalog/image/presign', 'finance', { contentType: 'image/png', byteSize: bytes.length }).expect(201)).body;
      expect(pre.storageKey).toMatch(/^org\/[0-9a-f-]+\/catalog\/[0-9a-f-]+\.png$/);
      expect(pre.uploadUrl).toContain('X-Amz-Signature');
      expect(await putBytes(pre.uploadUrl, bytes, 'image/png')).toBe(200);

      const item = (await post('/v1/catalog/items', 'finance', { name: 'CAT E2E dress shirt', price: 6, categoryId, imageKey: pre.storageKey }).expect(201)).body;
      itemId = item.id; // capture first so a later assertion can't cascade into the rest of the suite
      imageUrl = item.imageUrl;
      expect(item).toMatchObject({ name: 'CAT E2E dress shirt', unit: 'ITEM', baseRate: '6.0000', categoryId });
      expect(item.imageUrl).toContain('X-Amz-Signature');

      const dl = await fetch(imageUrl);
      expect(dl.status).toBe(200);
      const got = Buffer.from(await dl.arrayBuffer());
      expect(got.equals(bytes)).toBe(true); // byte-for-byte the image we uploaded

      const intent = await prisma.mediaUpload.findUniqueOrThrow({ where: { storageKey: pre.storageKey } });
      expect(intent.status).toBe('CONFIRMED');
      expect(intent.kind).toBe('CATALOG');
    });

    it('creating an item with an UNVERIFIED image key is rejected (404) and the item is never persisted', async () => {
      const pre = (await post('/v1/catalog/image/presign', 'finance', { contentType: 'image/png', byteSize: 100 }).expect(201)).body;
      await post('/v1/catalog/items', 'finance', { name: 'CAT E2E ghost', price: 5, imageKey: pre.storageKey }).expect(404);
      expect(await prisma.service.findFirst({ where: { name: 'CAT E2E ghost' } })).toBeNull();
    });

    it('edits the item; a non-ITEM (wash&fold LB) service → 400; a member cannot edit (403)', async () => {
      const edited = (await patch(`/v1/catalog/items/${itemId}`, 'finance', { price: 7, sortOrder: 3 }).expect(200)).body;
      expect(edited.baseRate).toBe('7.0000');
      await patch(`/v1/catalog/items/${itemId}`, 'finance', { price: 6 }).expect(200); // reset to $6 for the picker tests

      const bad = await patch(`/v1/catalog/items/${LB_SERVICE}`, 'finance', { price: 3 }).expect(400);
      expect(bad.body.error ?? bad.body.title).toContain('not_a_catalog_item');
      await patch(`/v1/catalog/items/${itemId}`, 'rita', { price: 1 }).expect(403);
    });
  });

  // ─────────────────────────── customer picker: base vs corporate override ───────────────────────────

  describe('customer visual picker — base vs per-account override', () => {
    it('a plain resident sees the catalog grouped, with the BASE price + the photo', async () => {
      const res = await get('/v1/catalog/dryclean', 'rita').expect(200);
      expect(res.body.categories.find((c: { id: string }) => c.id === categoryId)).toBeTruthy();
      const it = itemInCatalog(res.body, itemId);
      expect(it).toMatchObject({ name: 'CAT E2E dress shirt', price: '6.00', priceSource: 'service_base' });
      expect(it!.imageUrl).toContain('X-Amz-Signature');
      expect(res.body.pricingAccountName).toBeNull();
    });

    it('a corporate member (override via the existing rate-card editor) sees the OVERRIDE price; a resident still sees BASE', async () => {
      corpId = (await post('/v1/corporate/accounts', 'finance', { name: 'CAT E2E — Corp' }).expect(201)).body.id;
      const rc = await put(`/v1/corporate/accounts/${corpId}/rate-card/items/${itemId}`, 'finance', { rate: 4 }).expect(200);
      expect(rc.body).toMatchObject({ serviceId: itemId, effectiveRate: '4.0000', source: 'account_list' });
      joinCode = (await post(`/v1/corporate/accounts/${corpId}/join-code`, 'finance', {}).expect(201)).body.joinCode;

      await post('/v1/corporate/redeem', 'priya', { code: joinCode }).expect(200);
      const res = await get('/v1/catalog/dryclean', 'priya').expect(200);
      expect(itemInCatalog(res.body, itemId)).toMatchObject({ id: itemId, price: '4.00', priceSource: 'account_list' }); // $4 override, NOT $6 base
      expect(res.body.pricingAccountName).toBe('CAT E2E — Corp');

      const ritaRes = await get('/v1/catalog/dryclean', 'rita').expect(200);
      expect(itemInCatalog(ritaRes.body, itemId)).toMatchObject({ price: '6.00' }); // the override never leaks to a non-member
    });

    it('a deactivated item drops out of the customer picker', async () => {
      await patch(`/v1/catalog/items/${itemId}`, 'finance', { active: false }).expect(200);
      expect(itemInCatalog((await get('/v1/catalog/dryclean', 'rita').expect(200)).body, itemId)).toBeUndefined();
      await patch(`/v1/catalog/items/${itemId}`, 'finance', { active: true }).expect(200); // restore
    });
  });

  // ─────────────────────────── the catalog item is a real bookable Service ───────────────────────────

  describe('the item flows through the real order path', () => {
    it('a resident books an order with the catalog item serviceId (a real ITEM line item, base rate)', async () => {
      const order = (await post('/v1/orders', 'rita', {
        accountId: ACCOUNT_A,
        items: [{ kind: 'GARMENT', serviceId: itemId, estimatedMeasure: 2 }],
      }).expect(201)).body;
      expect(order.status).toBe('REQUESTED');
      const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: order.id, serviceId: itemId } });
      expect(Number(line.rate)).toBe(6); // base rate for a plain resident
      // Clean up this booked order so the item Service tears down without a lingering FK.
      await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
      await prisma.item.deleteMany({ where: { orderId: order.id } });
      await prisma.order.deleteMany({ where: { id: order.id } });
    });
  });
});
