import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001';
const ORDER_O2 = 'e0000000-0000-4000-8000-0000000000c1'; // Org-2 order (cross-org target)
const MISSING_UUID = '00000000-0000-4000-8000-0000000000ff';

const PHONES = {
  owner: '+14165550001',
  dispatcher: '+14165550002',
  csr: '+14165550003',
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
  acctBadmin: '+14165550020', // ACCOUNT_ADMIN, Account B
  driver1: '+14165550006',
  driver2: '+14165550007',
  org2owner: '+14165559001',
};

// Distinct GTA coordinates so "which ping won" is unambiguous in assertions.
const COORD = {
  a: { lat: 43.6534, lng: -79.3839 }, // downtown
  b: { lat: 43.7615, lng: -79.4111 }, // North York
  c: { lat: 43.7731, lng: -79.2318 }, // Scarborough
  old: { lat: 43.62, lng: -79.54 }, // Etobicoke (used for the stale/out-of-order ping)
};

describe('Tracking e2e — Increment 5 (location ingestion + Redis last-known + Timescale history + scoped reads)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const token: Record<string, string> = {};
  const userId: Record<string, string> = {};
  let vehicleId: string;
  let vehicle2Id: string;
  let driver1Id: string;
  let driver2Id: string;
  let activeShiftId: string; // driver1 + vehicleId, ACTIVE — the workhorse shift

  const post = (path: string, who: string, body: unknown = {}, key?: string) => {
    let req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`);
    if (key) req = req.set('Idempotency-Key', key);
    return req.send(body as object);
  };
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

  const ping = (c: { lat: number; lng: number }, recordedAt: string, extra: object = {}) => ({
    lat: c.lat,
    lng: c.lng,
    recordedAt,
    ...extra,
  });

  const gpsCount = (vid: string) => prisma.gpsPing.count({ where: { orgId: ORG, vehicleId: vid } });

  async function ensureDriver(uid: string): Promise<string> {
    const existing = await prisma.driver.findUnique({ where: { userId: uid } });
    if (existing) return existing.id;
    const res = await post('/v1/drivers', 'dispatcher', { userId: uid }).expect(201);
    return res.body.id as string;
  }

  async function startedShift(driverId: string, vid: string): Promise<string> {
    const s = (await post('/v1/shifts', 'dispatcher', { driverId, vehicleId: vid }).expect(201)).body;
    await post(`/v1/shifts/${s.id}:start`, 'dispatcher', {}).expect(200);
    return s.id as string;
  }

  async function bookOrder(siteId = SITE_NORTH): Promise<string> {
    const res = await post('/v1/orders', 'owner', {
      accountId: ACCOUNT_A,
      siteId,
      pickupWindow: { start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 3 * 3600_000).toISOString() },
      items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }],
    }).expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
      userId[name] = user.id;
    }
    vehicleId = (await post('/v1/vehicles', 'dispatcher', { label: 'Track Van 1', plate: 'TRK-001' }).expect(201)).body.id;
    vehicle2Id = (await post('/v1/vehicles', 'dispatcher', { label: 'Track Van 2', plate: 'TRK-002' }).expect(201)).body.id;
    driver1Id = await ensureDriver(userId.driver1);
    driver2Id = await ensureDriver(userId.driver2);
    activeShiftId = await startedShift(driver1Id, vehicleId);
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
    await app.close();
  });

  // ───────────── DoD #1 — pings accepted; Redis last-known = newest; Timescale rows appended ─────────────

  it('accepts a batch (out-of-order) → Redis last-known = newest position; Timescale rows appended', async () => {
    const base = Date.now();
    const t0 = new Date(base - 20_000).toISOString();
    const t1 = new Date(base - 10_000).toISOString();
    const t2 = new Date(base).toISOString(); // newest
    const before = await gpsCount(vehicleId);

    const res = await post('/v1/locations:batch', 'driver1', {
      shiftId: activeShiftId,
      vehicleId,
      // deliberately scrambled arrival order; t2 (COORD.c) is the newest by recorded_at
      pings: [ping(COORD.a, t1, { speed: 8, heading: 90 }), ping(COORD.c, t2, { speed: 12, heading: 270 }), ping(COORD.b, t0)],
    }).expect(200);

    expect(res.body.received).toBe(3);
    expect(res.body.accepted).toBe(3);
    expect(res.body.inserted).toBe(3);
    expect(res.body.lastKnownUpdated).toBe(true);
    // last-known reflects the NEWEST ping (t2 / COORD.c), not the last one to arrive
    expect(res.body.lastKnown.lat).toBeCloseTo(COORD.c.lat, 5);
    expect(res.body.lastKnown.lng).toBeCloseTo(COORD.c.lng, 5);
    expect(res.body.lastKnown.recordedAt).toBe(t2);
    expect(res.body.lastKnown.source).toBe('redis');

    // Timescale: exactly 3 new rows appended to the hypertable
    expect(await gpsCount(vehicleId)).toBe(before + 3);

    // Redis: read the hot key directly (prove the store actually holds the newest position)
    const hash = await redis.hgetall(`bb:lastknown:${ORG}:${vehicleId}`);
    expect(Number(hash.lat)).toBeCloseTo(COORD.c.lat, 5);
    expect(hash.recordedAt).toBe(t2);
    // GEO structure populated for later nearest-vehicle queries
    const geopos = await redis.geopos(`bb:fleetgeo:${ORG}`, vehicleId);
    expect(geopos[0]).not.toBeNull();
  });

  // ───────────── DoD #2 — shift-gating + horizontal scope ─────────────

  it('rejects pings for an ENDED shift (409), a MISSING shift (404), and a foreign driver’s shift (403)', async () => {
    const now = new Date().toISOString();
    // ended shift
    const ended = (await post('/v1/shifts', 'dispatcher', { driverId: driver1Id, vehicleId }).expect(201)).body;
    await post(`/v1/shifts/${ended.id}:start`, 'dispatcher', {}).expect(200);
    await post(`/v1/shifts/${ended.id}:end`, 'dispatcher', {}).expect(200);
    const endedRes = await post('/v1/locations:batch', 'driver1', { shiftId: ended.id, vehicleId, pings: [ping(COORD.a, now)] }).expect(409);
    expect(endedRes.headers['content-type']).toContain('application/problem+json');
    expect(endedRes.body.title).toBe('shift_not_active');

    // scheduled (never started) shift → also not active
    const scheduled = (await post('/v1/shifts', 'dispatcher', { driverId: driver1Id, vehicleId }).expect(201)).body;
    await post('/v1/locations:batch', 'driver1', { shiftId: scheduled.id, vehicleId, pings: [ping(COORD.a, now)] }).expect(409);

    // missing shift
    const missing = await post('/v1/locations:batch', 'driver1', { shiftId: MISSING_UUID, vehicleId, pings: [ping(COORD.a, now)] }).expect(404);
    expect(missing.body.title).toBe('shift_not_found');

    // driver2 posting for driver1's active shift → 403 (cross-driver)
    const foreign = await post('/v1/locations:batch', 'driver2', { shiftId: activeShiftId, vehicleId, pings: [ping(COORD.a, now)] }).expect(403);
    expect(foreign.body.title).toBe('not_own_shift');

    // and NOTHING was stored for the rejected ended-shift attempt
    const endedRows = await prisma.gpsPing.count({ where: { shiftId: ended.id } });
    expect(endedRows).toBe(0);
  });

  it('rejects a vehicle that is not the shift’s vehicle (422) and malformed coordinates (400)', async () => {
    const now = new Date().toISOString();
    const mismatch = await post('/v1/locations:batch', 'driver1', { shiftId: activeShiftId, vehicleId: vehicle2Id, pings: [ping(COORD.a, now)] }).expect(422);
    expect(mismatch.body.title).toBe('vehicle_shift_mismatch');

    const bad = await post('/v1/locations:batch', 'driver1', { shiftId: activeShiftId, vehicleId, pings: [{ lat: 999, lng: 0, recordedAt: now }] }).expect(400);
    expect(bad.body.title).toBe('validation_failed');
  });

  // ───────────── DoD #3 — robustness: replay no double-insert; out-of-order doesn’t regress last-known ─────────────

  it('a replayed batch does not double-insert (data-layer dedup by vehicle_id, recorded_at)', async () => {
    const t = new Date(Date.now() + 5_000).toISOString();
    const batch = { shiftId: activeShiftId, vehicleId, pings: [ping(COORD.a, t), ping(COORD.b, new Date(Date.now() + 6_000).toISOString())] };
    const before = await gpsCount(vehicleId);
    const first = await post('/v1/locations:batch', 'driver1', batch).expect(200);
    expect(first.body.inserted).toBe(2);
    const replay = await post('/v1/locations:batch', 'driver1', batch).expect(200); // same recorded_at instants
    expect(replay.body.inserted).toBe(0); // ON CONFLICT DO NOTHING
    expect(await gpsCount(vehicleId)).toBe(before + 2); // only the first batch's rows exist
  });

  it('an out-of-order OLDER ping does not overwrite a newer last-known', async () => {
    const newer = new Date(Date.now() + 60_000).toISOString();
    const older = new Date(Date.now() - 60_000).toISOString();
    // set a fresh, clearly-newest position
    const set = await post('/v1/locations:batch', 'driver1', { shiftId: activeShiftId, vehicleId, pings: [ping(COORD.b, newer)] }).expect(200);
    expect(set.body.lastKnown.recordedAt).toBe(newer);
    // now post an older ping — it must be stored in history but NOT advance last-known
    const beforeCount = await gpsCount(vehicleId);
    const stale = await post('/v1/locations:batch', 'driver1', { shiftId: activeShiftId, vehicleId, pings: [ping(COORD.old, older)] }).expect(200);
    expect(stale.body.inserted).toBe(1); // history still appends the late ping
    expect(stale.body.lastKnownUpdated).toBe(false); // but last-known did not regress
    expect(stale.body.lastKnown.recordedAt).toBe(newer);
    expect(stale.body.lastKnown.lat).toBeCloseTo(COORD.b.lat, 5);
    expect(await gpsCount(vehicleId)).toBe(beforeCount + 1);
  });

  it('concurrent batches for the same vehicle: all rows land once; last-known = global newest', async () => {
    const base = Date.now() + 120_000;
    const tA = new Date(base).toISOString();
    const tB = new Date(base + 1000).toISOString();
    const tShared = new Date(base + 2000).toISOString();
    const tNewest = new Date(base + 3000).toISOString();
    const before = await gpsCount(vehicleId);
    // two concurrent batches sharing one instant (tShared) — the unique index dedups the overlap
    const [r1, r2] = await Promise.all([
      post('/v1/locations:batch', 'driver1', { shiftId: activeShiftId, vehicleId, pings: [ping(COORD.a, tA), ping(COORD.a, tShared)] }),
      post('/v1/locations:batch', 'driver1', { shiftId: activeShiftId, vehicleId, pings: [ping(COORD.b, tB), ping(COORD.c, tShared), ping(COORD.c, tNewest)] }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // distinct recorded_at across both batches = {tA, tB, tShared, tNewest} = 4 rows total
    expect(await gpsCount(vehicleId)).toBe(before + 4);
    // last-known is the global newest (tNewest) regardless of which batch finished first
    const fleet = (await get('/v1/fleet/live', 'owner').expect(200)).body;
    const me = fleet.vehicles.find((v: { vehicleId: string }) => v.vehicleId === vehicleId);
    expect(me.recordedAt).toBe(tNewest);
  });

  // ───────────── DoD #4 — fleet/live scope + RBAC ─────────────

  it('GET /fleet/live: OWNER sees the org vehicle; a different org sees none of it; a customer is forbidden', async () => {
    const ownerFleet = (await get('/v1/fleet/live', 'owner').expect(200)).body;
    expect(ownerFleet.vehicles.some((v: { vehicleId: string }) => v.vehicleId === vehicleId)).toBe(true);

    // a different org cannot see this org's vehicle (org-scoped)
    const org2Fleet = (await get('/v1/fleet/live', 'org2owner').expect(200)).body;
    expect(org2Fleet.vehicles.some((v: { vehicleId: string }) => v.vehicleId === vehicleId)).toBe(false);
    expect(org2Fleet.withoutPosition.some((v: { vehicleId: string }) => v.vehicleId === vehicleId)).toBe(false);

    // RBAC: a customer cannot read the fleet
    const ritaForbidden = await get('/v1/fleet/live', 'rita').expect(403);
    expect(ritaForbidden.body.title).toBe('forbidden_role');
  });

  it('GET /fleet/live falls back to the latest Timescale row when Redis has no last-known', async () => {
    // vehicle2 has never been pinged via Redis; give it ONE shift + ping, then evict its Redis key.
    const shift2 = await startedShift(driver2Id, vehicle2Id);
    const t = new Date(Date.now() + 200_000).toISOString();
    await post('/v1/locations:batch', 'driver2', { shiftId: shift2, vehicleId: vehicle2Id, pings: [ping(COORD.c, t)] }).expect(200);
    // simulate a cold/evicted Redis hot store for this vehicle
    await redis.del(`bb:lastknown:${ORG}:${vehicle2Id}`);
    const fleet = (await get('/v1/fleet/live', 'owner').expect(200)).body;
    const v2 = fleet.vehicles.find((v: { vehicleId: string }) => v.vehicleId === vehicle2Id);
    expect(v2).toBeTruthy();
    expect(v2.source).toBe('timescale'); // served from the hypertable fallback
    expect(v2.recordedAt).toBe(t);
  });

  // ───────────── DoD #5 — customer tracking: exactly one vehicle, scoped ─────────────

  it('customer tracking returns ONLY the order’s assigned vehicle; other vehicles/customers are not visible', async () => {
    // Put a fresh Account-A order on a route assigned to vehicleId (the active shift's vehicle), and depart.
    const orderId = await bookOrder(SITE_NORTH);
    const routeId = (await post('/v1/routes', 'dispatcher', { date: '2026-07-02' }).expect(201)).body.id;
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher', {}).expect(200);
    await post(`/v1/route-stops/${stop.id}:depart`, 'dispatcher', {}).expect(200); // stop EN_ROUTE on a live route

    // post a fresh position for the assigned vehicle
    const t = new Date(Date.now() + 300_000).toISOString();
    await post('/v1/locations:batch', 'driver1', { shiftId: activeShiftId, vehicleId, pings: [ping(COORD.b, t)] }).expect(200);

    // Rita (owns the Account-A order) sees exactly the assigned vehicle's last-known
    const ritaView = (await get(`/v1/orders/${orderId}/tracking`, 'rita').expect(200)).body;
    expect(ritaView.stop.id).toBe(stop.id);
    expect(ritaView.vehicle.vehicleId).toBe(vehicleId); // the ONE assigned vehicle
    expect(ritaView.vehicle.recordedAt).toBe(t);
    // the response carries a single vehicle object — never a fleet/array (privacy by shape)
    expect(Array.isArray(ritaView.vehicle)).toBe(false);
    expect(ritaView.vehicle.vehicleId).not.toBe(vehicle2Id); // the other van is never exposed

    // a different account (Account B admin) cannot read Rita's order tracking → 404 (scoped)
    const bView = await get(`/v1/orders/${orderId}/tracking`, 'acctBadmin').expect(404);
    expect(bView.body.title).toBe('order_not_found');
    // a different org cannot read it either
    await get(`/v1/orders/${orderId}/tracking`, 'org2owner').expect(404);
    // and cannot read an order that isn't theirs at all
    await get(`/v1/orders/${ORDER_O2}/tracking`, 'rita').expect(404);
  });

  it('customer tracking returns vehicle:null when the order has no active stop (no leak)', async () => {
    const orderId = await bookOrder(SITE_NORTH); // booked, never routed
    const view = (await get(`/v1/orders/${orderId}/tracking`, 'rita').expect(200)).body;
    expect(view.stop).toBeNull();
    expect(view.vehicle).toBeNull();
  });

  // ───────────── DoD #6 — tx-scoping: every stored ping carries explicit org_id ─────────────

  it('every ingested GpsPing row carries the explicit caller org_id (defense-in-depth scoping)', async () => {
    const rows = await prisma.gpsPing.findMany({ where: { vehicleId }, select: { orgId: true } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orgId === ORG)).toBe(true);
  });

  // ───────────── health + OpenAPI surface ─────────────

  it('OpenAPI documents the new tracking paths; GET /v1/health is still 200', async () => {
    const paths = Object.keys((await http.get('/v1/docs-json').expect(200)).body.paths);
    expect(paths).toContain('/v1/locations:batch');
    expect(paths).toContain('/v1/fleet/live');
    expect(paths).toContain('/v1/orders/{id}/tracking');
    const health = await http.get('/v1/health').expect(200);
    expect(health.body.status).toBe('ok');
  });
});
