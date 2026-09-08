import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import type Redis from 'ioredis';
import { createRealtimeTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { ETA_ESTIMATOR } from '../src/tracking/eta-estimator';
import { PostgisEtaEstimator } from '../src/tracking/postgis-eta.estimator';
import { GeofenceService } from '../src/tracking/geofence.service';

const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001'; // North York — geo {43.7615,-79.4111}

const PHONES = {
  owner: '+14165550001',
  dispatcher: '+14165550002',
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A (owns the order → mints channel token)
  driver1: '+14165550006',
  org2owner: '+14165559001',
};

// Coordinates relative to the SITE_NORTH stop destination (43.7615, -79.4111).
const FAR = { lat: 43.6534, lng: -79.3839 }; // downtown — ~13.5 km
const MID = { lat: 43.7, lng: -79.41 }; // ~6.8 km
const NEAR = { lat: 43.755, lng: -79.4111 }; // ~723 m — inside 800 m, outside 100 m
const INNER = { lat: 43.76, lng: -79.4111 }; // ~167 m — still inside 800 m, outside 100 m
const AT = { lat: 43.7615, lng: -79.4111 }; // the stop — 0 m

interface Scenario {
  vehicleId: string;
  shiftId: string;
  orderId: string;
  stopId: string;
}

describe('ETA + geofence e2e — Increment 7 (server-side ETA range + geofence events)', () => {
  let app: INestApplication;
  let port: number;
  let pub: Redis;
  let sub: Redis;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  let driver1Id: string;
  let vehSeq = 0;
  const openSockets: Socket[] = [];

  // A spec-global monotonic clock for recordedAt: every ping across every test is strictly newer
  // than the last (so the Lua-CAS always advances) and the deltas drive the derived speed.
  let clockMs = Date.now();
  const ts = (stepSec: number): string => {
    clockMs += Math.max(1, stepSec) * 1000;
    return new Date(clockMs).toISOString();
  };

  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const pingBatch = (s: Scenario, c: { lat: number; lng: number }, recordedAt: string) =>
    post('/v1/locations:batch', 'driver1', { shiftId: s.shiftId, vehicleId: s.vehicleId, pings: [{ ...c, recordedAt }] });

  // ── WS helpers (mirroring the Increment-6 realtime e2e) ──
  function connect(namespace: string, auth: Record<string, unknown>): Socket {
    const socket = io(`http://localhost:${port}${namespace}`, { auth, transports: ['websocket'], reconnection: false, forceNew: true, timeout: 5000 });
    openSockets.push(socket);
    return socket;
  }
  const waitConnect = (s: Socket) =>
    new Promise<void>((res, rej) => {
      s.once('connect', () => res());
      s.once('connect_error', (e: Error) => rej(e));
    });
  const waitEvent = <T = unknown>(s: Socket, event: string, ms = 4000) =>
    new Promise<T>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${event}`)), ms);
      s.once(event, (p: T) => {
        clearTimeout(t);
        res(p);
      });
    });
  const expectNoEvent = (s: Socket, event: string, ms = 1000) =>
    new Promise<void>((res, rej) => {
      const t = setTimeout(() => res(), ms);
      s.once(event, (p: unknown) => {
        clearTimeout(t);
        rej(new Error(`unexpected ${event}: ${JSON.stringify(p)}`));
      });
    });
  const collect = <T = unknown>(s: Socket, event: string): T[] => {
    const arr: T[] = [];
    s.on(event, (p: T) => arr.push(p));
    return arr;
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function ensureDriver(uid: string): Promise<string> {
    const existing = await prisma.driver.findUnique({ where: { userId: uid } });
    if (existing) return existing.id;
    return (await post('/v1/drivers', 'dispatcher', { userId: uid }).expect(201)).body.id;
  }

  /** A fully-isolated scenario: a FRESH vehicle + started shift (driver1) + a booked Account-A
   *  order routed to it, published, and DEPARTED so its single stop is EN_ROUTE with a geo dest.
   *  Fresh-vehicle isolation ⇒ exactly one active stop + a clean recent-track for the speed math. */
  async function freshScenario(): Promise<Scenario> {
    vehSeq += 1;
    const vehicleId = (await post('/v1/vehicles', 'dispatcher', { label: `ETA Van ${vehSeq}`, plate: `ETA-${vehSeq}` }).expect(201)).body.id;
    const s = (await post('/v1/shifts', 'dispatcher', { driverId: driver1Id, vehicleId }).expect(201)).body;
    await post(`/v1/shifts/${s.id}:start`, 'dispatcher').expect(200);
    const orderId = (
      await post('/v1/orders', 'owner', {
        accountId: ACCOUNT_A,
        siteId: SITE_NORTH,
        pickupWindow: { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() },
        items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }],
      }).expect(201)
    ).body.id;
    const routeId = (await post('/v1/routes', 'dispatcher', { date: '2026-07-10' }).expect(201)).body.id;
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher').expect(200);
    await post(`/v1/route-stops/${stop.id}:depart`, 'dispatcher').expect(200);
    return { vehicleId, shiftId: s.id, orderId, stopId: stop.id };
  }
  const channelTokenFor = (orderId: string, who = 'rita'): Promise<string> =>
    get(`/v1/orders/${orderId}/tracking`, who).expect(200).then((r) => r.body.channelToken);

  beforeAll(async () => {
    const built = await createRealtimeTestApp();
    app = built.app;
    port = built.port;
    pub = built.pub;
    sub = built.sub;
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
    driver1Id = await ensureDriver((await get('/v1/me', 'driver1').expect(200)).body.user.userId);
  }, 60000);

  afterEach(() => {
    for (const s of openSockets.splice(0)) s.disconnect();
  });

  afterAll(async () => {
    for (const s of openSockets.splice(0)) s.disconnect();
    await prisma.$disconnect();
    await app.close();
    await pub.quit();
    await sub.quit();
  });

  // ───────────── the seam is bound to the in-house impl (no external maps API) ─────────────

  it('binds ETA_ESTIMATOR to the in-house PostGIS estimator (no external maps/routing provider)', () => {
    const bound = app.get(ETA_ESTIMATOR);
    expect(bound).toBe(app.get(PostgisEtaEstimator));
    expect((bound as { name: string }).name).toBe('in_house_postgis_geodesic');
  });

  // ───────────── DoD ETA — range on REST + emits on customer & fleet + SHRINKS ─────────────

  it('ETA range appears on REST, emits on the customer + fleet channels, and shrinks as the truck approaches', async () => {
    const sc = await freshScenario();
    const cust = connect('/live/vehicle', { token: await channelTokenFor(sc.orderId) });
    const fleet = connect('/live/fleet', { token: token.owner });
    await Promise.all([waitConnect(cust), waitConnect(fleet)]);

    const custEtas = collect<{ stopId: string; etaSeconds: number; eta: string; low: string; high: string }>(cust, 'eta');
    const fleetEtas = collect<{ vehicleId: string; etaSeconds: number }>(fleet, 'eta');

    const firstFleet = waitEvent<{ vehicleId: string }>(fleet, 'eta', 4000);
    await pingBatch(sc, FAR, ts(1)).expect(200);
    expect((await firstFleet).vehicleId).toBe(sc.vehicleId); // fleet (ops) sees the ETA

    await pingBatch(sc, MID, ts(60)).expect(200);
    await pingBatch(sc, NEAR, ts(60)).expect(200);
    await sleep(400); // let the three eta emits flush

    // The customer received an ETA for ITS stop, as a valid range (low <= mid <= high), shrinking.
    expect(custEtas.length).toBeGreaterThanOrEqual(3);
    for (const e of custEtas) {
      expect(e.stopId).toBe(sc.stopId);
      expect(Date.parse(e.low)).toBeLessThanOrEqual(Date.parse(e.eta));
      expect(Date.parse(e.eta)).toBeLessThanOrEqual(Date.parse(e.high));
    }
    const secs = custEtas.map((e) => e.etaSeconds);
    expect(secs[secs.length - 1]).toBeLessThan(secs[0]); // shrinks overall
    for (let i = 1; i < secs.length; i++) expect(secs[i]).toBeLessThanOrEqual(secs[i - 1]); // monotone non-increasing
    expect(fleetEtas.length).toBeGreaterThanOrEqual(3);

    // REST first-paint: the order tracking read carries the persisted range.
    const tracking = (await get(`/v1/orders/${sc.orderId}/tracking`, 'rita').expect(200)).body;
    expect(typeof tracking.stop.eta).toBe('string');
    expect(typeof tracking.stop.etaLow).toBe('string');
    expect(typeof tracking.stop.etaHigh).toBe('string');
    expect(typeof tracking.stop.etaComputedAt).toBe('string');
    expect(Date.parse(tracking.stop.etaLow)).toBeLessThanOrEqual(Date.parse(tracking.stop.etaHigh));

    // …and GET /fleet/live carries each vehicle's next-stop ETA.
    const fleetLive = (await get('/v1/fleet/live', 'owner').expect(200)).body;
    const mine = fleetLive.vehicles.find((v: { vehicleId: string }) => v.vehicleId === sc.vehicleId);
    expect(mine.nextStopEta).not.toBeNull();
    expect(mine.nextStopEta.stopId).toBe(sc.stopId);
  });

  // ───────────── DoD geofence — approaching once, arrived once, idempotent, scoped ─────────────

  it('fires APPROACHING once on entering the radius and ARRIVED once at the tight radius (idempotent, no re-fire)', async () => {
    const sc = await freshScenario();
    const cust = connect('/live/vehicle', { token: await channelTokenFor(sc.orderId) });
    await waitConnect(cust);
    const geos = collect<{ type: string; stopId: string; vehicleId: string }>(cust, 'geofence');

    // far away: no geofence
    await pingBatch(sc, FAR, ts(1)).expect(200);
    await sleep(250);
    expect(geos.length).toBe(0);

    // enter the 800 m radius → APPROACHING fires exactly once
    const approaching = waitEvent<{ type: string; stopId: string }>(cust, 'geofence', 4000);
    await pingBatch(sc, NEAR, ts(30)).expect(200);
    const appEv = await approaching;
    expect(appEv.type).toBe('APPROACHING');
    expect(appEv.stopId).toBe(sc.stopId);

    // another inside-radius ping (still > arrived radius) → NO second APPROACHING, NO arrived yet
    await expectNoEvent(cust, 'geofence', 1000);
    await pingBatch(sc, INNER, ts(30)).expect(200);
    await sleep(400);
    expect(geos.filter((g) => g.type === 'APPROACHING').length).toBe(1);
    expect(geos.filter((g) => g.type === 'ARRIVED').length).toBe(0);

    // reach the stop → ARRIVED fires exactly once
    const arrived = waitEvent<{ type: string }>(cust, 'geofence', 4000);
    await pingBatch(sc, AT, ts(30)).expect(200);
    expect((await arrived).type).toBe('ARRIVED');

    // replay another at-stop ping → no re-fire (idempotent on the wire)
    await expectNoEvent(cust, 'geofence', 1000);
    await pingBatch(sc, AT, ts(30)).expect(200);
    await sleep(400);

    // durable rows: exactly one APPROACHING + one ARRIVED for the stop
    const rows = await prisma.geofenceEvent.findMany({ where: { routeStopId: sc.stopId }, orderBy: { occurredAt: 'asc' } });
    expect(rows.filter((r) => r.type === 'APPROACHING').length).toBe(1);
    expect(rows.filter((r) => r.type === 'ARRIVED').length).toBe(1);
  });

  // ───────────── DoD geofence — idempotent under CONCURRENT same-vehicle batches ─────────────

  it('concurrent same-vehicle batches inside the radius write exactly one APPROACHING row', async () => {
    const sc = await freshScenario();
    // two concurrent advancing batches, both inside the 800 m radius
    const [r1, r2] = await Promise.all([pingBatch(sc, NEAR, ts(10)), pingBatch(sc, INNER, ts(10))]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    await sleep(300);
    const rows = await prisma.geofenceEvent.findMany({ where: { routeStopId: sc.stopId, type: 'APPROACHING' } });
    expect(rows.length).toBe(1); // the unique (route_stop_id, type) + ON CONFLICT guarantees it
  });

  // ───────────── DoD driver-authority — geofence ARRIVED does NOT transition the §5.4 stop ─────────────

  it('a geofence ARRIVED detection does NOT change the stop status (driver stays authoritative)', async () => {
    const sc = await freshScenario();
    await pingBatch(sc, AT, ts(10)).expect(200);
    await sleep(300);

    const arrivedRow = await prisma.geofenceEvent.findFirst({ where: { routeStopId: sc.stopId, type: 'ARRIVED' } });
    expect(arrivedRow).not.toBeNull(); // the geofence DID detect arrival…

    const stop = await prisma.routeStop.findUniqueOrThrow({ where: { id: sc.stopId } });
    expect(stop.status).toBe('EN_ROUTE'); // …but the §5.4 stop is unchanged (no auto-transition)
    expect(stop.arrivedAt).toBeNull();
  });

  // ───────────── DoD privacy — cross-org receives no ETA/geofence ─────────────

  it('a different-org owner on /live/fleet receives no ETA and no geofence for this org', async () => {
    const sc = await freshScenario();
    const cust = connect('/live/vehicle', { token: await channelTokenFor(sc.orderId) });
    const org2 = connect('/live/fleet', { token: token.org2owner });
    await Promise.all([waitConnect(cust), waitConnect(org2)]);

    const custEta = waitEvent(cust, 'eta', 4000);
    const org2NoEta = expectNoEvent(org2, 'eta', 1500);
    const org2NoGeo = expectNoEvent(org2, 'geofence', 1500);

    await pingBatch(sc, NEAR, ts(10)).expect(200); // inside radius → eta + approaching emitted (org1 only)

    await custEta; // the owning customer DOES receive its ETA
    await org2NoEta; // the other org receives nothing
    await org2NoGeo;
  });

  // ───────────── DoD degradation — an estimator/geofence throw never fails the ingest ─────────────

  it('an estimator throw and a geofence throw are swallowed — POST /locations:batch still succeeds', async () => {
    const sc = await freshScenario();
    const cust = connect('/live/vehicle', { token: await channelTokenFor(sc.orderId) });
    await waitConnect(cust);

    // (1) estimator throws → ingest still 200, last-known still advanced, no eta emitted.
    //     mockImplementationOnce (not mockRejectedValueOnce) so the spy reverts to the REAL impl
    //     after the single throw — letting steps (2) + recovery exercise the live path.
    const estimator = app.get(PostgisEtaEstimator);
    const estSpy = jest.spyOn(estimator, 'estimate').mockImplementationOnce(async () => {
      throw new Error('boom-estimator');
    });
    const noEta = expectNoEvent(cust, 'eta', 1200);
    const res1 = await pingBatch(sc, MID, ts(10)).expect(200);
    expect(res1.body.lastKnownUpdated).toBe(true); // ingestion path unaffected
    await noEta;
    expect(estSpy).toHaveBeenCalledTimes(1);

    // (2) geofence throws → ingest still 200 (eta still emits; only the geofence eval fails)
    const geofence = app.get(GeofenceService);
    const geoSpy = jest.spyOn(geofence, 'evaluate').mockImplementationOnce(async () => {
      throw new Error('boom-geofence');
    });
    const res2 = await pingBatch(sc, NEAR, ts(10)).expect(200);
    expect(res2.body.lastKnownUpdated).toBe(true);
    expect(geoSpy).toHaveBeenCalledTimes(1);

    // recovery: with the spies consumed, a fresh advance emits an ETA again
    const recovered = waitEvent<{ stopId: string }>(cust, 'eta', 4000);
    await pingBatch(sc, INNER, ts(10)).expect(200);
    expect((await recovered).stopId).toBe(sc.stopId);

    estSpy.mockRestore();
    geoSpy.mockRestore();
  });
});
