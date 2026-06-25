import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../src/media/storage/storage-provider';

const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';

const PHONES = {
  owner: '+14165550001', // OWNER, Org 1
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
  acctBAdmin: '+14165550020', // ACCOUNT_ADMIN, Account B (same org, different account)
  org2owner: '+14165559001', // OWNER, Org 2
};

/**
 * Increment 10 — the REAL presigned media path, proven end-to-end against the local MinIO (a real
 * S3-compatible server, same AWS SDK path as prod). presign → PUT real bytes → confirm (HEAD-verify)
 * → Photo with a key → signed GET → bytes match. Plus the security matrix.
 */
describe('Media storage e2e — Increment 10 (presign → PUT → confirm → signed read, real MinIO)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  let storage: StorageProvider;

  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const futureWindow = () => ({ start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() });

  /** Book a fresh Account-A order and return {orderId, itemId}. */
  async function freshOrderItem(): Promise<{ orderId: string; itemId: string }> {
    const order = (
      await post('/v1/orders', 'owner', { accountId: ACCOUNT_A, pickupWindow: futureWindow(), items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }] }).expect(201)
    ).body;
    return { orderId: order.id, itemId: order.items[0].id };
  }

  /** PUT real bytes to a presigned URL (the client upload — global fetch, not supertest). */
  async function putBytes(url: string, bytes: Buffer, contentType: string): Promise<number> {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes) });
    return res.status;
  }

  beforeAll(async () => {
    // Fail fast with a clear message if the MinIO container isn't up (the real-storage proof needs it).
    const live = await fetch('http://localhost:9000/minio/health/live').then((r) => r.status).catch(() => 0);
    if (live !== 200) throw new Error('MinIO not reachable at http://localhost:9000 — run `npm run infra:up` (the media e2e proves the REAL S3 path).');

    app = await createTestApp();
    storage = app.get<StorageProvider>(STORAGE_PROVIDER);
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

  // ───────────── the real round-trip (the proof) ─────────────

  it('presign → PUT real bytes to MinIO → confirm → signed GET returns the SAME bytes', async () => {
    const { orderId, itemId } = await freshOrderItem();
    const bytes = Buffer.from('blue-bee-photo-' + 'x'.repeat(300)); // ~315 real bytes

    const pre = (await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: bytes.length }).expect(200)).body;
    expect(pre.storageKey).toMatch(/^org\/[0-9a-f-]+\/before\/[0-9a-f-]+\.jpg$/); // org-namespaced, unguessable
    expect(pre.uploadUrl).toContain('X-Amz-Signature'); // a real signed URL

    expect(await putBytes(pre.uploadUrl, bytes, 'image/jpeg')).toBe(200); // real upload to MinIO

    const photo = (await post('/v1/media/confirm', 'owner', { storageKey: pre.storageKey }).expect(201)).body;
    expect(photo.storageKey).toBe(pre.storageKey);
    expect(photo.contentType).toBe('image/jpeg');
    expect(photo.sizeBytes).toBe(bytes.length);
    expect(photo.downloadUrl).toContain('X-Amz-Signature'); // signed, expiring GET (§14)
    expect(photo.downloadUrl).toContain('X-Amz-Expires');

    // fetch the object back through the signed URL — the bytes must match exactly.
    const dl = await fetch(photo.downloadUrl);
    expect(dl.status).toBe(200);
    const got = Buffer.from(await dl.arrayBuffer());
    expect(got.equals(bytes)).toBe(true);

    // the intent is now CONFIRMED + linked to the photo (orphan-reconciliation invariant).
    const intent = await prisma.mediaUpload.findUniqueOrThrow({ where: { storageKey: pre.storageKey } });
    expect(intent.status).toBe('CONFIRMED');
    expect(intent.photoId).toBe(photo.id);
  });

  it('an oversize upload is rejected at the S3 edge (signed Content-Length) — no object lands', async () => {
    const { orderId, itemId } = await freshOrderItem();
    const pre = (await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: 50 }).expect(200)).body;
    // PUT MORE bytes than the signed Content-Length (50) → S3/MinIO rejects (signature/length mismatch)
    const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(Buffer.from('x'.repeat(5000))) });
    expect(put.status).toBeGreaterThanOrEqual(400); // rejected at the edge
    // and since nothing landed, confirm finds no object
    await post('/v1/media/confirm', 'owner', { storageKey: pre.storageKey }).expect(404);
  });

  it('confirm is idempotent — re-confirming the same key returns the same Photo (no duplicate)', async () => {
    const { orderId, itemId } = await freshOrderItem();
    const bytes = Buffer.from('idempotent-bytes');
    const pre = (await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'AFTER', contentType: 'image/png', byteSize: bytes.length }).expect(200)).body;
    await putBytes(pre.uploadUrl, bytes, 'image/png');
    const first = (await post('/v1/media/confirm', 'owner', { storageKey: pre.storageKey }).expect(201)).body;
    const second = (await post('/v1/media/confirm', 'owner', { storageKey: pre.storageKey }).expect(201)).body;
    expect(second.id).toBe(first.id);
    const count = await prisma.photo.count({ where: { storageKey: pre.storageKey } });
    expect(count).toBe(1);
  });

  it('CONCURRENT double-confirm is idempotent (no 500, exactly one Photo)', async () => {
    const { orderId, itemId } = await freshOrderItem();
    const bytes = Buffer.from('concurrent-confirm-bytes');
    const pre = (await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: bytes.length }).expect(200)).body;
    await putBytes(pre.uploadUrl, bytes, 'image/jpeg');
    // fire two confirms simultaneously — the unique storage_key + P2002 handling must collapse them
    const [a, b] = await Promise.all([
      post('/v1/media/confirm', 'owner', { storageKey: pre.storageKey }),
      post('/v1/media/confirm', 'owner', { storageKey: pre.storageKey }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id); // same Photo, no 500
    expect(await prisma.photo.count({ where: { storageKey: pre.storageKey } })).toBe(1);
  });

  it('the order read returns a signed downloadUrl per photo — never the raw key', async () => {
    const { orderId, itemId } = await freshOrderItem();
    const bytes = Buffer.from('order-read-photo');
    const pre = (await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'BEFORE', contentType: 'image/webp', byteSize: bytes.length }).expect(200)).body;
    await putBytes(pre.uploadUrl, bytes, 'image/webp');
    await post('/v1/media/confirm', 'owner', { storageKey: pre.storageKey }).expect(201);

    const order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    const photo = order.items[0].photos[0];
    expect(photo.downloadUrl).toContain('X-Amz-Signature');
    expect(photo.storageKey).toBeUndefined(); // raw key never leaked to the client
    expect(photo.url).toBeUndefined();
  });

  // ───────────── upload security ─────────────

  it('rejects a non-allow-listed content type (400) and an over-max size (400)', async () => {
    const { orderId, itemId } = await freshOrderItem();
    const bad = await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'BEFORE', contentType: 'application/zip', byteSize: 10 }).expect(400);
    expect(bad.body.title).toBe('media.unsupported_content_type');
    const big = await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: 6 * 1024 * 1024 }).expect(400);
    expect(big.body.title).toBe('media.too_large');
  });

  it('cannot presign for another account (403) or another org (404)', async () => {
    const { orderId, itemId } = await freshOrderItem(); // Account A, Org 1
    const body = { orderId, itemId, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: 100 };
    const xAcct = await post('/v1/media/presign', 'acctBAdmin', body).expect(403);
    expect(xAcct.body.title).toBe('cross_account_forbidden');
    await post('/v1/media/presign', 'org2owner', body).expect(404); // cross-org → not found
  });

  // ───────────── confirm integrity ─────────────

  it('confirm rejects a key the caller never presigned (404)', async () => {
    const forged = `org/${(await prisma.user.findFirstOrThrow({ where: { phone: PHONES.owner } })).orgId}/before/${'0'.repeat(8)}-forged.jpg`;
    const res = await post('/v1/media/confirm', 'owner', { storageKey: forged }).expect(404);
    expect(res.body.title).toBe('media.upload_not_found');
  });

  it('confirm rejects when the object was never uploaded (404 object_not_found)', async () => {
    const { orderId, itemId } = await freshOrderItem();
    const pre = (await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: 100 }).expect(200)).body;
    // deliberately DO NOT PUT any bytes
    const res = await post('/v1/media/confirm', 'owner', { storageKey: pre.storageKey }).expect(404);
    expect(res.body.title).toBe('media.object_not_found');
  });

  it("cannot confirm another org's presigned key (404)", async () => {
    const { orderId, itemId } = await freshOrderItem(); // owner / Org 1
    const bytes = Buffer.from('cross-org-confirm');
    const pre = (await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: bytes.length }).expect(200)).body;
    await putBytes(pre.uploadUrl, bytes, 'image/jpeg');
    // org2owner tries to confirm Org-1's key → no intent in their org → 404
    await post('/v1/media/confirm', 'org2owner', { storageKey: pre.storageKey }).expect(404);
  });

  // ───────────── read security (signed URLs expire) ─────────────

  it('a presigned GET URL is short-lived and expires (real S3 expiry)', async () => {
    const { orderId, itemId } = await freshOrderItem();
    const bytes = Buffer.from('expiring-bytes');
    const pre = (await post('/v1/media/presign', 'owner', { orderId, itemId, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: bytes.length }).expect(200)).body;
    await putBytes(pre.uploadUrl, bytes, 'image/jpeg');
    await post('/v1/media/confirm', 'owner', { storageKey: pre.storageKey }).expect(201);

    // mint a 1-second GET URL directly and let it expire
    const shortUrl = await storage.presignGet(pre.storageKey, 1);
    expect((await fetch(shortUrl)).status).toBe(200); // valid now
    await new Promise((r) => setTimeout(r, 2200));
    expect((await fetch(shortUrl)).status).toBe(403); // expired → S3/MinIO rejects
  }, 15000);
});
