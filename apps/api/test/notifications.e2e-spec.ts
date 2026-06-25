import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type Redis from 'ioredis';
import { CommsChannel, NotificationStatus } from '@blue-bee/shared';
import { createRealtimeTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { NOTIFICATION_TRANSPORTS, type TransportRegistry } from '../src/notifications/transports/notification-transport';
import { SmsNotificationTransport } from '../src/notifications/transports/sms.transport';
import { NotificationService, type GeofenceNotification } from '../src/notifications/notification.service';
import { NotificationProcessor } from '../src/notifications/notification-processor.service';
import { localMinutesOfDay } from '../src/notifications/quiet-hours';

const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001'; // North York — geo {43.7615,-79.4111}

const PHONES = {
  owner: '+14165550001',
  dispatcher: '+14165550002',
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A (owns the order)
  driver1: '+14165550006',
  accountBadmin: '+14165550020', // ACCOUNT_ADMIN, Account B (same org, DIFFERENT account)
  org2owner: '+14165559001', // OWNER in a different org
};

const SITE = { lat: 43.7615, lng: -79.4111 };
const FAR = { lat: 43.6534, lng: -79.3839 }; // ~13.5 km — outside everything
const NEAR = { lat: 43.755, lng: -79.4111 }; // ~723 m — inside 800 m (approaching), outside 100 m
const AT = { lat: 43.7615, lng: -79.4111 }; // the stop — 0 m (arrived)

interface Scenario {
  vehicleId: string;
  shiftId: string;
  orderId: string;
  stopId: string;
}

describe('Notifications e2e — Increment 8 (matrix-driven engine + outbox + transports)', () => {
  let app: INestApplication;
  let pub: Redis;
  let sub: Redis;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const userId: Record<string, string> = {};
  let driver1Id: string;
  let ritaOrgId: string;
  let vehSeq = 0;

  // Monotonic clock so every ping is strictly newer (Lua-CAS always advances).
  let clockMs = Date.now();
  const ts = (stepSec: number): string => {
    clockMs += Math.max(1, stepSec) * 1000;
    return new Date(clockMs).toISOString();
  };

  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const del = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const pingBatch = (s: Scenario, c: { lat: number; lng: number }, recordedAt: string) =>
    post('/v1/locations:batch', 'driver1', { shiftId: s.shiftId, vehicleId: s.vehicleId, pings: [{ ...c, recordedAt }] });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Sending is off the request thread (kick disabled in tests) — drive the real processor drain
  // explicitly so SENT assertions are deterministic. drainDue claims each row atomically.
  const drain = () => app.get(NotificationProcessor).drainDue();
  const rowsForSource = (sourceId: string) =>
    prisma.notification.findMany({ where: { sourceId }, orderBy: { channel: 'asc' } });
  const rowsForStopEvent = async (stopId: string, kind: 'APPROACHING' | 'ARRIVED') => {
    const ev = await prisma.geofenceEvent.findFirst({ where: { routeStopId: stopId, type: kind } });
    return ev ? rowsForSource(ev.id) : [];
  };

  async function ensureDriver(uid: string): Promise<string> {
    const existing = await prisma.driver.findUnique({ where: { userId: uid } });
    if (existing) return existing.id;
    return (await post('/v1/drivers', 'dispatcher', { userId: uid }).expect(201)).body.id;
  }

  async function freshScenario(): Promise<Scenario> {
    vehSeq += 1;
    const vehicleId = (await post('/v1/vehicles', 'dispatcher', { label: `Notif Van ${vehSeq}`, plate: `NTF-${vehSeq}` }).expect(201)).body.id;
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
      if (name === 'rita') ritaOrgId = user.orgId;
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
    driver1Id = await ensureDriver(userId.driver1);
  }, 60000);

  afterEach(async () => {
    // keep rita's preference + device-token state from leaking across cases
    await prisma.notificationPreference.deleteMany({ where: { userId: userId.rita } });
  });

  afterAll(async () => {
    await prisma.deviceToken.deleteMany({ where: { userId: userId.rita } });
    await prisma.notificationPreference.deleteMany({ where: { userId: userId.rita } });
    await prisma.$disconnect();
    await app.close();
    await pub.quit();
    await sub.quit();
  });

  // ───────────── the seam holds three real transports ─────────────

  it('binds three real transports (SMS reuses Inc-2, email, push) behind the registry — no mock client', () => {
    const registry = app.get<TransportRegistry>(NOTIFICATION_TRANSPORTS);
    expect(registry.get(CommsChannel.SMS)?.name).toMatch(/^sms:/); // reuses the Increment-2 SMS_TRANSPORT
    expect(registry.get(CommsChannel.EMAIL)?.name).toMatch(/^email:/);
    expect(registry.get(CommsChannel.PUSH)?.name).toMatch(/^push:/);
  });

  // ───────────── DoD: approaching → owning customer gets SMS+email+push, once, idempotent ─────────────

  it('APPROACHING → owning customer gets SMS+email+push (all SENT), exactly once + outbox-idempotent', async () => {
    const sc = await freshScenario();
    // register a push token so PUSH has a destination
    await post('/v1/device-tokens', 'rita', { token: `ExponentPushToken[rita-${vehSeq}]`, platform: 'IOS' }).expect(201);

    await pingBatch(sc, FAR, ts(1)).expect(200); // far — no geofence, no notifications
    await pingBatch(sc, NEAR, ts(60)).expect(200); // enter 800 m → APPROACHING (rows enqueued)
    await drain(); // deliver the due rows (off-thread in prod; explicit here)

    const rows = await rowsForStopEvent(sc.stopId, 'APPROACHING');
    expect(rows.map((r) => r.channel).sort()).toEqual([CommsChannel.EMAIL, CommsChannel.PUSH, CommsChannel.SMS]);
    for (const r of rows) {
      expect(r.userId).toBe(userId.rita);
      expect(r.status).toBe(NotificationStatus.SENT);
      expect(r.sentAt).not.toBeNull();
      expect(r.eventType).toBe('geofence.approaching');
    }
    // The email + push console transports surface a provider id; the SMS console transport has none
    // (only the real Twilio transport returns a SID — see the SmsSendResult reconciliation).
    expect(rows.find((r) => r.channel === CommsChannel.EMAIL)?.providerMessageId).toBeTruthy();
    expect(rows.find((r) => r.channel === CommsChannel.PUSH)?.providerMessageId).toBeTruthy();
    // Increment 11: the PUSH payload carries the owning orderId so a tapped notification deep-links
    // to THAT order's tracking (scoped — it's the customer's own order). SMS/email ignore it.
    const pushPayload = rows.find((r) => r.channel === CommsChannel.PUSH)?.payload as { orderId?: string } | undefined;
    expect(pushPayload?.orderId).toBe(sc.orderId);

    // Outbox idempotency: re-dispatching the SAME geofence event (concurrently) appends ZERO rows.
    const ev = await prisma.geofenceEvent.findFirstOrThrow({ where: { routeStopId: sc.stopId, type: 'APPROACHING' } });
    const replay: GeofenceNotification = {
      geofenceEventId: ev.id,
      kind: 'APPROACHING',
      orderId: sc.orderId,
      stopId: sc.stopId,
      vehicleId: sc.vehicleId,
      occurredAt: ev.occurredAt,
      etaSeconds: 120,
    };
    const svc = app.get(NotificationService);
    await Promise.all([svc.dispatchGeofence(ritaOrgId, [replay]), svc.dispatchGeofence(ritaOrgId, [replay])]);
    expect((await rowsForSource(ev.id)).length).toBe(3); // still exactly 3
  });

  // ───────────── DoD: arrived → SMS+email+push ─────────────

  it('ARRIVED → owning customer gets SMS+email+push', async () => {
    const sc = await freshScenario();
    await post('/v1/device-tokens', 'rita', { token: `ExponentPushToken[rita-arr-${vehSeq}]`, platform: 'ANDROID' }).expect(201);
    await pingBatch(sc, AT, ts(1)).expect(200); // at the stop → ARRIVED (+ APPROACHING)
    await drain();

    const arrived = await rowsForStopEvent(sc.stopId, 'ARRIVED');
    expect(arrived.map((r) => r.channel).sort()).toEqual([CommsChannel.EMAIL, CommsChannel.PUSH, CommsChannel.SMS]);
    for (const r of arrived) {
      expect(r.userId).toBe(userId.rita);
      expect(r.status).toBe(NotificationStatus.SENT);
      expect(r.eventType).toBe('geofence.arrived');
    }
  });

  // ───────────── DoD: only the owning customer is notified (cross-account + cross-org get nothing) ─────────────

  it('only the owning customer (rita) is notified — no cross-account, no cross-org recipients', async () => {
    const sc = await freshScenario();
    await pingBatch(sc, NEAR, ts(1)).expect(200);

    const ev = await prisma.geofenceEvent.findFirstOrThrow({ where: { routeStopId: sc.stopId, type: 'APPROACHING' } });
    const rows = await rowsForSource(ev.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([userId.rita])); // ONLY rita
    expect(rows.some((r) => r.userId === userId.accountBadmin)).toBe(false); // not the other account
    expect(rows.some((r) => r.userId === userId.org2owner)).toBe(false); // not another org
  });

  // ───────────── DoD: a channel opt-out → SUPPRESSED; the others still SENT ─────────────

  it('a channel opt-out → that channel SUPPRESSED; the other channels still SENT', async () => {
    const sc = await freshScenario();
    await post('/v1/device-tokens', 'rita', { token: `ExponentPushToken[rita-opt-${vehSeq}]`, platform: 'IOS' }).expect(201);
    await prisma.notificationPreference.create({
      data: { orgId: ritaOrgId, userId: userId.rita, smsEnabled: false, pushEnabled: true, emailEnabled: true },
    });

    await pingBatch(sc, NEAR, ts(1)).expect(200);
    await drain();
    const rows = await rowsForStopEvent(sc.stopId, 'APPROACHING');
    const byChannel = new Map(rows.map((r) => [r.channel, r.status]));
    expect(byChannel.get(CommsChannel.SMS)).toBe(NotificationStatus.SUPPRESSED); // opted out
    expect(byChannel.get(CommsChannel.EMAIL)).toBe(NotificationStatus.SENT);
    expect(byChannel.get(CommsChannel.PUSH)).toBe(NotificationStatus.SENT);
  });

  // ───────────── DoD: quiet hours — urgent delivered, non-urgent deferred ─────────────
  // Test env marks only `geofence.approaching` urgent (NOTIF_URGENT_EVENT_TYPES) so ONE geofence ping
  // exercises both branches: the urgent APPROACHING is delivered, the non-urgent ARRIVED is deferred.

  it('quiet hours: urgent APPROACHING delivered, non-urgent ARRIVED deferred to the window end', async () => {
    const sc = await freshScenario();
    // a quiet window covering "now" in the user's tz (now-30m → now+30m), via UTC so it's deterministic.
    const now = new Date();
    const nowMin = localMinutesOfDay(now, 'UTC');
    const startMin = (nowMin - 30 + 1440) % 1440;
    const endMin = (nowMin + 30) % 1440;
    await prisma.notificationPreference.create({
      data: {
        orgId: ritaOrgId,
        userId: userId.rita,
        quietHoursStart: startMin,
        quietHoursEnd: endMin,
        timezone: 'UTC',
      },
    });

    await pingBatch(sc, AT, ts(1)).expect(200); // fires APPROACHING (urgent) + ARRIVED (non-urgent)
    await drain(); // sends the due (urgent approaching) rows; deferred arrived rows are not due

    const approaching = await rowsForStopEvent(sc.stopId, 'APPROACHING');
    const arrived = await rowsForStopEvent(sc.stopId, 'ARRIVED');
    // SMS+EMAIL always have an address; assert on those to be independent of push-token state.
    for (const r of approaching.filter((x) => x.channel !== CommsChannel.PUSH)) {
      expect(r.status).toBe(NotificationStatus.SENT); // urgent bypassed quiet hours
    }
    for (const r of arrived.filter((x) => x.channel !== CommsChannel.PUSH)) {
      expect(r.status).toBe(NotificationStatus.PENDING); // deferred (held)
      expect(r.scheduledFor).not.toBeNull();
      expect((r.scheduledFor as Date).getTime()).toBeGreaterThan(Date.now());
    }
  });

  // ───────────── DoD: transport failure → FAILED after retry; others SENT; ingest+geofence survive ─────────────

  it('an SMS transport failure → FAILED after retry, email+push still SENT, ingest + geofence row survive', async () => {
    const sc = await freshScenario();
    await post('/v1/device-tokens', 'rita', { token: `ExponentPushToken[rita-fail-${vehSeq}]`, platform: 'IOS' }).expect(201);

    const smsTransport = app.get(SmsNotificationTransport);
    const spy = jest.spyOn(smsTransport, 'send').mockImplementation(async () => {
      throw new Error('twilio-down');
    });
    try {
      const res = await pingBatch(sc, NEAR, ts(1)).expect(200); // ingest must still succeed
      expect(res.body.lastKnownUpdated).toBe(true);

      // Drain twice with the SMS transport failing: attempt 1 → RETRYING (1ms backoff), attempt 2 →
      // FAILED (NOTIF_MAX_ATTEMPTS=2). email + push succeed on the first drain (per-channel isolation).
      await drain(); // attempt 1 — SMS RETRYING; email + push SENT
      const afterFirst = await rowsForStopEvent(sc.stopId, 'APPROACHING');
      expect(afterFirst.find((r) => r.channel === CommsChannel.SMS)?.status).toBe(NotificationStatus.RETRYING);

      await sleep(5); // let the 1ms backoff elapse so the RETRYING row is due
      await drain(); // attempt 2 — SMS FAILED

      const rows = await rowsForStopEvent(sc.stopId, 'APPROACHING');
      const sms = rows.find((r) => r.channel === CommsChannel.SMS);
      expect(sms?.status).toBe(NotificationStatus.FAILED);
      expect(sms?.attempts).toBe(2); // NOTIF_MAX_ATTEMPTS=2 (test env)
      expect(sms?.lastError).toContain('twilio-down');
      // per-channel isolation: email + push were unaffected
      expect(rows.find((r) => r.channel === CommsChannel.EMAIL)?.status).toBe(NotificationStatus.SENT);
      expect(rows.find((r) => r.channel === CommsChannel.PUSH)?.status).toBe(NotificationStatus.SENT);
      // the geofence write itself survived
      const ev = await prisma.geofenceEvent.findFirst({ where: { routeStopId: sc.stopId, type: 'APPROACHING' } });
      expect(ev).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  // ───────────── DoD: device-token register / unregister (user-scoped) ─────────────

  it('device-token register persists an active token; unregister deactivates it; cross-user delete → 404', async () => {
    const tkn = `ExponentPushToken[rita-reg-${vehSeq + 1000}]`;
    const created = (await post('/v1/device-tokens', 'rita', { token: tkn, platform: 'IOS' }).expect(201)).body;
    expect(created.active).toBe(true);
    expect(created.token).toBe(tkn);
    let row = await prisma.deviceToken.findUniqueOrThrow({ where: { token: tkn } });
    expect(row.userId).toBe(userId.rita);
    expect(row.active).toBe(true);

    // another user cannot deactivate rita's token (scoped) → 404, row untouched
    await del('/v1/device-tokens', 'owner', { token: tkn }).expect(404);
    row = await prisma.deviceToken.findUniqueOrThrow({ where: { token: tkn } });
    expect(row.active).toBe(true);

    // the owner deactivates it → 204, active=false
    await del('/v1/device-tokens', 'rita', { token: tkn }).expect(204);
    row = await prisma.deviceToken.findUniqueOrThrow({ where: { token: tkn } });
    expect(row.active).toBe(false);

    // re-register re-activates (idempotent by token)
    await post('/v1/device-tokens', 'rita', { token: tkn, platform: 'IOS' }).expect(201);
    row = await prisma.deviceToken.findUniqueOrThrow({ where: { token: tkn } });
    expect(row.active).toBe(true);
  });
});
