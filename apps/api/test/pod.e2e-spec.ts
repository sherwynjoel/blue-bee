import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import type Redis from 'ioredis';
import { CustodyStage, NOTIFICATION_EVENTS, POD_ERRORS, RouteStopKind, RouteStopStatus } from '@blue-bee/shared';
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

// [Inc-37] A throwaway referral pair, so the credit assertion mutates NO seeded row.
const ORG1 = '11111111-1111-4111-8111-111111111111';
const REFERRER = 'c0d00000-0000-4000-8000-00000000d001'; // gets paid
const FRIEND = 'c0d00000-0000-4000-8000-00000000d002'; // the invited friend who books
const REFERRAL_REWARD = 5; // CAD — funded by this spec, un-funded again in afterAll

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

  /**
   * [Inc-31] Book a MULTI-item order and drive it the whole real §5.1 spine to READY (the state a delivery
   * is scheduled from) — pickup → intake → quote → approve → cleaning → QC → ready. All steps are OWNER-legal,
   * so one token drives it. Returns the order id (its items are already ordered by the Inc-29 sortOrder).
   */
  async function deliverableReadyOrder(): Promise<string> {
    const orderId = (
      await post('/v1/orders', 'owner', {
        accountId: ACCOUNT_A,
        siteId: SITE_NORTH,
        pickupWindow: window(),
        items: [
          { kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 },
          { kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 25 },
        ],
      }).expect(201)
    ).body.id;
    await post(`/v1/orders/${orderId}/schedule-pickup`, 'owner', { pickupWindow: window() }).expect(200);
    await post(`/v1/orders/${orderId}/received-at-plant`, 'owner', {}).expect(200);
    const order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    for (const item of order.items) {
      await post(`/v1/orders/${orderId}/items/${item.id}/inspection`, 'owner', { conditionCodes: ['MINOR_FRINGE_WEAR'], measurements: { sqft: 40 } }).expect(201);
    }
    await post(`/v1/orders/${orderId}/quote`, 'owner', {}).expect(201);
    await post(`/v1/orders/${orderId}/quote:approve`, 'owner', {}).expect(200);
    await post(`/v1/orders/${orderId}/start-cleaning`, 'owner', {}).expect(200);
    await post(`/v1/orders/${orderId}/send-to-qc`, 'owner', {}).expect(200);
    await post(`/v1/orders/${orderId}/qc`, 'owner', { result: 'pass' }).expect(200);
    const ready = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(ready.status).toBe('READY');
    return orderId;
  }

  const orderStatus = async (orderId: string): Promise<string> => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

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
    // [Inc-37] leave no credit state behind: drop the throwaway referral pair + un-fund the reward.
    await prisma.creditEntry.deleteMany({ where: { OR: [{ userId: REFERRER }, { referredUserId: FRIEND }] } });
    await prisma.user.deleteMany({ where: { id: { in: [FRIEND, REFERRER] } } });
    const org = await prisma.organization.findUnique({ where: { id: ORG1 }, select: { settings: true } });
    const settings = { ...((org?.settings as Record<string, unknown> | null) ?? {}) };
    delete settings.referralRewardAmount;
    await prisma.organization.update({ where: { id: ORG1 }, data: { settings: settings as Prisma.InputJsonValue } });

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

  // ─────────────────────────── Inc-31 — delivery legs (READY → … → DELIVERED, POD-gated both paths) ───────────────────────────

  it('a published DELIVERY stop advances the order READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED, POD-gated on BOTH the driver AND the dispatch path, writing the DELIVERED custody chain', async () => {
    const orderId = await deliverableReadyOrder();

    // Route the READY order as a DELIVERY stop, assigned to driver1, and publish.
    seq += 1;
    const vehicleId = (await post('/v1/vehicles', 'dispatcher', { label: `Del Van ${seq}`, plate: `DEL-${seq}` }).expect(201)).body.id;
    const shift = (await post('/v1/shifts', 'dispatcher', { driverId: driver1Id, vehicleId }).expect(201)).body;
    const routeId = (await post('/v1/routes', 'dispatcher', { date: '2026-07-21' }).expect(201)).body.id;
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId, kind: RouteStopKind.DELIVERY }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);

    // publish → the delivery leg is scheduled (READY → SCHEDULED_DELIVERY).
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher').expect(200);
    expect(await orderStatus(orderId)).toBe('SCHEDULED_DELIVERY');

    // driver starts the shift, departs → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE.
    await post(`/v1/driver/shifts/${shift.id}/start`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${stop.id}/depart`, 'driver1').expect(200);
    expect(await orderStatus(orderId)).toBe('DELIVERY_EN_ROUTE');
    await post(`/v1/driver/stops/${stop.id}/arrive`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${stop.id}/start`, 'driver1').expect(200);

    // POD gate — a delivery stop cannot COMPLETE without a captured POD, on EITHER entry point:
    //   • the driver duty-loop  /v1/driver/stops/:id/complete
    //   • the ops/dispatch      /v1/route-stops/:id:complete   (previously ungated → the Inc-31 fix)
    const blockedDriver = await post(`/v1/driver/stops/${stop.id}/complete`, 'driver1').expect(400);
    expect(blockedDriver.body.error ?? blockedDriver.body.title).toBe(POD_ERRORS.POD_REQUIRED);
    const blockedOps = await post(`/v1/route-stops/${stop.id}:complete`, 'owner').expect(400);
    expect(blockedOps.body.error ?? blockedOps.body.title).toBe(POD_ERRORS.POD_REQUIRED);
    // Neither blocked call touched the machine: stop still IN_PROGRESS, order still DELIVERY_EN_ROUTE.
    expect((await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } })).status).toBe(RouteStopStatus.IN_PROGRESS);
    expect(await orderStatus(orderId)).toBe('DELIVERY_EN_ROUTE');

    // Capture the real POD (photo + signature to MinIO), then complete.
    const photoKey = await uploadPod(stop.id, 'image/jpeg', Buffer.from('deliver-photo-' + 'x'.repeat(400)));
    const sigKey = await uploadPod(stop.id, 'image/png', Buffer.from('deliver-sig-' + 'y'.repeat(200)));
    await post(`/v1/driver/stops/${stop.id}/proof-of-delivery`, 'driver1', {
      signatureStorageKey: sigKey,
      photoStorageKeys: [photoKey],
      geo: { lng: -79.4111, lat: 43.7615 },
    }).expect(201);

    await post(`/v1/driver/stops/${stop.id}/complete`, 'driver1').expect(200);

    // Stop COMPLETED, order DELIVERED.
    expect((await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } })).status).toBe(RouteStopStatus.COMPLETED);
    expect(await orderStatus(orderId)).toBe('DELIVERED');

    // A DELIVERED CustodyEvent for EVERY item, walked in the Inc-29 ITEM_ORDER_BY sequence, and every
    // Item.status = DELIVERED. (Append-only inserts — exactly one DELIVERED event per item.)
    const items = await prisma.item.findMany({ where: { orderId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    expect(items.length).toBe(2);
    for (const it of items) {
      const events = await prisma.custodyEvent.findMany({ where: { itemId: it.id, stage: CustodyStage.DELIVERED } });
      expect(events).toHaveLength(1);
      expect(events[0].deviceId).toBe('route-stop-delivery');
      expect(it.status).toBe('DELIVERED');
    }
    const delivered = await prisma.custodyEvent.count({ where: { itemId: { in: items.map((i) => i.id) }, stage: CustodyStage.DELIVERED } });
    expect(delivered).toBe(items.length); // one-to-one, no extras

    // [Inc-32] The DELIVERED transition enqueued a RATE_REQUEST for the order's owning customer(s) — the
    // "how did we do?" push, through the same outbox engine (source = the Order; deduped per recipient×channel).
    const rateNotifs = await prisma.notification.findMany({ where: { sourceId: orderId, eventType: NOTIFICATION_EVENTS.RATE_REQUEST } });
    expect(rateNotifs.length).toBeGreaterThan(0);
    expect(rateNotifs.every((n) => (n.payload as { orderId?: string }).orderId === orderId)).toBe(true);
  });

  // ─────────────────────────── Inc-37 — the referral EARN fires on the REAL delivery ───────────────────────────

  /**
   * The credit ledger is proven in credits.e2e; what this proves is the WIRING: that a credit is earned by the
   * SAME DELIVERED transition a driver actually performs (route → POD → complete), not by a service call a test
   * made up. The reward is FUNDED here and un-funded in afterAll — with no funded reward, no credit exists at all.
   */
  it('[Inc-37] the real driver delivery grants the referrer their funded credit — provenance on the delivered order', async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ORG1 }, select: { settings: true } });
    await prisma.organization.update({
      where: { id: ORG1 },
      data: {
        settings: { ...((org.settings as Record<string, unknown> | null) ?? {}), referralRewardAmount: REFERRAL_REWARD } as Prisma.InputJsonValue,
      },
    });
    await prisma.user.create({ data: { id: REFERRER, orgId: ORG1, name: 'POD e2e — referrer', phone: '+14165559901', status: 'ACTIVE', authProviders: ['otp'] } });
    await prisma.user.create({
      data: { id: FRIEND, orgId: ORG1, name: 'POD e2e — friend', phone: '+14165559902', status: 'ACTIVE', authProviders: ['otp'], referredByUserId: REFERRER },
    });

    // A real, deliverable order — booked by the invited FRIEND (the hook pays on Order.createdBy's referrer).
    const orderId = await deliverableReadyOrder();
    await prisma.order.update({ where: { id: orderId }, data: { createdBy: FRIEND } });
    expect(await prisma.creditEntry.count({ where: { orgId: ORG1, userId: REFERRER } })).toBe(0); // nothing earned yet

    // Route it, capture a REAL POD, complete → DELIVERED (the exact driver path, no shortcuts).
    seq += 1;
    const vehicleId = (await post('/v1/vehicles', 'dispatcher', { label: `Ref Van ${seq}`, plate: `REF-${seq}` }).expect(201)).body.id;
    const shift = (await post('/v1/shifts', 'dispatcher', { driverId: driver1Id, vehicleId }).expect(201)).body;
    const routeId = (await post('/v1/routes', 'dispatcher', { date: '2026-07-22' }).expect(201)).body.id;
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId, kind: RouteStopKind.DELIVERY }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher').expect(200);
    await post(`/v1/driver/shifts/${shift.id}/start`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${stop.id}/depart`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${stop.id}/arrive`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${stop.id}/start`, 'driver1').expect(200);
    const photoKey = await uploadPod(stop.id, 'image/jpeg', Buffer.from('referral-photo-' + 'x'.repeat(400)));
    const sigKey = await uploadPod(stop.id, 'image/png', Buffer.from('referral-sig-' + 'y'.repeat(200)));
    await post(`/v1/driver/stops/${stop.id}/proof-of-delivery`, 'driver1', {
      signatureStorageKey: sigKey,
      photoStorageKeys: [photoKey],
      geo: { lng: -79.4111, lat: 43.7615 },
    }).expect(201);
    await post(`/v1/driver/stops/${stop.id}/complete`, 'driver1').expect(200);
    expect(await orderStatus(orderId)).toBe('DELIVERED');

    // ONE credit entry — to the REFERRER, for the funded amount, stamped with the friend + the order that earned it.
    const entries = await prisma.creditEntry.findMany({ where: { orgId: ORG1, userId: REFERRER } });
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('REFERRAL_EARN');
    expect(Number(entries[0].amount)).toBe(REFERRAL_REWARD);
    expect(entries[0].referredUserId).toBe(FRIEND);
    expect(entries[0].orderId).toBe(orderId); // provenance: the delivery that earned it
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
