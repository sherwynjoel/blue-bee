/* eslint-disable no-console */
/**
 * Headless integration proof (Increment 11) for the Blue Bee CUSTOMER app. Drives the customer app's
 * REAL `CustomerApiClient` against the RUNNING backend over HTTP — proving the whole customer slice
 * end-to-end without a simulator, lighting the Increment 3→10 stack from the real customer client:
 *   login (console OTP) → /me → catalog (services/sites) → BOOK (POST /orders, idempotent) →
 *   advance to QUOTED (staff path) → quote:approve (+ double-approve 409 re-sync) → quote:decline →
 *   GET /orders/:id/tracking (channelToken) → connect WS /live/vehicle → receive a position/eta
 *   (driven by a real POST /locations:batch ping, exactly like Inc 9's proof) →
 *   /media/presign → PUT real bytes → /media/confirm → signed GET byte-for-byte match →
 *   device-tokens register/unregister.
 *
 * What this CANNOT prove headlessly (documented in the handoff): the UI rendered on a device, a real
 * camera capturing a photo, and a real Expo push physically ARRIVING + its tap deep-linking — those
 * are the founder's on-device run (a real Expo push can't reach a simulator). The customer push
 * RECEIPT closes Increment-8's deferred real-device push (together with the driver's).
 *
 * Prereq: the API running at API_BASE_URL (default http://localhost:3000) with SMS_TRANSPORT=console,
 * the MinIO infra up, and the seed applied. Run: npm --workspace @blue-bee/customer run integration
 */
import { io, type Socket } from 'socket.io-client';
import {
  DevicePlatform,
  PhotoKind,
  WS_EVENTS,
  WS_NAMESPACES,
  type LiveEtaEvent,
  type LivePositionEvent,
} from '@blue-bee/shared';
import { MemoryTokenStore } from '@blue-bee/api-client';
import { CustomerApiClient } from '../src/api/customer-client';

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001';
const RITA = '+14165550010';
const OWNER = '+14165550001';
const DISPATCHER = '+14165550002';
const PLANT = '+14165550004';
const DRIVER = '+14165550006';

let passed = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (!cond) throw new Error(`✗ ${label} ${detail}`);
  passed += 1;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Raw fetch for the staff/ops setup (the customer client only exposes the customer surface). */
async function raw(method: string, path: string, accessToken?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 204 */
  }
  return { status: res.status, json };
}

async function loginRaw(phone: string): Promise<string> {
  const otp = await raw('POST', '/auth/otp', undefined, { phone });
  const code = otp.json?.devCode;
  if (!code) throw new Error(`no devCode for ${phone} (is SMS_TRANSPORT=console?)`);
  const verify = await raw('POST', '/auth/verify', undefined, { phone, code });
  if (!verify.json?.accessToken) throw new Error(`login failed for ${phone}: ${JSON.stringify(verify.json)}`);
  return verify.json.accessToken;
}

/** Drive a freshly-booked order book→QUOTED via the staff path (the Inc-3 chain). */
async function driveToQuoted(orderId: string, staff: string, plant: string): Promise<void> {
  await raw('POST', `/orders/${orderId}/schedule-pickup`, staff, {
    pickupWindow: { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() },
  });
  await raw('POST', `/orders/${orderId}/received-at-plant`, staff, {});
  const order = (await raw('GET', `/orders/${orderId}`, staff)).json;
  for (const item of order.items as Array<{ id: string }>) {
    await raw('POST', `/orders/${orderId}/items/${item.id}/inspection`, plant, {
      measurements: { sqft: 40 },
      conditionCodes: [],
      preexistingDamage: false,
    });
  }
  const q = await raw('POST', `/orders/${orderId}/quote`, staff, {});
  if (q.status >= 300) throw new Error(`build quote failed: ${JSON.stringify(q.json)}`);
}

function waitEvent<T>(socket: Socket, event: string, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}" after ${ms}ms`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main(): Promise<void> {
  console.log(`\n▶ Customer-app integration proof against ${API}\n`);

  // ── health ──
  const health = await fetch(`${API}/v1/health`).then((r) => r.status);
  check('API health 200', health === 200, `status=${health}`);

  // staff tokens for the ops/staff setup
  const owner = await loginRaw(OWNER);
  const dispatcher = await loginRaw(DISPATCHER);
  const plant = await loginRaw(PLANT);
  const driverToken = await loginRaw(DRIVER);

  // ── [1] the customer logs in through the REAL CustomerApiClient ──
  console.log('\n[1] phone-OTP login (real customer client)');
  const customer = new CustomerApiClient(API, new MemoryTokenStore());
  const otp = await customer.requestOtp(RITA);
  check('OTP issued with a dev code', !!otp.devCode);
  const pair = await customer.verifyOtp(RITA, otp.devCode!);
  check('verify returns an access + refresh pair', !!pair.accessToken && !!pair.refreshToken);
  const me = await customer.me();
  check('/me hydrates Rita as RESIDENTIAL_CUSTOMER', me.user.roles.some((r) => r.role === 'RESIDENTIAL_CUSTOMER'), me.user.name);
  check('/me scopes her to Account A', me.user.accountIds.includes(ACCOUNT_A));

  // ── [2] catalog (the booking context the new GET /services + /sites surface) ──
  console.log('\n[2] catalog reads');
  const services = await customer.getServices();
  check('GET /services includes the specialty service', services.services.some((s) => s.id === SERVICE));
  const sites = await customer.getSites();
  check('GET /sites returns ONLY Rita’s account sites', sites.sites.length > 0 && sites.sites.every((s) => s.accountId === ACCOUNT_A));

  // ── [3] BOOK (idempotent) ──
  console.log('\n[3] book a specialty job');
  const idemKey = `proof-book-${Date.now()}`;
  const booked = await customer.book(
    { accountId: ACCOUNT_A, siteId: SITE_NORTH, items: [{ kind: 'RUG' as never, serviceId: SERVICE, estimatedMeasure: 40 }] },
    idemKey,
  );
  check('order booked at REQUESTED', booked.status === 'REQUESTED', booked.id);
  check('rough estimate range returned', !!booked.totals?.estimateRange, JSON.stringify(booked.totals?.estimateRange));
  const replay = await customer.book(
    { accountId: ACCOUNT_A, siteId: SITE_NORTH, items: [{ kind: 'RUG' as never, serviceId: SERVICE, estimatedMeasure: 40 }] },
    idemKey,
  );
  check('re-booking with the SAME idempotency key returns the SAME order (no double-book)', replay.id === booked.id);

  // ── [4] advance to QUOTED (staff) → approve (customer) → double-approve 409 ──
  console.log('\n[4] approve the quote');
  await driveToQuoted(booked.id, owner, plant);
  const quotedRead = await customer.getOrder(booked.id);
  check('order is QUOTED with a SENT quote', quotedRead.status === 'QUOTED' && quotedRead.quotes[0]?.status === 'SENT');
  const approved = await customer.approveQuote(booked.id, { note: 'looks good' });
  check('quote:approve → QUOTE_APPROVED (no payment taken)', approved.status === 'QUOTE_APPROVED');
  const doubleApprove = await customer
    .approveQuote(booked.id)
    .then(() => null)
    .catch((e) => e);
  check('double-approve is server-authoritative → 409 (race-safe)', doubleApprove?.status === 409, doubleApprove?.code);

  // ── [5] decline path on a second order ──
  console.log('\n[5] decline the quote (second order)');
  const order2 = await customer.book(
    { accountId: ACCOUNT_A, items: [{ kind: 'CARPET' as never, serviceId: SERVICE, estimatedMeasure: 20 }] },
    `proof-book2-${Date.now()}`,
  );
  await driveToQuoted(order2.id, owner, plant);
  const declined = await customer.declineQuote(order2.id, { reason: 'changed my mind' });
  check('quote:decline → CLOSED_NO_WORK (§5.1 branch)', declined.status === 'CLOSED_NO_WORK');

  // ── [6] track my truck: tracking read → channelToken → live WS position/eta (ping-driven) ──
  console.log('\n[6] track my truck (live WS, ping-driven)');
  const trackOrder = await customer.book(
    { accountId: ACCOUNT_A, siteId: SITE_NORTH, items: [{ kind: 'RUG' as never, serviceId: SERVICE, estimatedMeasure: 30 }] },
    `proof-track-${Date.now()}`,
  );
  // staff scenario: a driver profile + vehicle + shift + a published route with a stop for this order
  const meDriver = await raw('GET', '/me', driverToken);
  const driverUserId = meDriver.json.user.userId;
  await raw('POST', '/drivers', dispatcher, { userId: driverUserId }); // 201 or already-exists
  const drivers = await raw('GET', '/drivers', dispatcher);
  const driverId = (drivers.json as Array<{ id: string; userId: string }>).find((d) => d.userId === driverUserId)?.id;
  if (!driverId) throw new Error('could not resolve driver profile id');
  const vehicleId = (await raw('POST', '/vehicles', dispatcher, { label: `Cust Proof Van ${Date.now() % 100000}`, plate: `CPF-${Date.now() % 100000}` })).json.id;
  const shiftId = (await raw('POST', '/shifts', dispatcher, { driverId, vehicleId })).json.id;
  const routeId = (await raw('POST', '/routes', dispatcher, { date: '2026-07-22' })).json.id;
  await raw('POST', `/routes/${routeId}/stops`, dispatcher, { orderId: trackOrder.id });
  await raw('POST', `/routes/${routeId}/assign`, dispatcher, { driverId, vehicleId });
  await raw('POST', `/routes/${routeId}/publish`, dispatcher);
  await raw('POST', `/driver/shifts/${shiftId}/start`, driverToken, {});

  const tracking = await customer.getOrderTracking(trackOrder.id);
  check('GET /orders/:id/tracking mints a channelToken (active stop + assigned vehicle)', !!tracking.channelToken, `stop=${tracking.stop?.id}`);

  const socket = io(`${API}${WS_NAMESPACES.VEHICLE}`, { transports: ['websocket'], reconnection: false, auth: { token: tracking.channelToken } });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (e: Error) => reject(new Error(`WS connect_error: ${e.message}`)));
    setTimeout(() => reject(new Error('WS connect timed out')), 6000);
  });
  check('WS /live/vehicle connected with the channel token', socket.connected);

  const positionP = waitEvent<LivePositionEvent>(socket, WS_EVENTS.POSITION, 8000);
  // drive a real ping through the proven driver ingestion (the harness, exactly like Inc 9's proof)
  const now = Date.now();
  await raw('POST', '/locations:batch', driverToken, {
    shiftId,
    vehicleId,
    pings: [
      { lat: 43.74, lng: -79.41, recordedAt: new Date(now - 30_000).toISOString() },
      { lat: 43.7615, lng: -79.4111, recordedAt: new Date(now).toISOString() }, // at the North York site → geofence/eta
    ],
  });
  const position = await positionP;
  check('WS streamed a live position for THIS vehicle (only)', position.vehicleId === vehicleId, `@ ${position.lat},${position.lng}`);
  // an eta event may also arrive (Increment 7) — accept it if present, don't fail if the estimator defers
  const eta = await waitEvent<LiveEtaEvent>(socket, WS_EVENTS.ETA, 4000).catch(() => null);
  if (eta) check('WS streamed an ETA range for the stop', !!eta.eta && !!eta.low && !!eta.high, `${eta.low}..${eta.high}`);
  else console.log('  · (no eta event within the window — acceptable; REST tracking carries the ETA)');
  socket.disconnect();

  // ── [7] media: presign → PUT real bytes → confirm → signed GET byte-for-byte ──
  console.log('\n[7] before/after photo (real bytes through the Inc-10 media path)');
  const itemId = (await customer.getOrder(booked.id)).items[0]!.id;
  const bytes = Buffer.from('blue-bee-customer-before-photo-' + 'x'.repeat(400));
  const presign = await customer.presignMedia({ orderId: booked.id, itemId, kind: PhotoKind.BEFORE, contentType: 'image/jpeg', byteSize: bytes.length });
  check('presign returned a signed PUT url + org-namespaced key', presign.uploadUrl.includes('X-Amz-Signature') && /^org\//.test(presign.storageKey));
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(bytes) });
  check('PUT real bytes to storage accepted', put.status >= 200 && put.status < 300, `status=${put.status}`);
  const confirmed = await customer.confirmMedia({ storageKey: presign.storageKey, takenAt: new Date().toISOString() });
  check('confirm created the Photo with a signed downloadUrl (no raw key)', !!confirmed.downloadUrl && confirmed.downloadUrl.includes('X-Amz-Signature'));
  // read it back through the ORDER (signed reads on GET /orders/:id) and byte-compare
  const detail = await customer.getOrder(booked.id);
  const photo = detail.items.flatMap((i) => i.photos).find((p) => p.id === confirmed.id);
  check('the photo is exposed on the order read with a signed downloadUrl', !!photo?.downloadUrl);
  const dl = await fetch(photo!.downloadUrl!);
  const got = Buffer.from(await dl.arrayBuffer());
  check('signed GET returns the SAME bytes (byte-for-byte)', got.equals(bytes), `${got.length} bytes`);

  // cross-order presign privacy: Rita cannot presign against the Org-2 order (404/403)
  const crossOrder = await customer
    .presignMedia({ orderId: 'e0000000-0000-4000-8000-0000000000c1', kind: PhotoKind.BEFORE, contentType: 'image/jpeg', byteSize: 10 })
    .then(() => null)
    .catch((e) => e);
  check('cross-order/cross-account presign is rejected (privacy)', crossOrder?.status === 404 || crossOrder?.status === 403, crossOrder?.status);

  // ── [8] push device-token register / unregister ──
  console.log('\n[8] push device-token registration');
  const expoToken = `ExponentPushToken[customer-proof-${now}]`;
  const reg = await customer.registerDeviceToken({ token: expoToken, platform: DevicePlatform.IOS });
  check('device token registered + active', reg.active === true && reg.token === expoToken);
  await customer.unregisterDeviceToken(expoToken);
  check('device token unregister → 204 (no throw)', true);
  console.log('  · (real-device push RECEIPT + tapped-push deep-link are proven in the on-device run — see the handoff)');

  console.log(`\n✓ ALL ${passed} CHECKS PASSED — the customer slice runs end-to-end against the live API.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n✗ INTEGRATION PROOF FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
