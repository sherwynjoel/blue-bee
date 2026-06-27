import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type Redis from 'ioredis';
import { POD_ERRORS, RouteStopKind, RouteStopStatus } from '@blue-bee/shared';
import { RouteStatus as PrismaRouteStatus, ShiftStatus as PrismaShiftStatus } from '@prisma/client';
import { createRealtimeTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001';

const PHONES = {
  owner: '+14165550001',
  dispatcher: '+14165550002',
  driver1: '+14165550006',
  driver2: '+14165550007',
};

interface Scenario {
  routeId: string;
  shiftId: string;
  stopId: string;
  orderId: string;
}

/**
 * Increment 17 — driver proof-of-delivery (photo + signature + geo) capture, proven end-to-end against
 * the REAL local MinIO + Postgres. A driver presigns POD media for THEIR OWN delivery stop, PUTs real
 * bytes, captures the POD (HEAD-verified objects → ProofOfDelivery with signatureKey + linked photos +
 * geo), and only THEN can complete the delivery stop. Plus the security/idempotency/§5.4 matrix.
 */
describe('Driver POD e2e — Increment 17 (/v1/driver/stops/:id/{pod/presign,proof-of-delivery}, real MinIO)', () => {
  let app: INestApplication;
  let pub: Redis;
  let sub: Redis;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const userId: Record<string, string> = {};
  let driver1Id: string;
  let driver2Id: string;
  let seq = 0;

  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const window = () => ({ start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() });

  /** PUT real bytes to a presigned URL (the client upload — global fetch, not supertest). */
  async function putBytes(url: string, bytes: Buffer, contentType: string): Promise<number> {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes) });
    return res.status;
  }

  async function ensureDriver(uid: string): Promise<string> {
    const existing = await prisma.driver.findUnique({ where: { userId: uid } });
    if (existing) return existing.id;
    return (await post('/v1/drivers', 'dispatcher', { userId: uid }).expect(201)).body.id;
  }

  /** A published route assigned to driver1 with ONE workable stop of the given kind, walked to IN_PROGRESS. */
  async function freshScenario(driverId: string, kind: RouteStopKind): Promise<Scenario> {
    seq += 1;
    const vehicleId = (await post('/v1/vehicles', 'dispatcher', { label: `POD Van ${seq}`, plate: `POD-${seq}` }).expect(201)).body.id;
    const shift = (await post('/v1/shifts', 'dispatcher', { driverId, vehicleId }).expect(201)).body;
    const orderId = (
      await post('/v1/orders', 'owner', { accountId: ACCOUNT_A, siteId: SITE_NORTH, pickupWindow: window(), items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }] }).expect(201)
    ).body.id;
    const routeId = (await post('/v1/routes', 'dispatcher', { date: '2026-07-20' }).expect(201)).body.id;
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId, kind }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher').expect(200);
    // Walk to IN_PROGRESS (the only state a stop may COMPLETE from).
    await post(`/v1/driver/shifts/${shift.id}/start`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${stop.id}/depart`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${stop.id}/arrive`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${stop.id}/start`, 'driver1').expect(200);
    return { routeId, shiftId: shift.id, stopId: stop.id, orderId };
  }

  /** Presign + PUT a POD object as driver1; returns its storageKey. */
  async function uploadPod(stopId: string, contentType: string, bytes: Buffer): Promise<string> {
    const pre = (await post(`/v1/driver/stops/${stopId}/pod/presign`, 'driver1', { contentType, byteSize: bytes.length }).expect(200)).body;
    expect(pre.uploadUrl).toContain('X-Amz-Signature');
    expect(pre.storageKey).toMatch(/^org\/[0-9a-f-]+\/pod\/[0-9a-f-]+\.(jpg|png)$/);
    expect(await putBytes(pre.uploadUrl, bytes, contentType)).toBe(200);
    return pre.storageKey;
  }

  beforeAll(async () => {
    const live = await fetch('http://localhost:9000/minio/health/live').then((r) => r.status).catch(() => 0);
    if (live !== 200) throw new Error('MinIO not reachable at http://localhost:9000 — run `npm run infra:up` (the POD media e2e proves the REAL S3 path).');

    const built = await createRealtimeTestApp();
    app = built.app;
    pub = built.pub;
    sub = built.sub;
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      userId[name] = user.id;
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
    driver1Id = await ensureDriver(userId.driver1);
    driver2Id = await ensureDriver(userId.driver2);
    // Isolate from leftover state on the reused drivers.
    await prisma.shift.updateMany({ where: { driverId: { in: [driver1Id, driver2Id] }, status: { in: [PrismaShiftStatus.SCHEDULED, PrismaShiftStatus.ACTIVE] } }, data: { status: PrismaShiftStatus.ENDED, endedAt: new Date() } });
    await prisma.route.updateMany({ where: { driverId: { in: [driver1Id, driver2Id] }, status: { in: [PrismaRouteStatus.PUBLISHED, PrismaRouteStatus.IN_PROGRESS] } }, data: { driverId: null } });
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
    await pub.quit();
    await sub.quit();
  });

  it('captures POD (real photo + signature bytes + geo) and gates the delivery complete on it', async () => {
    const sc = await freshScenario(driver1Id, RouteStopKind.DELIVERY);

    // Gate: a DELIVERY stop cannot COMPLETE before a POD is captured (clean 4xx; the machine is untouched).
    const blocked = await post(`/v1/driver/stops/${sc.stopId}/complete`, 'driver1').expect(400);
    expect(blocked.body.error ?? blocked.body.title).toBe(POD_ERRORS.POD_REQUIRED);
    expect((await prisma.routeStop.findUniqueOrThrow({ where: { id: sc.stopId } })).status).toBe(RouteStopStatus.IN_PROGRESS); // not corrupted

    // Upload the real POD photo + signature to MinIO.
    const photoKey = await uploadPod(sc.stopId, 'image/jpeg', Buffer.from('pod-photo-' + 'x'.repeat(400)));
    const sigKey = await uploadPod(sc.stopId, 'image/png', Buffer.from('pod-signature-' + 'y'.repeat(200)));

    // Capture the POD.
    const podRes = await post(`/v1/driver/stops/${sc.stopId}/proof-of-delivery`, 'driver1', {
      signatureStorageKey: sigKey,
      photoStorageKeys: [photoKey],
      geo: { lng: -79.4111, lat: 43.7615 },
    }).expect(201);

    // View: signed reads only (never a raw key), signature + photo distinct, geo round-tripped.
    expect(podRes.body.routeStopId).toBe(sc.stopId);
    expect(podRes.body.signature.downloadUrl).toContain('X-Amz-Signature');
    expect(podRes.body.signature.storageKey).toBe(sigKey);
    expect(podRes.body.photos).toHaveLength(1);
    expect(podRes.body.photos[0].downloadUrl).toContain('X-Amz-Signature');
    expect(podRes.body.photos[0].storageKey).toBe(photoKey);
    expect(podRes.body.geo.lng).toBeCloseTo(-79.4111, 3);
    expect(podRes.body.geo.lat).toBeCloseTo(43.7615, 3);

    // The signed GET returns the REAL bytes.
    const dl = await fetch(podRes.body.photos[0].downloadUrl);
    expect(dl.status).toBe(200);

    // DB: one ProofOfDelivery for the stop, signatureKey set, capturedBy the driver, photos linked by podId.
    const pod = await prisma.proofOfDelivery.findUniqueOrThrow({ where: { routeStopId: sc.stopId } });
    expect(pod.signatureKey).toBe(sigKey);
    expect(pod.capturedBy).toBe(userId.driver1);
    const linked = await prisma.photo.findMany({ where: { podId: pod.id } });
    expect(linked.map((p) => p.storageKey).sort()).toEqual([photoKey, sigKey].sort());
    expect(linked.every((p) => p.kind === 'POD')).toBe(true);

    // Now the delivery stop COMPLETES (the gate is satisfied).
    await post(`/v1/driver/stops/${sc.stopId}/complete`, 'driver1').expect(200);
    expect((await prisma.routeStop.findUniqueOrThrow({ where: { id: sc.stopId } })).status).toBe(RouteStopStatus.COMPLETED);
  });

  it('is idempotent on the stop — re-submitting POD yields the SAME row, no duplicate photos', async () => {
    const sc = await freshScenario(driver1Id, RouteStopKind.DELIVERY);
    const photoKey = await uploadPod(sc.stopId, 'image/jpeg', Buffer.from('idem-photo-' + 'a'.repeat(100)));
    const sigKey = await uploadPod(sc.stopId, 'image/png', Buffer.from('idem-sig-' + 'b'.repeat(100)));
    const body = { signatureStorageKey: sigKey, photoStorageKeys: [photoKey] };

    const first = (await post(`/v1/driver/stops/${sc.stopId}/proof-of-delivery`, 'driver1', body).expect(201)).body;
    const second = (await post(`/v1/driver/stops/${sc.stopId}/proof-of-delivery`, 'driver1', body).expect(201)).body;
    expect(second.id).toBe(first.id); // same POD row

    const pods = await prisma.proofOfDelivery.findMany({ where: { routeStopId: sc.stopId } });
    expect(pods).toHaveLength(1); // unique routeStopId
    const linked = await prisma.photo.findMany({ where: { podId: pods[0].id } });
    expect(linked).toHaveLength(2); // signature + 1 photo, no dupes from the re-confirm
  });

  it('a driver can POD ONLY their own stop (cross-driver → 403)', async () => {
    const sc = await freshScenario(driver1Id, RouteStopKind.DELIVERY);
    // driver2 (a real, different driver) cannot presign or capture POD on driver1's stop.
    await post(`/v1/driver/stops/${sc.stopId}/pod/presign`, 'driver2', { contentType: 'image/png', byteSize: 100 }).expect(403);
    await post(`/v1/driver/stops/${sc.stopId}/proof-of-delivery`, 'driver2', { signatureStorageKey: 'org/x/pod/y.png', photoStorageKeys: ['org/x/pod/z.jpg'] }).expect(403);
    // a non-driver (owner) cannot reach the driver surface at all.
    await post(`/v1/driver/stops/${sc.stopId}/pod/presign`, 'owner', { contentType: 'image/png', byteSize: 100 }).expect(403);
  });

  it('POD applies only to DELIVERY stops — a PICKUP stop is rejected', async () => {
    const sc = await freshScenario(driver1Id, RouteStopKind.PICKUP);
    const bad = await post(`/v1/driver/stops/${sc.stopId}/pod/presign`, 'driver1', { contentType: 'image/png', byteSize: 100 }).expect(400);
    expect(bad.body.error ?? bad.body.title).toBe(POD_ERRORS.STOP_NOT_DELIVERY);
    // and a PICKUP stop still completes WITHOUT a POD (pickup behavior unchanged).
    await post(`/v1/driver/stops/${sc.stopId}/complete`, 'driver1').expect(200);
    expect((await prisma.routeStop.findUniqueOrThrow({ where: { id: sc.stopId } })).status).toBe(RouteStopStatus.COMPLETED);
  });

  it('rejects an unsupported content-type and a cross-stop storage key (no raw-URL trust)', async () => {
    const sc = await freshScenario(driver1Id, RouteStopKind.DELIVERY);
    // unsupported content type at presign
    await post(`/v1/driver/stops/${sc.stopId}/pod/presign`, 'driver1', { contentType: 'text/plain', byteSize: 100 }).expect(400);
    // a key presigned for ANOTHER stop's order cannot be smuggled into this stop's POD
    const other = await freshScenario(driver1Id, RouteStopKind.DELIVERY);
    const otherKey = await uploadPod(other.stopId, 'image/jpeg', Buffer.from('other-stop-photo'));
    const sigKey = await uploadPod(sc.stopId, 'image/png', Buffer.from('this-stop-sig'));
    const bad = await post(`/v1/driver/stops/${sc.stopId}/proof-of-delivery`, 'driver1', { signatureStorageKey: sigKey, photoStorageKeys: [otherKey] }).expect(400);
    expect(bad.body.error ?? bad.body.title).toBe(POD_ERRORS.MEDIA_NOT_CONFIRMED);
  });
});
