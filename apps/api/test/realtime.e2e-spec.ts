import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import type Redis from 'ioredis';
import { createRealtimeTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001';
const CHANNEL_SECRET = process.env.CHANNEL_TOKEN_SECRET as string;

const PHONES = {
  owner: '+14165550001',
  dispatcher: '+14165550002',
  rita: '+14165550010',
  driver1: '+14165550006',
  driver2: '+14165550007',
  org2owner: '+14165559001',
};
const COORD = { a: { lat: 43.6534, lng: -79.3839 }, b: { lat: 43.7615, lng: -79.4111 }, c: { lat: 43.7731, lng: -79.2318 } };

describe('Realtime e2e — Increment 6 (Socket.IO scoped channels + signed per-vehicle token)', () => {
  let app: INestApplication;
  let port: number;
  let pub: Redis;
  let sub: Redis;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  let vehicleId: string;
  let vehicle2Id: string;
  let driver1Id: string;
  let driver2Id: string;
  let shift1: string; // driver1 + vehicleId (active)
  let shift2: string; // driver2 + vehicle2Id (active)
  const openSockets: Socket[] = [];

  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const patch = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const ping = (c: { lat: number; lng: number }, recordedAt: string) => ({ ...c, recordedAt });

  // ── WS client helpers ──
  function connect(namespace: string, auth: Record<string, unknown>): Socket {
    const socket = io(`http://localhost:${port}${namespace}`, {
      auth,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: 5000,
    });
    openSockets.push(socket);
    return socket;
  }
  const waitConnect = (s: Socket) =>
    new Promise<void>((res, rej) => {
      s.once('connect', () => res());
      s.once('connect_error', (e: Error) => rej(e));
    });
  const waitConnectError = (s: Socket) =>
    new Promise<Error>((res, rej) => {
      s.once('connect_error', (e: Error) => res(e));
      s.once('connect', () => rej(new Error('unexpectedly connected')));
    });
  const waitEvent = <T = unknown>(s: Socket, event: string, ms = 3000) =>
    new Promise<T>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${event}`)), ms);
      s.once(event, (p: T) => {
        clearTimeout(t);
        res(p);
      });
    });
  const expectNoEvent = (s: Socket, event: string, ms = 900) =>
    new Promise<void>((res, rej) => {
      const t = setTimeout(() => res(), ms);
      s.once(event, (p: unknown) => {
        clearTimeout(t);
        rej(new Error(`unexpected ${event}: ${JSON.stringify(p)}`));
      });
    });
  const collect = (s: Socket, event: string): unknown[] => {
    const arr: unknown[] = [];
    s.on(event, (p: unknown) => arr.push(p));
    return arr;
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function ensureDriver(uid: string): Promise<string> {
    const existing = await prisma.driver.findUnique({ where: { userId: uid } });
    if (existing) return existing.id;
    return (await post('/v1/drivers', 'dispatcher', { userId: uid }).expect(201)).body.id;
  }
  async function startedShift(driverId: string, vid: string): Promise<string> {
    const s = (await post('/v1/shifts', 'dispatcher', { driverId, vehicleId: vid }).expect(201)).body;
    await post(`/v1/shifts/${s.id}:start`, 'dispatcher').expect(200);
    return s.id;
  }
  /** Book an Account-A order, route it to driver1+vehicle, publish, depart → active pickup stop. */
  async function activeStop(): Promise<{ orderId: string; stopId: string }> {
    const orderId = (
      await post('/v1/orders', 'owner', {
        accountId: ACCOUNT_A,
        siteId: SITE_NORTH,
        pickupWindow: { start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 7200_000).toISOString() },
        items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }],
      }).expect(201)
    ).body.id;
    const routeId = (await post('/v1/routes', 'dispatcher', { date: '2026-07-04' }).expect(201)).body.id;
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher').expect(200);
    await post(`/v1/route-stops/${stop.id}:depart`, 'dispatcher').expect(200);
    return { orderId, stopId: stop.id };
  }
  const channelTokenFor = async (orderId: string, who = 'rita'): Promise<string> =>
    (await get(`/v1/orders/${orderId}/tracking`, who).expect(200)).body.channelToken;

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
    vehicleId = (await post('/v1/vehicles', 'dispatcher', { label: 'RT Van 1', plate: 'RT-1' }).expect(201)).body.id;
    vehicle2Id = (await post('/v1/vehicles', 'dispatcher', { label: 'RT Van 2', plate: 'RT-2' }).expect(201)).body.id;
    driver1Id = await ensureDriver((await get('/v1/me', 'driver1').expect(200)).body.user.userId);
    driver2Id = await ensureDriver((await get('/v1/me', 'driver2').expect(200)).body.user.userId);
    shift1 = await startedShift(driver1Id, vehicleId);
    shift2 = await startedShift(driver2Id, vehicle2Id);
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

  // ───────────── DoD #1 — fleet channel streams; cross-org sees nothing ─────────────

  it('OWNER on /live/fleet receives live positions; a different-org owner receives nothing', async () => {
    const ownerSock = connect('/live/fleet', { token: token.owner });
    const org2Sock = connect('/live/fleet', { token: token.org2owner });
    await Promise.all([waitConnect(ownerSock), waitConnect(org2Sock)]);

    const ownerPos = waitEvent<{ vehicleId: string }>(ownerSock, 'position', 4000);
    const org2None = expectNoEvent(org2Sock, 'position', 1500);

    await post('/v1/locations:batch', 'driver1', { shiftId: shift1, vehicleId, pings: [ping(COORD.a, new Date().toISOString())] }).expect(200);

    expect((await ownerPos).vehicleId).toBe(vehicleId);
    await org2None; // org2 owner is in its OWN fleet room → never receives org1's positions
  });

  // ───────────── DoD #2 — customer mint + stream; one vehicle only; no fleet ─────────────

  it('GET /orders/:id/tracking mints a token; /live/vehicle streams ONLY that vehicle; no fleet, no other vehicle', async () => {
    const { orderId } = await activeStop();
    const channelToken = await channelTokenFor(orderId);
    expect(typeof channelToken).toBe('string');

    const cust = connect('/live/vehicle', { token: channelToken });
    await waitConnect(cust);

    const custPos = waitEvent<{ vehicleId: string }>(cust, 'position', 4000);
    await post('/v1/locations:batch', 'driver1', { shiftId: shift1, vehicleId, pings: [ping(COORD.b, new Date().toISOString())] }).expect(200);
    expect((await custPos).vehicleId).toBe(vehicleId);

    // the customer cannot use the channel token on the fleet namespace (JWT verify fails)
    const fleetAttempt = connect('/live/fleet', { token: channelToken });
    const err = await waitConnectError(fleetAttempt);
    expect(err.message).toBeTruthy();

    // a position for a DIFFERENT vehicle is never delivered to this customer
    const noOther = expectNoEvent(cust, 'position', 1200);
    await post('/v1/locations:batch', 'driver2', { shiftId: shift2, vehicleId: vehicle2Id, pings: [ping(COORD.c, new Date().toISOString())] }).expect(200);
    await noOther;
  });

  // ───────────── DoD #3 — token security ─────────────

  it('rejects expired, forged, and cross-vehicle tokens; tears down on stop completion', async () => {
    const { orderId, stopId } = await activeStop();
    const validToken = await channelTokenFor(orderId);
    const signer = new JwtService({});
    const claims = (vehicle: string) => ({ kind: 'vehicle-tracking', org_id: ORG, vehicle_id: vehicle, order_id: orderId, stop_id: stopId, sub: 'x' });

    // expired (valid signature, exp in the past)
    const expired = signer.sign(claims(vehicleId), { secret: CHANNEL_SECRET, expiresIn: -10, algorithm: 'HS256' });
    expect((await waitConnectError(connect('/live/vehicle', { token: expired }))).message).toBeTruthy();

    // forged (wrong secret)
    const forged = signer.sign(claims(vehicleId), { secret: 'a-different-secret-that-is-at-least-32-chars-long', expiresIn: 600, algorithm: 'HS256' });
    expect((await waitConnectError(connect('/live/vehicle', { token: forged }))).message).toBeTruthy();

    // cross-vehicle: signed for vehicle2 but the stop's route points at vehicleId → live re-check rejects
    const crossVehicle = signer.sign(claims(vehicle2Id), { secret: CHANNEL_SECRET, expiresIn: 600, algorithm: 'HS256' });
    expect((await waitConnectError(connect('/live/vehicle', { token: crossVehicle }))).message).toBe('stop_not_active');

    // valid token connects, then the stop completes → channel:closed + disconnect + cannot reconnect
    const cust = connect('/live/vehicle', { token: validToken });
    await waitConnect(cust);
    const closed = waitEvent<{ reason: string }>(cust, 'channel:closed', 4000);
    const disconnected = waitEvent(cust, 'disconnect', 4000);

    await post(`/v1/route-stops/${stopId}:arrive`, 'dispatcher').expect(200);
    await post(`/v1/route-stops/${stopId}:start`, 'dispatcher').expect(200);
    await post(`/v1/route-stops/${stopId}:complete`, 'dispatcher').expect(200);

    expect((await closed).reason).toBe('stop_completed');
    await disconnected;

    // reconnect with the same (still-signature-valid) token now fails the live stop re-check
    expect((await waitConnectError(connect('/live/vehicle', { token: validToken }))).message).toBe('stop_not_active');
  });

  // ───────────── QC fix — reassigning an actively-tracked stop to a different vehicle closes the channel ─────────────

  it('reassigning the stop to a different-vehicle route tears down the customer channel (no stale-vehicle leak)', async () => {
    const orderId = (
      await post('/v1/orders', 'owner', {
        accountId: ACCOUNT_A,
        siteId: SITE_NORTH,
        pickupWindow: { start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 7200_000).toISOString() },
        items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }],
      }).expect(201)
    ).body.id;
    const routeA = (await post('/v1/routes', 'dispatcher', { date: '2026-07-06' }).expect(201)).body.id;
    const stop = (await post(`/v1/routes/${routeA}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeA}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeA}/publish`, 'dispatcher').expect(200);
    await post(`/v1/route-stops/${stop.id}:depart`, 'dispatcher').expect(200);

    const cust = connect('/live/vehicle', { token: await channelTokenFor(orderId) });
    await waitConnect(cust);
    const closed = waitEvent<{ reason: string }>(cust, 'channel:closed', 4000);
    const disconnected = waitEvent(cust, 'disconnect', 4000);

    // move the stop onto routeB, which points at a DIFFERENT vehicle
    const routeB = (await post('/v1/routes', 'dispatcher', { date: '2026-07-06' }).expect(201)).body.id;
    await post(`/v1/routes/${routeB}/assign`, 'dispatcher', { driverId: driver2Id, vehicleId: vehicle2Id }).expect(200);
    await patch(`/v1/route-stops/${stop.id}`, 'dispatcher', { routeId: routeB }).expect(200);

    expect((await closed).reason).toBe('stop_reassigned');
    await disconnected; // the customer no longer streams the old (now-unassigned) vehicle
  });

  // ───────────── DoD #4 — publish correctness (monotonic, no storm) ─────────────

  it('pushes only on a genuine advance: out-of-order older ping yields no push; a multi-ping batch emits once', async () => {
    const { orderId } = await activeStop();
    const cust = connect('/live/vehicle', { token: await channelTokenFor(orderId) });
    await waitConnect(cust);

    // establish a newest position
    const base = Date.now();
    const first = waitEvent<{ recordedAt: string }>(cust, 'position', 4000);
    await post('/v1/locations:batch', 'driver1', { shiftId: shift1, vehicleId, pings: [ping(COORD.b, new Date(base).toISOString())] }).expect(200);
    await first;

    // an OLDER ping must NOT push (no regression)
    const noRegression = expectNoEvent(cust, 'position', 1200);
    await post('/v1/locations:batch', 'driver1', { shiftId: shift1, vehicleId, pings: [ping(COORD.a, new Date(base - 60_000).toISOString())] }).expect(200);
    await noRegression;

    // a 3-ping batch advances last-known ONCE → exactly one emit (no storm)
    const received = collect(cust, 'position');
    await post('/v1/locations:batch', 'driver1', {
      shiftId: shift1,
      vehicleId,
      pings: [ping(COORD.a, new Date(base + 10_000).toISOString()), ping(COORD.c, new Date(base + 30_000).toISOString()), ping(COORD.b, new Date(base + 20_000).toISOString())],
    }).expect(200);
    await sleep(1000);
    expect(received.length).toBe(1);
    expect((received[0] as { recordedAt: string }).recordedAt).toBe(new Date(base + 30_000).toISOString()); // the newest
  });

  // ───────────── DoD #5 — shift-gating end-to-end (no emit outside an active shift) ─────────────

  it('a ping to an ended shift is rejected and emits nothing on the fleet channel', async () => {
    const ownerSock = connect('/live/fleet', { token: token.owner });
    await waitConnect(ownerSock);
    const none = expectNoEvent(ownerSock, 'position', 1500);

    const ended = (await post('/v1/shifts', 'dispatcher', { driverId: driver1Id, vehicleId }).expect(201)).body;
    await post(`/v1/shifts/${ended.id}:start`, 'dispatcher').expect(200);
    await post(`/v1/shifts/${ended.id}:end`, 'dispatcher').expect(200);
    await post('/v1/locations:batch', 'driver1', { shiftId: ended.id, vehicleId, pings: [ping(COORD.a, new Date().toISOString())] }).expect(409);

    await none; // rejected ingest → no publish
  });

  // ───────────── DoD #6 — graceful degradation (REST still source of truth) ─────────────

  it('with no socket, REST last-known + tracking still serve (degradation)', async () => {
    await post('/v1/locations:batch', 'driver1', { shiftId: shift1, vehicleId, pings: [ping(COORD.c, new Date().toISOString())] }).expect(200);
    const fleet = (await get('/v1/fleet/live', 'owner').expect(200)).body;
    expect(fleet.vehicles.some((v: { vehicleId: string }) => v.vehicleId === vehicleId)).toBe(true);
    const { orderId } = await activeStop();
    const tracking = (await get(`/v1/orders/${orderId}/tracking`, 'rita').expect(200)).body;
    expect(tracking.vehicle.vehicleId).toBe(vehicleId);
    expect(typeof tracking.channelToken).toBe('string');
  });

  // ───────────── lifecycle: shift end disconnects the customer channel ─────────────

  it('ending the shift closes the customer channel for that vehicle (no leak after off-duty)', async () => {
    const { orderId } = await activeStop();
    const cust = connect('/live/vehicle', { token: await channelTokenFor(orderId) });
    await waitConnect(cust);
    const closed = waitEvent<{ reason: string }>(cust, 'channel:closed', 4000);
    const disconnected = waitEvent(cust, 'disconnect', 4000);

    await post(`/v1/shifts/${shift1}:end`, 'dispatcher').expect(200);

    expect((await closed).reason).toBe('shift_ended');
    await disconnected;
    // restart the shift so later-running tests (if any) keep an active shift
    shift1 = await startedShift(driver1Id, vehicleId);
  });
});
