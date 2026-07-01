/**
 * Inc — S3 media go-live PROOF (Increment "make-it-real"). Boots the REAL app against the REAL AWS S3
 * bucket `bluebee-media-prod` (ca-central-1) and drives the actual media pipeline end-to-end for EVERY
 * consumer — generic order/item photos, driver POD, and the Inc-17 catalog image — asserting the bytes are
 * byte-identical through presign → PUT → confirm(HEAD-verify) → signed GET, PLUS the security matrix
 * (private bucket 403, cross-org, unconfirmed, signed-URL expiry).
 *
 * NO STUB, NO MinIO: the storage config is overridden to REAL S3 (endpoint:null ⇒ virtual-hosted AWS
 * addressing; credentials:null ⇒ the AWS SDK default chain reads ~/.aws — no key in code or env). Uses the
 * app's OWN S3StorageProvider + MediaService — the exact prod code path. Local Postgres + Redis back the DB;
 * the object bytes go to and from the real bucket over HTTPS. Run: `npm run s3-proof` (from apps/api).
 * Cleans up every object it creates; exits non-zero on ANY failed check.
 */
import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { execSync } from 'node:child_process';
import { AppModule } from '../src/app.module';
import { ProblemJsonFilter } from '../src/common/problem-json.filter';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MEDIA_CONFIG, type MediaConfig } from '../src/config/media.config';
import { STORAGE_PROVIDER, type StorageProvider } from '../src/media/storage/storage-provider';
import { MediaService } from '../src/media/media.service';
import type { RequestPrincipal } from '../src/auth/rbac/types';

const BUCKET = 'bluebee-media-prod';
const REGION = 'ca-central-1';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';

// REAL S3 config — endpoint null (virtual-hosted AWS), credentials null (SDK default chain ⇒ ~/.aws). This is
// exactly what production runs with the Railway env vars; MinIO is NOT involved anywhere in this proof.
const realS3: MediaConfig = {
  region: REGION,
  bucket: BUCKET,
  endpoint: null,
  forcePathStyle: false,
  accessKeyId: null,
  secretAccessKey: null,
  presignPutTtlSec: 300,
  presignGetTtlSec: 300,
  maxBytes: 15 * 1024 * 1024,
  allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  ensureBucket: false,
  sse: null,
  legacyAllowedOrigins: [],
};

// A genuine 1×1 PNG (real image bytes) for the catalog proof.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const createdKeys: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}
async function putBytes(url: string, bytes: Buffer, ct: string): Promise<number> {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': ct }, body: new Uint8Array(bytes) });
  return r.status;
}

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MEDIA_CONFIG)
    .useValue(realS3)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemJsonFilter());
  await app.init();

  const prisma = app.get(PrismaService);
  const tokens = app.get(TokenService);
  const principals = app.get(PrincipalService);
  const storage = app.get<StorageProvider>(STORAGE_PROVIDER);
  const media = app.get(MediaService);
  const cfg = app.get<MediaConfig>(MEDIA_CONFIG);

  check('provider targets REAL AWS S3 (no MinIO endpoint)', cfg.endpoint === null && cfg.bucket === BUCKET, `bucket=${cfg.bucket} region=${cfg.region} endpoint=${cfg.endpoint ?? 'aws-s3'}`);

  const mkToken = async (phone: string): Promise<string> => {
    const u = await prisma.user.findFirstOrThrow({ where: { phone } });
    const roles = await principals.loadGrants(u.id);
    const scope = await principals.deriveScope(roles);
    return tokens.signAccess(u, roles, scope);
  };
  const mkPrincipal = async (phone: string): Promise<RequestPrincipal> => {
    const u = await prisma.user.findFirstOrThrow({ where: { phone } });
    const roles = await principals.loadGrants(u.id);
    const scope = await principals.deriveScope(roles);
    return { userId: u.id, orgId: u.orgId, roles, accountIds: scope.accountIds, siteIds: scope.siteIds, jti: 's3-proof', accessExp: Math.floor(Date.now() / 1000) + 3600 };
  };

  const ownerTok = await mkToken('+14165550001');
  const financeTok = await mkToken('+14165550005');
  const org2Tok = await mkToken('+14165559001');
  const post = (p: string, tok: string, b: unknown = {}) => request(app.getHttpServer()).post(p).set('Authorization', `Bearer ${tok}`).send(b as object);
  const get = (p: string, tok: string) => request(app.getHttpServer()).get(p).set('Authorization', `Bearer ${tok}`);
  const win = () => ({ start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() });

  // ─────────── 1. GENERIC media (order/item photo) ───────────
  {
    const order = (await post('/v1/orders', ownerTok, { accountId: ACCOUNT_A, pickupWindow: win(), items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }] }).expect(201)).body;
    const bytes = Buffer.from(`S3-GOLIVE generic ${'g'.repeat(500)}`);
    const pre = (await post('/v1/media/presign', ownerTok, { orderId: order.id, itemId: order.items[0].id, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: bytes.length }).expect(200)).body;
    createdKeys.push(pre.storageKey);
    check('generic: presigned PUT is a real signed AWS URL', pre.uploadUrl.includes('X-Amz-Signature') && pre.uploadUrl.includes(`${BUCKET}.s3`), new URL(pre.uploadUrl).host);
    check('generic: PUT real bytes to REAL S3', (await putBytes(pre.uploadUrl, bytes, 'image/jpeg')) === 200);
    const photo = (await post('/v1/media/confirm', ownerTok, { storageKey: pre.storageKey }).expect(201)).body;
    check('generic: confirm HEAD-verified + Photo created', photo.storageKey === pre.storageKey && photo.sizeBytes === bytes.length);
    const head = await storage.head(pre.storageKey);
    check('generic: object present in REAL bucket (HEAD)', head.exists === true && head.size === bytes.length, `size=${head.size}`);
    const dl = await fetch(photo.downloadUrl);
    const got = Buffer.from(await dl.arrayBuffer());
    check('generic: signed GET returns BYTE-IDENTICAL bytes from REAL S3', dl.status === 200 && got.equals(bytes), `dl=${dl.status} len=${got.length}`);
    const rawStatus = (await fetch(`https://${BUCKET}.s3.${REGION}.amazonaws.com/${pre.storageKey}`)).status;
    check('privacy: UNSIGNED object URL is 403 (bucket private)', rawStatus === 403, `HTTP ${rawStatus}`);
  }

  // ─────────── 2. CATALOG image (Inc-17) ───────────
  let catItemId = '';
  let catCategoryId = '';
  {
    const cat = (await post('/v1/catalog/categories', financeTok, { name: `S3 GOLIVE cat ${Date.now()}` }).expect(201)).body;
    catCategoryId = cat.id;
    const pre = (await post('/v1/catalog/image/presign', financeTok, { contentType: 'image/png', byteSize: PNG_1x1.length }).expect(201)).body;
    createdKeys.push(pre.storageKey);
    check('catalog: PUT real PNG to REAL S3', (await putBytes(pre.uploadUrl, PNG_1x1, 'image/png')) === 200);
    const item = (await post('/v1/catalog/items', financeTok, { name: 'S3 GOLIVE shirt', price: 6, categoryId: cat.id, imageKey: pre.storageKey }).expect(201)).body;
    catItemId = item.id;
    check('catalog: item created with confirmed image; signed imageUrl', !!item.imageUrl && item.imageUrl.includes('X-Amz-Signature'));
    const dl = await fetch(item.imageUrl);
    const got = Buffer.from(await dl.arrayBuffer());
    check('catalog: signed imageUrl serves BYTE-IDENTICAL PNG from REAL S3', dl.status === 200 && got.equals(PNG_1x1), `dl=${dl.status} len=${got.length}`);
  }

  // ─────────── 3. DRIVER POD (service-level — the media byte round-trip; route/record machinery is
  //             storage-agnostic + already MinIO-e2e-proven, so it's not re-run here) ───────────
  {
    const driverP = await mkPrincipal('+14165550006');
    const order = (await post('/v1/orders', ownerTok, { accountId: ACCOUNT_A, pickupWindow: win(), items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }] }).expect(201)).body;
    const bytes = Buffer.from(`S3-GOLIVE pod ${'p'.repeat(400)}`);
    const pre = await media.presignForStop(driverP, order.id, { contentType: 'image/jpeg', byteSize: bytes.length });
    createdKeys.push(pre.storageKey);
    check('POD: presign is a POD-kind org-namespaced key', /\/pod\//.test(pre.storageKey), pre.storageKey);
    check('POD: PUT real bytes to REAL S3', (await putBytes(pre.uploadUrl, bytes, 'image/jpeg')) === 200);
    const photo = await media.confirmForStop(driverP, pre.storageKey, order.id);
    check('POD: confirmForStop HEAD-verified + POD Photo created', photo.kind === 'POD' && photo.storageKey === pre.storageKey);
    const signed = await media.signedGetFor(photo);
    const dl = await fetch(signed ?? '');
    const got = Buffer.from(await dl.arrayBuffer());
    check('POD: signed GET returns BYTE-IDENTICAL POD bytes from REAL S3', dl.status === 200 && got.equals(bytes), `dl=${dl.status}`);
  }

  // ─────────── 4. SECURITY matrix ───────────
  {
    const order = (await post('/v1/orders', ownerTok, { accountId: ACCOUNT_A, pickupWindow: win(), items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }] }).expect(201)).body;
    // unconfirmed: presign, DO NOT PUT, confirm → 404 (never persisted)
    const pre = (await post('/v1/media/presign', ownerTok, { orderId: order.id, itemId: order.items[0].id, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: 100 }).expect(200)).body;
    const unconf = await post('/v1/media/confirm', ownerTok, { storageKey: pre.storageKey });
    check('security: an unconfirmed/unuploaded key is REJECTED (not persisted)', unconf.status === 404, `HTTP ${unconf.status}`);
    // cross-org: presign+PUT as owner (org1), confirm as org2 → 404
    const bytes = Buffer.from('cross-org-bytes');
    const pre2 = (await post('/v1/media/presign', ownerTok, { orderId: order.id, itemId: order.items[0].id, kind: 'BEFORE', contentType: 'image/jpeg', byteSize: bytes.length }).expect(200)).body;
    createdKeys.push(pre2.storageKey);
    await putBytes(pre2.uploadUrl, bytes, 'image/jpeg');
    const xorg = await post('/v1/media/confirm', org2Tok, { storageKey: pre2.storageKey });
    check("tenancy: another org cannot confirm this org's key (404)", xorg.status === 404, `HTTP ${xorg.status}`);
    await post('/v1/media/confirm', ownerTok, { storageKey: pre2.storageKey }).expect(201);
    // signed-GET expiry (real S3 enforces X-Amz-Expires). "Valid-now returns 200 + byte-identical" is already
    // proven 3× above (the default-TTL GETs); here we assert a SHORT-TTL URL is 403 once its window has passed
    // (checked after a comfortable margin so ~1s clock skew / network latency can't flap the result).
    const shortUrl = await storage.presignGet(pre2.storageKey, 2);
    await new Promise((r) => setTimeout(r, 4000));
    const later = (await fetch(shortUrl)).status;
    check('privacy: a short-TTL signed GET EXPIRES (2s TTL → 403 after 4s)', later === 403, `HTTP ${later}`);
  }

  // ─────────── real-bucket evidence ───────────
  try {
    const ls = execSync(`aws s3 ls s3://${BUCKET}/org/ --recursive`, { encoding: 'utf8' });
    const n = ls.trim() ? ls.trim().split('\n').length : 0;
    // eslint-disable-next-line no-console
    console.log(`\n[real bucket ${BUCKET}] objects under org/ before cleanup: ${n}`);
  } catch {
    /* aws cli listing is best-effort evidence */
  }

  // ─────────── cleanup: remove every object this proof created + the catalog test rows ───────────
  let deleted = 0;
  for (const k of createdKeys) {
    try {
      await storage.delete(k);
      deleted += 1;
    } catch {
      /* best-effort */
    }
  }
  if (catItemId) await prisma.service.deleteMany({ where: { id: catItemId } });
  if (catCategoryId) await prisma.serviceCategory.deleteMany({ where: { id: catCategoryId } });
  check('cleanup: deleted all test objects from the bucket', deleted === createdKeys.length, `${deleted}/${createdKeys.length} keys deleted`);

  await app.close();

  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\n=== S3 GO-LIVE PROOF: ${results.length - failed.length}/${results.length} checks passed (REAL bucket ${BUCKET} @ ${REGION}) ===`);
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.error('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[s3-proof] FATAL:', err);
  process.exit(1);
});
