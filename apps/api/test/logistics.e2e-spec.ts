import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001';
const SITE_EAST = 'f1000000-0000-4000-8000-000000000002';
const SITE_WEST = 'f1000000-0000-4000-8000-000000000003';
const ORDER_O2 = 'e0000000-0000-4000-8000-0000000000c1'; // Org-2 order (cross-org target)
const DEPOT = { lng: -79.3839, lat: 43.6534 }; // downtown Toronto

const PHONES = {
  owner: '+14165550001',
  dispatcher: '+14165550002',
  csr: '+14165550003',
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
  driver1: '+14165550006',
  driver2: '+14165550007',
  org2owner: '+14165559001',
};

describe('Logistics e2e — Increment 4 (Route/RouteStop backbone · §5.4 · §6.3 · §17.3)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const userId: Record<string, string> = {};
  let vehicleId: string;
  let driver1Id: string;
  let driver2Id: string;

  const ROUTE_DATE = '2026-07-01';
  const win = () => ({ start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 3 * 3600_000).toISOString() });

  const post = (path: string, who: string, body: unknown = {}, key?: string) => {
    let req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`);
    if (key) req = req.set('Idempotency-Key', key);
    return req.send(body as object);
  };
  const patch = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

  async function bookOrder(siteId: string, who = 'owner'): Promise<string> {
    const res = await post('/v1/orders', who, { accountId: ACCOUNT_A, siteId, pickupWindow: win(), items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }] }).expect(201);
    return res.body.id as string;
  }

  async function createRoute(withDepot = true): Promise<string> {
    const res = await post('/v1/routes', 'dispatcher', { date: ROUTE_DATE, ...(withDepot ? { startGeo: DEPOT } : {}) }).expect(201);
    return res.body.id as string;
  }

  /** Find-or-create a driver for a seeded user (Driver.userId is unique → idempotent across runs). */
  async function ensureDriver(uid: string): Promise<string> {
    const existing = await prisma.driver.findUnique({ where: { userId: uid } });
    if (existing) return existing.id;
    const res = await post('/v1/drivers', 'dispatcher', { userId: uid }).expect(201);
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
    const v = await post('/v1/vehicles', 'dispatcher', { label: 'Cube Van 1', capacity: 20, plate: 'BEE-001' }).expect(201);
    vehicleId = v.body.id;
    driver1Id = await ensureDriver(userId.driver1);
    driver2Id = await ensureDriver(userId.driver2);
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  // ───────────── DoD #1 — create route, add stops, assign, optimize (reorder), publish ─────────────

  it('creates a route, adds 3 stops, assigns, optimizes (real PostGIS reorder), publishes', async () => {
    const routeId = await createRoute(true);
    const oWest = await bookOrder(SITE_WEST);
    const oEast = await bookOrder(SITE_EAST);
    const oNorth = await bookOrder(SITE_NORTH);
    // add in a deliberately non-optimal order: West, East, North (no time windows → pure distance reorder)
    await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId: oWest }).expect(201);
    await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId: oEast }).expect(201);
    await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId: oNorth }).expect(201);

    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);

    const before = (await get(`/v1/routes/${routeId}`, 'dispatcher').expect(200)).body.stops.map((s: { siteId: string }) => s.siteId);
    expect(before).toEqual([SITE_WEST, SITE_EAST, SITE_NORTH]);

    const optimized = (await post(`/v1/routes/${routeId}/optimize`, 'dispatcher', {}).expect(200)).body;
    const after = optimized.stops.map((s: { siteId: string }) => s.siteId);
    expect(optimized.optimized).toBe(true);
    expect(after[0]).toBe(SITE_NORTH); // nearest the downtown depot
    expect(after).not.toEqual(before); // real reordering happened

    const published = (await post(`/v1/routes/${routeId}/publish`, 'dispatcher', {}).expect(200)).body;
    expect(published.status).toBe('PUBLISHED');
    // publishing scheduled each pickup: orders advanced REQUESTED → SCHEDULED_PICKUP
    const o = (await get(`/v1/orders/${oNorth}`, 'owner').expect(200)).body;
    expect(o.status).toBe('SCHEDULED_PICKUP');
  });

  // ───────────── DoD #2 — walk a pickup stop; order advances SCHEDULED_PICKUP→PICKUP_EN_ROUTE→PICKED_UP ─────────────

  it('walks a pickup stop PENDING→…→COMPLETED and drives the order to PICKED_UP (custody + audit)', async () => {
    const routeId = await createRoute(true);
    const orderId = await bookOrder(SITE_NORTH);
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher', {}).expect(200);

    const dep = (await post(`/v1/route-stops/${stop.id}:depart`, 'dispatcher', {}).expect(200)).body;
    expect(dep.status).toBe('EN_ROUTE');
    expect((await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body.status).toBe('PICKUP_EN_ROUTE');

    await post(`/v1/route-stops/${stop.id}:arrive`, 'dispatcher', {}).expect(200);
    const started = (await post(`/v1/route-stops/${stop.id}:start`, 'dispatcher', {}).expect(200)).body;
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.route.status).toBe('IN_PROGRESS'); // route bumped on first start

    const done = (await post(`/v1/route-stops/${stop.id}:complete`, 'dispatcher', {}).expect(200)).body;
    expect(done.status).toBe('COMPLETED');
    const order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('PICKED_UP');
    expect(order.items[0].custodyEvents.some((c: { stage: string }) => c.stage === 'PICKED_UP')).toBe(true);
    // audit: order STATUS_TRANSITION to PICKED_UP recorded
    const audit = await prisma.auditLog.findFirst({ where: { entity: 'Order', entityId: orderId, action: 'STATUS_TRANSITION', after: { path: ['status'], equals: 'PICKED_UP' } } });
    expect(audit).toBeTruthy();
  });

  // ───────────── DoD #3 — illegal transition + reason codes required ─────────────

  it('rejects an illegal stop transition (PENDING→COMPLETED) and enforces reason on fail/skip', async () => {
    const routeId = await createRoute(false);
    const orderId = await bookOrder(SITE_EAST);
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher', {}).expect(200);

    const illegal = await post(`/v1/route-stops/${stop.id}:complete`, 'dispatcher', {}).expect(409); // PENDING→COMPLETED
    expect(illegal.headers['content-type']).toContain('application/problem+json');
    expect(illegal.body.title).toBe('illegal_stop_transition');

    // fail/skip without a reason → 400 (validation); with a reason → succeeds + persists exceptionReason
    await post(`/v1/route-stops/${stop.id}:skip`, 'dispatcher', {}).expect(400);
    const skipped = (await post(`/v1/route-stops/${stop.id}:skip`, 'dispatcher', { reason: 'CUSTOMER_NOT_HOME' }).expect(200)).body;
    expect(skipped.status).toBe('SKIPPED');
    const row = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } });
    expect(row.exceptionReason).toBe('CUSTOMER_NOT_HOME');
  });

  // ───────────── DoD #4 — PATCH reassign to another driver + resequence ─────────────

  it('PATCH reassigns a stop to another route/driver and resequences (audited)', async () => {
    const route1 = await createRoute(false);
    const route2 = await createRoute(false);
    await post(`/v1/routes/${route2}/assign`, 'dispatcher', { driverId: driver2Id, vehicleId }).expect(200);
    const oA = await bookOrder(SITE_NORTH);
    const oB = await bookOrder(SITE_EAST);
    const sA = (await post(`/v1/routes/${route1}/stops`, 'dispatcher', { orderId: oA }).expect(201)).body;
    const sB = (await post(`/v1/routes/${route1}/stops`, 'dispatcher', { orderId: oB }).expect(201)).body;
    expect(sA.seq).toBe(1);
    expect(sB.seq).toBe(2);

    // reassign sA to route2 (driver2)
    const moved = (await patch(`/v1/route-stops/${sA.id}`, 'dispatcher', { routeId: route2 }).expect(200)).body;
    expect(moved.routeId).toBe(route2);
    const reassignAudit = await prisma.auditLog.findFirst({ where: { entity: 'RouteStop', entityId: sA.id, action: 'STOP_REASSIGNED' } });
    expect(reassignAudit).toBeTruthy();

    // resequence sB to position 1 on route1 (it was the only one left, stays 1; add another to prove move)
    const oC = await bookOrder(SITE_WEST);
    const sC = (await post(`/v1/routes/${route1}/stops`, 'dispatcher', { orderId: oC }).expect(201)).body;
    await patch(`/v1/route-stops/${sC.id}`, 'dispatcher', { seq: 1 }).expect(200);
    const r1 = (await get(`/v1/routes/${route1}`, 'dispatcher').expect(200)).body;
    expect(r1.stops.map((s: { id: string }) => s.id)).toEqual([sC.id, sB.id]); // sC moved to front
  });

  // ───────────── DoD #5 — manifest ─────────────

  it('generates a stop manifest listing the expected items for the pickup', async () => {
    const routeId = await createRoute(false);
    const orderId = await bookOrder(SITE_NORTH);
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    const manifest = (await post(`/v1/route-stops/${stop.id}/manifest`, 'dispatcher', {}).expect(201)).body;
    expect(manifest.lines[0].orderId).toBe(orderId);
    expect(manifest.lines[0].expectedItemCount).toBe(1);
    expect(manifest.lines[0].expectedItems[0].kind).toBe('RUG');
    expect(manifest.lines[0].expectedItems[0].tagCode).toMatch(/^BB-/);
  });

  // ───────────── DoD #6 — RBAC + cross-org + stop↔order parent-ownership ─────────────

  it('RBAC: CSR cannot build/publish; cross-org cannot read; stop cannot attach to an out-of-scope order', async () => {
    // CSR cannot create or publish a route (build/assign routes = OWNER/DISPATCHER)
    const csrCreate = await post('/v1/routes', 'csr', { date: ROUTE_DATE }).expect(403);
    expect(csrCreate.body.title).toBe('forbidden_role');

    const routeId = await createRoute(false);
    await post(`/v1/routes/${routeId}/publish`, 'csr', {}).expect(403);

    // a different org cannot read this org's route
    await get(`/v1/routes/${routeId}`, 'org2owner').expect(404);
    const org2list = (await get('/v1/routes', 'org2owner').expect(200)).body;
    expect(org2list.routes.every((r: { id: string }) => r.id !== routeId)).toBe(true);

    // stop↔order parent-ownership: cannot attach a stop to an order outside the org
    const cross = await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId: ORDER_O2 }).expect(404);
    expect(cross.body.title).toBe('order_not_found');
  });

  // ───────────── shift lifecycle ─────────────

  it('shift lifecycle SCHEDULED→ACTIVE→ENDED; illegal end of a SCHEDULED shift → 409', async () => {
    const shift = (await post('/v1/shifts', 'dispatcher', { driverId: driver1Id, vehicleId }).expect(201)).body;
    expect(shift.status).toBe('SCHEDULED');
    await post(`/v1/shifts/${shift.id}:end`, 'dispatcher', {}).expect(409); // can't end a scheduled shift
    const started = (await post(`/v1/shifts/${shift.id}:start`, 'dispatcher', {}).expect(200)).body;
    expect(started.status).toBe('ACTIVE');
    expect(started.startedAt).toBeTruthy();
    const ended = (await post(`/v1/shifts/${shift.id}:end`, 'dispatcher', {}).expect(200)).body;
    expect(ended.status).toBe('ENDED');
    expect(ended.endedAt).toBeTruthy();
  });

  // ───────────── customer "track my truck" read scoping ─────────────

  it('a customer reads only their own order’s stop status (scoped)', async () => {
    const routeId = await createRoute(false);
    const orderId = await bookOrder(SITE_NORTH);
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    // Rita (Account A owner of this order) can read the stop status...
    const ritaStop = (await get(`/v1/route-stops/${stop.id}`, 'rita').expect(200)).body;
    expect(ritaStop.id).toBe(stop.id);
    // ...and sees it on her order (track-my-truck data)
    const order = (await get(`/v1/orders/${orderId}`, 'rita').expect(200)).body;
    expect(order.routeStops.some((s: { id: string }) => s.id === stop.id)).toBe(true);
    // a different org's user cannot read this stop
    await get(`/v1/route-stops/${stop.id}`, 'org2owner').expect(404);
  });

  // ───────────── concurrency: two concurrent completes → one wins ─────────────

  it('concurrent stop completes: exactly one 200, one 409 (atomic transition)', async () => {
    const routeId = await createRoute(false);
    const orderId = await bookOrder(SITE_EAST);
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher', {}).expect(200);
    await post(`/v1/route-stops/${stop.id}:depart`, 'dispatcher', {}).expect(200);
    await post(`/v1/route-stops/${stop.id}:arrive`, 'dispatcher', {}).expect(200);
    await post(`/v1/route-stops/${stop.id}:start`, 'dispatcher', {}).expect(200);
    const results = await Promise.all([
      post(`/v1/route-stops/${stop.id}:complete`, 'dispatcher', {}),
      post(`/v1/route-stops/${stop.id}:complete`, 'dispatcher', {}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  // ───────────── QC fix: publish idempotent when an order is on two pickup stops ─────────────

  it('publish is idempotent when the same order is on two pickup stops (advances it once)', async () => {
    const routeId = await createRoute(false);
    const orderId = await bookOrder(SITE_NORTH);
    await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201);
    await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201); // same order, 2nd stop
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    const pub = await post(`/v1/routes/${routeId}/publish`, 'dispatcher', {}).expect(200); // would 409-rollback without the dedupe Set
    expect(pub.body.status).toBe('PUBLISHED');
    expect((await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body.status).toBe('SCHEDULED_PICKUP');
  });

  // ───────────── QC fix: a 409 under an Idempotency-Key is not cached ─────────────

  it('a 409 under an Idempotency-Key is NOT cached — a later valid retry with the same key succeeds', async () => {
    const routeId = await createRoute(false);
    const orderId = await bookOrder(SITE_EAST);
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher', {}).expect(200);
    const KEY = `complete-${Date.now()}`;
    await post(`/v1/route-stops/${stop.id}:complete`, 'dispatcher', {}, KEY).expect(409); // PENDING→COMPLETE illegal
    // advance the stop properly, then retry complete with the SAME key
    await post(`/v1/route-stops/${stop.id}:depart`, 'dispatcher', {}).expect(200);
    await post(`/v1/route-stops/${stop.id}:arrive`, 'dispatcher', {}).expect(200);
    await post(`/v1/route-stops/${stop.id}:start`, 'dispatcher', {}).expect(200);
    const done = await post(`/v1/route-stops/${stop.id}:complete`, 'dispatcher', {}, KEY).expect(200); // not the cached 409
    expect(done.body.status).toBe('COMPLETED');
  });

  // ───────────── OpenAPI surface ─────────────

  it('OpenAPI documents the new logistics paths', async () => {
    const paths = Object.keys((await http.get('/v1/docs-json').expect(200)).body.paths);
    expect(paths).toContain('/v1/routes');
    expect(paths).toContain('/v1/route-stops/{id}');
    expect(paths.some((p) => p.includes('route-stops') && p.includes('complete'))).toBe(true);
    expect(paths.some((p) => p.includes('shifts') && p.includes('start'))).toBe(true);
  });
});
