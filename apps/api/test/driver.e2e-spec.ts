import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { DRIVER_ERRORS, RouteStopStatus, ShiftStatus } from '@blue-bee/shared';
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
  vehicleId: string;
  shiftId: string;
  routeId: string;
  stopId: string;
}

/**
 * Increment 9 — the driver-self-scoped duty-loop surface (/v1/driver/*). Proves: a driver reads
 * ONLY their own assignment, starts their own shift, walks a stop through §5.4, hits 409 on an
 * illegal transition, must give a reason to fail/skip, and can NEVER touch another driver's shift/
 * stop (nor can a non-driver reach the surface).
 */
describe('Driver duty loop e2e — Increment 9 (/v1/driver/*)', () => {
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

  async function ensureDriver(uid: string): Promise<string> {
    const existing = await prisma.driver.findUnique({ where: { userId: uid } });
    if (existing) return existing.id;
    return (await post('/v1/drivers', 'dispatcher', { userId: uid }).expect(201)).body.id;
  }

  /** Dispatcher builds a published route assigned to driver1 with one PENDING pickup stop. */
  async function freshScenario(driverId: string): Promise<Scenario> {
    seq += 1;
    const vehicleId = (await post('/v1/vehicles', 'dispatcher', { label: `Drv Van ${seq}`, plate: `DRV-${seq}` }).expect(201)).body.id;
    const shift = (await post('/v1/shifts', 'dispatcher', { driverId, vehicleId }).expect(201)).body;
    const orderId = (
      await post('/v1/orders', 'owner', {
        accountId: ACCOUNT_A,
        siteId: SITE_NORTH,
        pickupWindow: { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() },
        items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }],
      }).expect(201)
    ).body.id;
    const routeId = (await post('/v1/routes', 'dispatcher', { date: '2026-07-15' }).expect(201)).body.id;
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher').expect(200);
    return { vehicleId, shiftId: shift.id, routeId, stopId: stop.id };
  }

  beforeAll(async () => {
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

    // Isolate this run from leftover data on the seeded drivers (the suite reuses driver1/driver2,
    // and `getAssignment` returns the LATEST assignment): terminalize any prior open shifts and
    // unassign any prior workable routes so each test's fresh scenario is unambiguously current.
    await prisma.shift.updateMany({
      where: { driverId: { in: [driver1Id, driver2Id] }, status: { in: [PrismaShiftStatus.SCHEDULED, PrismaShiftStatus.ACTIVE] } },
      data: { status: PrismaShiftStatus.ENDED, endedAt: new Date() },
    });
    await prisma.route.updateMany({
      where: { driverId: { in: [driver1Id, driver2Id] }, status: { in: [PrismaRouteStatus.PUBLISHED, PrismaRouteStatus.IN_PROGRESS] } },
      data: { driverId: null },
    });
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
    await pub.quit();
    await sub.quit();
  });

  it('GET /driver/assignment returns the driver’s own shift + route + ordered stops', async () => {
    const sc = await freshScenario(driver1Id);
    const res = await get('/v1/driver/assignment', 'driver1').expect(200);
    expect(res.body.driverId).toBe(driver1Id);
    expect(res.body.shift?.id).toBe(sc.shiftId);
    expect(res.body.shift?.status).toBe(ShiftStatus.SCHEDULED);
    expect(res.body.route?.id).toBe(sc.routeId);
    const stop = res.body.route.stops.find((s: { id: string }) => s.id === sc.stopId);
    expect(stop).toBeTruthy();
    expect(stop.status).toBe(RouteStopStatus.PENDING);
    expect(stop.lat).toBeCloseTo(43.7615, 2); // joined Site geo (North York)
    expect(stop.lng).toBeCloseTo(-79.4111, 2);
  });

  it('a driver starts their OWN shift (SCHEDULED → ACTIVE); a non-driver is forbidden', async () => {
    const sc = await freshScenario(driver1Id);
    await post(`/v1/driver/shifts/${sc.shiftId}/start`, 'driver1').expect(200);
    const after = await get('/v1/driver/assignment', 'driver1').expect(200);
    expect(after.body.shift.status).toBe(ShiftStatus.ACTIVE);
    // the owner (no DRIVER role) cannot reach the driver surface at all
    await post(`/v1/driver/shifts/${sc.shiftId}/start`, 'owner').expect(403);
  });

  it('walks a stop through §5.4 via /driver/stops; an illegal transition → 409', async () => {
    const sc = await freshScenario(driver1Id);
    await post(`/v1/driver/shifts/${sc.shiftId}/start`, 'driver1').expect(200);

    // illegal first: cannot complete a PENDING stop
    await post(`/v1/driver/stops/${sc.stopId}/complete`, 'driver1').expect(409);

    await post(`/v1/driver/stops/${sc.stopId}/depart`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${sc.stopId}/arrive`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${sc.stopId}/start`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${sc.stopId}/complete`, 'driver1').expect(200);

    const stop = await prisma.routeStop.findUniqueOrThrow({ where: { id: sc.stopId } });
    expect(stop.status).toBe(RouteStopStatus.COMPLETED);
  });

  it('fail/skip require a reason code', async () => {
    const sc = await freshScenario(driver1Id);
    await post(`/v1/driver/stops/${sc.stopId}/fail`, 'driver1', {}).expect(400); // no reason
    await post(`/v1/driver/stops/${sc.stopId}/skip`, 'driver1', { reason: 'rescheduled' }).expect(200);
    const stop = await prisma.routeStop.findUniqueOrThrow({ where: { id: sc.stopId } });
    expect(stop.status).toBe(RouteStopStatus.SKIPPED);
    expect(stop.exceptionReason).toBe('rescheduled');
  });

  it('a driver can NEVER act on another driver’s shift or stop (self-scoped)', async () => {
    const sc = await freshScenario(driver1Id); // assigned to driver1
    // driver2 (a real driver, different profile) is blocked on both the shift and the stop
    await post(`/v1/driver/shifts/${sc.shiftId}/start`, 'driver2').expect(403);
    await post(`/v1/driver/stops/${sc.stopId}/depart`, 'driver2').expect(403);
    // driver1 (the owner) still succeeds
    await post(`/v1/driver/shifts/${sc.shiftId}/start`, 'driver1').expect(200);
    await post(`/v1/driver/stops/${sc.stopId}/depart`, 'driver1').expect(200);
  });

  it('driver2 only ever sees their OWN assignment', async () => {
    await freshScenario(driver1Id); // driver1 has a route
    const res = await get('/v1/driver/assignment', 'driver2').expect(200);
    expect(res.body.driverId).toBe(driver2Id);
    // driver2 must not see driver1's route
    if (res.body.route) {
      const r = await prisma.route.findUniqueOrThrow({ where: { id: res.body.route.id } });
      expect(r.driverId).toBe(driver2Id);
    }
  });

  // ── 2026-09-08 review follow-up — the exact rejection payload + boundary edges the status-code-only
  // checks above don't reach: the DRIVER_ERRORS code actually in the body (not just a bare 403/404
  // status, which would also pass if the code silently changed or went missing), a nonexistent id
  // (404, not a 500 or a silent success), and the driver-scoped weight READ (a separate code path from
  // the §5.4 stop actions above — it must be stop-owned too, not merely role-gated). ──

  it('starting a nonexistent shift is a 404 carrying DRIVER_ERRORS.NOT_OWN_SHIFT, not a 500 or a silent success', async () => {
    const res = await post(`/v1/driver/shifts/${randomUUID()}/start`, 'driver1').expect(404);
    expect(res.body.error ?? res.body.title).toBe(DRIVER_ERRORS.NOT_OWN_SHIFT);
  });

  it('acting on a nonexistent stop is a 404 carrying DRIVER_ERRORS.NOT_OWN_STOP', async () => {
    const res = await post(`/v1/driver/stops/${randomUUID()}/depart`, 'driver1').expect(404);
    expect(res.body.error ?? res.body.title).toBe(DRIVER_ERRORS.NOT_OWN_STOP);
  });

  it('cross-driver rejections carry the DRIVER_ERRORS code in the body, not just a bare 403 status', async () => {
    const sc = await freshScenario(driver1Id);
    const shiftRes = await post(`/v1/driver/shifts/${sc.shiftId}/start`, 'driver2').expect(403);
    expect(shiftRes.body.error ?? shiftRes.body.title).toBe(DRIVER_ERRORS.NOT_OWN_SHIFT);
    const stopRes = await post(`/v1/driver/stops/${sc.stopId}/depart`, 'driver2').expect(403);
    expect(stopRes.body.error ?? stopRes.body.title).toBe(DRIVER_ERRORS.NOT_OWN_STOP);
  });

  it("driver A cannot read driver B's stop weight — the weight READ is stop-owned, not merely role-gated", async () => {
    const sc = await freshScenario(driver1Id);
    // owner reachable + sane on MY stop (nothing weighed yet — this just proves the read is reachable)
    const own = await get(`/v1/driver/stops/${sc.stopId}/weight`, 'driver1').expect(200);
    expect(own.body.authoritativeWeightKg).toBeNull();
    expect(own.body.captures).toEqual([]);
    // driver2 (a real, different driver) cannot read driver1's stop weight
    const res = await get(`/v1/driver/stops/${sc.stopId}/weight`, 'driver2').expect(403);
    expect(res.body.error ?? res.body.title).toBe(DRIVER_ERRORS.NOT_OWN_STOP);
  });

  describe('cross-org isolation (the explicit org_id scoping the service performs on every query)', () => {
    // Deliberately NOT `org2owner` (the org-2 OWNER used elsewhere in this suite as the standard
    // cross-org probe): OWNER has no DRIVER role, so `@Roles(RoleType.DRIVER)` on DriverController would
    // reject them with 403 before the request ever reaches `assertOwnShift`/`requireOwnStop` — proving
    // only the role gate, not the org scoping. A real DRIVER in a different org (org2 has none seeded)
    // is the only way to exercise those org-scoped queries themselves, so this spec mints one.
    const ORG2 = 'e0000000-0000-4000-8000-000000000002';
    let org2DriverUserId: string;

    beforeAll(async () => {
      const user = await prisma.user.create({
        data: { orgId: ORG2, name: 'Driver e2e — org2 cross-org probe', phone: '+14165559099', status: 'ACTIVE', authProviders: ['otp'] },
      });
      org2DriverUserId = user.id;
      await prisma.userRole.create({ data: { orgId: ORG2, userId: user.id, role: 'DRIVER', scope: 'ORG' } });
      const vehicle = await prisma.vehicle.create({ data: { orgId: ORG2, label: 'Org2 Cross-org Van' } });
      await prisma.driver.create({ data: { orgId: ORG2, userId: user.id, defaultVehicleId: vehicle.id } });

      const tokens = app.get(TokenService);
      const principals = app.get(PrincipalService);
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token.org2Driver = tokens.signAccess(user, roles, scope);
    }, 30000);

    afterAll(async () => {
      await prisma.user.delete({ where: { id: org2DriverUserId } }); // cascades the UserRole + Driver rows
    });

    it("a real DRIVER in a DIFFERENT org cannot start org-1's shift by id (404 — the row is invisible, not merely forbidden)", async () => {
      const sc = await freshScenario(driver1Id);
      const res = await post(`/v1/driver/shifts/${sc.shiftId}/start`, 'org2Driver').expect(404);
      expect(res.body.error ?? res.body.title).toBe(DRIVER_ERRORS.NOT_OWN_SHIFT);
    });

    it("a real DRIVER in a DIFFERENT org cannot act on org-1's stop by id (404)", async () => {
      const sc = await freshScenario(driver1Id);
      const res = await post(`/v1/driver/stops/${sc.stopId}/depart`, 'org2Driver').expect(404);
      expect(res.body.error ?? res.body.title).toBe(DRIVER_ERRORS.NOT_OWN_STOP);
    });
  });
});
