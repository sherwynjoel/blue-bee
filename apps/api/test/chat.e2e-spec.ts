import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import type Redis from 'ioredis';
import { WS_EVENTS, WS_NAMESPACES } from '@blue-bee/shared';
import { createRealtimeTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001';

const PHONES = {
  owner: '+14165550001',
  dispatcher: '+14165550002',
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER on ACCOUNT_A
  driver1: '+14165550006',
  driver2: '+14165550007',
  org2owner: '+14165559001',
};

/**
 * In-app chat e2e (Increment 18) — the per-order customer ↔ assigned-driver thread. Proves the six
 * QC lenses server-side: tenancy (only the customer + assigned driver; staff/cross-org denied), the
 * live-window send gate (409 after the stop completes), socket auth reuse (chat rides the SAME
 * /live/vehicle channel + signed token, order-room-scoped — no leak to another order), persistence
 * + read-only-after-close, honest unread counts, and (implicitly) no lifecycle writes.
 */
describe('Chat e2e — Increment 18 (per-order customer↔driver in-app chat)', () => {
  let app: INestApplication;
  let port: number;
  let pub: Redis;
  let sub: Redis;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  let vehicleId: string;
  let driver1Id: string;
  const openSockets: Socket[] = [];

  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

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
      s.once(event, (p: T) => { clearTimeout(t); res(p); });
    });
  const expectNoEvent = (s: Socket, event: string, ms = 1000) =>
    new Promise<void>((res, rej) => {
      const t = setTimeout(() => res(), ms);
      s.once(event, (p: unknown) => { clearTimeout(t); rej(new Error(`unexpected ${event}: ${JSON.stringify(p)}`)); });
    });

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
  /** Book an ACCOUNT_A order (booked by staff), route to driver1+vehicle, publish, depart → active (EN_ROUTE) stop. */
  async function activeStop(): Promise<{ orderId: string; stopId: string; routeId: string }> {
    const orderId = (
      await post('/v1/orders', 'owner', {
        accountId: ACCOUNT_A,
        siteId: SITE_NORTH,
        pickupWindow: { start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 7200_000).toISOString() },
        items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }],
      }).expect(201)
    ).body.id;
    const routeId = (await post('/v1/routes', 'dispatcher', { date: '2026-07-05' }).expect(201)).body.id;
    const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
    await post(`/v1/routes/${routeId}/assign`, 'dispatcher', { driverId: driver1Id, vehicleId }).expect(200);
    await post(`/v1/routes/${routeId}/publish`, 'dispatcher').expect(200);
    await post(`/v1/route-stops/${stop.id}:depart`, 'dispatcher').expect(200);
    return { orderId, stopId: stop.id, routeId };
  }
  const chatToken = async (orderId: string, who: string): Promise<string> =>
    (await get(`/v1/orders/${orderId}/messages/channel`, who).expect(200)).body.channelToken;
  // The live-TRACKING token (org-wide staff may mint this via GET /tracking) — NOT chat-authorized.
  const trackingToken = async (orderId: string, who: string): Promise<string> =>
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
    vehicleId = (await post('/v1/vehicles', 'dispatcher', { label: 'Chat Van 1', plate: 'CH-1' }).expect(201)).body.id;
    driver1Id = await ensureDriver((await get('/v1/me', 'driver1').expect(200)).body.user.userId);
    await ensureDriver((await get('/v1/me', 'driver2').expect(200)).body.user.userId);
    await startedShift(driver1Id, vehicleId);
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

  // ───────────── tenancy (lens #1): exactly the customer + assigned driver ─────────────

  it('RBAC: the customer and the assigned driver read the thread; an unassigned driver 404s and org staff are forbidden', async () => {
    const { orderId } = await activeStop();
    // The order's customer (rita) can read.
    const ritaView = (await get(`/v1/orders/${orderId}/messages`, 'rita').expect(200)).body;
    expect(ritaView.open).toBe(true);
    expect(Array.isArray(ritaView.messages)).toBe(true);
    // The assigned driver can read.
    await get(`/v1/orders/${orderId}/messages`, 'driver1').expect(200);
    // A DIFFERENT driver (same org, not assigned to this order) is not a participant → 404 (no leak).
    await get(`/v1/orders/${orderId}/messages`, 'driver2').expect(404);
    // Org-wide staff (OWNER) are excluded from chat by role → 403 (owner/console visibility is out).
    await get(`/v1/orders/${orderId}/messages`, 'owner').expect(403);
    // A non-participant also cannot post or mint a live-channel token.
    await post(`/v1/orders/${orderId}/messages`, 'driver2', { body: 'hi' }).expect(404);
    await get(`/v1/orders/${orderId}/messages/channel`, 'driver2').expect(404);
  });

  // ───────────── live-window gate (lens #2) + live delivery (lens #3) ─────────────

  it('send while active persists (201) and the driver receives it live on the SAME /live/vehicle channel', async () => {
    const { orderId } = await activeStop();
    // The assigned driver opens the live chat socket with a token minted by the chat channel endpoint.
    const driverSock = connect(WS_NAMESPACES.VEHICLE, { token: await chatToken(orderId, 'driver1') });
    await waitConnect(driverSock);
    const incoming = waitEvent<{ body: string; fromUserId: string; orderId: string }>(driverSock, WS_EVENTS.CHAT_MESSAGE);

    const sent = (await post(`/v1/orders/${orderId}/messages`, 'rita', { body: 'Hi, I am home now' }).expect(201)).body;
    expect(sent.body).toBe('Hi, I am home now');
    expect(sent.orderId).toBe(orderId);

    const ev = await incoming;
    expect(ev.body).toBe('Hi, I am home now');
    expect(ev.orderId).toBe(orderId);
    expect(ev.fromUserId).toBe(sent.fromUserId); // the customer authored it
  });

  it('the driver can send and the customer receives it live (mirror direction)', async () => {
    const { orderId } = await activeStop();
    const custSock = connect(WS_NAMESPACES.VEHICLE, { token: await chatToken(orderId, 'rita') });
    await waitConnect(custSock);
    const incoming = waitEvent<{ body: string }>(custSock, WS_EVENTS.CHAT_MESSAGE);

    await post(`/v1/orders/${orderId}/messages`, 'driver1', { body: 'On my way, 5 min out' }).expect(201);
    expect((await incoming).body).toBe('On my way, 5 min out');
  });

  // ───────────── read-only after close (lens #2 server-side) + persistence (lens #4) ─────────────

  it('after the stop completes the thread is read-only: POST 409, but history GET still works with open=false', async () => {
    const { orderId, stopId } = await activeStop();
    await post(`/v1/orders/${orderId}/messages`, 'rita', { body: 'before close' }).expect(201);

    // Drive the stop to terminal (COMPLETED) via the ops state machine.
    await post(`/v1/route-stops/${stopId}:arrive`, 'dispatcher').expect(200);
    await post(`/v1/route-stops/${stopId}:start`, 'dispatcher').expect(200);
    await post(`/v1/route-stops/${stopId}:complete`, 'dispatcher').expect(200);

    // Sending is rejected server-side (not just hidden in the UI).
    const rejected = await post(`/v1/orders/${orderId}/messages`, 'rita', { body: 'too late' }).expect(409);
    expect(rejected.body.title).toBe('chat_read_only');
    await post(`/v1/orders/${orderId}/messages`, 'driver1', { body: 'also too late' }).expect(409);

    // History remains readable to the participant, now read-only.
    const after = (await get(`/v1/orders/${orderId}/messages`, 'rita').expect(200)).body;
    expect(after.open).toBe(false);
    expect(after.messages.map((m: { body: string }) => m.body)).toContain('before close');
  });

  // ───────────── honest unread counts (in-app signalling) ─────────────

  it('unread is per-recipient and clears on mark-read; a sender never has unread for their own message', async () => {
    const { orderId } = await activeStop();
    // Two messages from the driver to the customer.
    await post(`/v1/orders/${orderId}/messages`, 'driver1', { body: 'msg 1' }).expect(201);
    await post(`/v1/orders/${orderId}/messages`, 'driver1', { body: 'msg 2' }).expect(201);

    // The customer sees 2 unread; the driver (only sent) sees 0.
    expect((await get(`/v1/orders/${orderId}/messages/unread`, 'rita').expect(200)).body.unreadCount).toBe(2);
    expect((await get(`/v1/orders/${orderId}/messages/unread`, 'driver1').expect(200)).body.unreadCount).toBe(0);

    // The customer marks read → count clears; the list also reports 0.
    const marked = (await post(`/v1/orders/${orderId}/messages/read`, 'rita').expect(200)).body;
    expect(marked.read).toBe(2);
    expect((await get(`/v1/orders/${orderId}/messages`, 'rita').expect(200)).body.unreadCount).toBe(0);

    // The customer replies → the driver now has 1 unread; the customer still 0.
    await post(`/v1/orders/${orderId}/messages`, 'rita', { body: 'thanks!' }).expect(201);
    expect((await get(`/v1/orders/${orderId}/messages/unread`, 'driver1').expect(200)).body.unreadCount).toBe(1);
    expect((await get(`/v1/orders/${orderId}/messages/unread`, 'rita').expect(200)).body.unreadCount).toBe(0);
  });

  // ───────────── socket auth (lens #3): the order room does not leak another order's chat ─────────────

  it('a message on one order never reaches a customer bound to a DIFFERENT order (order-room isolation)', async () => {
    const a = await activeStop();
    const b = await activeStop();
    const custA = connect(WS_NAMESPACES.VEHICLE, { token: await chatToken(a.orderId, 'rita') });
    await waitConnect(custA);

    // A message on order B must NOT arrive on order A's socket.
    const noLeak = expectNoEvent(custA, WS_EVENTS.CHAT_MESSAGE, 1200);
    await post(`/v1/orders/${b.orderId}/messages`, 'driver1', { body: 'for order B only' }).expect(201);
    await noLeak;

    // …but a message on order A does arrive (positive control).
    const onA = waitEvent<{ body: string }>(custA, WS_EVENTS.CHAT_MESSAGE);
    await post(`/v1/orders/${a.orderId}/messages`, 'driver1', { body: 'for order A' }).expect(201);
    expect((await onA).body).toBe('for order A');
  });

  it('a live-tracking token (org staff) can observe the vehicle but is NEVER added to the chat room', async () => {
    const { orderId } = await activeStop();
    // An org-wide OWNER may pull live tracking and gets a valid channel token…
    const staffTrackTok = await trackingToken(orderId, 'owner');
    expect(typeof staffTrackTok).toBe('string');
    const staffSock = connect(WS_NAMESPACES.VEHICLE, { token: staffTrackTok });
    await waitConnect(staffSock);
    // …but that tracking token is NOT chat-authorized → it must NEVER receive chat (no staff leak).
    const staffNoChat = expectNoEvent(staffSock, WS_EVENTS.CHAT_MESSAGE, 1500);
    // A real participant (the customer, via the chat channel endpoint) IS on the room (positive control).
    const custSock = connect(WS_NAMESPACES.VEHICLE, { token: await chatToken(orderId, 'rita') });
    await waitConnect(custSock);
    const custGets = waitEvent<{ body: string }>(custSock, WS_EVENTS.CHAT_MESSAGE);
    await post(`/v1/orders/${orderId}/messages`, 'driver1', { body: 'private to participants' }).expect(201);
    expect((await custGets).body).toBe('private to participants');
    await staffNoChat; // the staff tracking socket never saw the chat message
  });
});
