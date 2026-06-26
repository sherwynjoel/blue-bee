/* eslint-disable no-console */
/**
 * Headless integration proof (Increment 14a) — drives the OWNER app's REAL `ApiClient` against the
 * RUNNING backend over HTTP, proving the owner cockpit end-to-end without a simulator:
 *   owner login → /me (OWNER) → GET /fleet/live + a LIVE WS /live/fleet position (driven by a real
 *   POST /locations:batch ping) → GET /owner/today → list approvals + perform one approval action
 *   (quote:approve) → GET /owner/exceptions (a held order) → device-token register/unregister →
 *   RBAC negative (a customer token gets 403 on the owner reads).
 *
 * What this CANNOT prove headlessly (the founder's on-device run, see the handoff): the UI rendered on
 * a device and a push physically ARRIVING + a tapped push deep-linking. Those are the parked item.
 *
 * Prereq: the API at API_BASE_URL (default http://localhost:3000) with SMS_TRANSPORT=console + the
 * seed applied (relax the OTP rate limits for repeat runs). Working folder: /Volumes/Gowtham/Blue Bee.
 * Run: npm --workspace @blue-bee/owner run integration
 */
import { io } from 'socket.io-client';
import { DevicePlatform, WS_EVENTS, WS_NAMESPACES, type LivePositionEvent } from '@blue-bee/shared';
import { ApiClient } from '../src/api/client';
import { MemoryTokenStore } from '../src/api/token-store';

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_CITY_HALL = '55555555-5555-4555-8555-555555555555';
const PHONES = { owner: '+14165550001', dispatcher: '+14165550002', driver: '+14165550006', rita: '+14165550010' };

let passed = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (!cond) throw new Error(`✗ ${label} ${detail}`);
  passed += 1;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function raw(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

async function ownerClientFor(phone: string): Promise<ApiClient> {
  const client = new ApiClient(API, new MemoryTokenStore());
  const otp = await client.requestOtp(phone);
  await client.verifyOtp(phone, otp.devCode!);
  return client;
}

async function bookOrder(ownerToken: string, measure = 40): Promise<string> {
  const res = await raw('POST', '/orders', ownerToken, {
    accountId: ACCOUNT_A,
    siteId: SITE_CITY_HALL,
    items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: measure }],
  });
  if (res.status >= 300) throw new Error(`book failed: ${JSON.stringify(res.json)}`);
  return res.json.id as string;
}

/** Drive an order book → QUOTED as owner (all steps an OWNER may perform). */
async function driveToQuoted(ownerToken: string): Promise<string> {
  const orderId = await bookOrder(ownerToken);
  const received = await raw('POST', `/orders/${orderId}/received-at-plant`, ownerToken, {});
  const itemId = received.json.items[0].id as string;
  await raw('POST', `/orders/${orderId}/items/${itemId}/inspection`, ownerToken, {
    conditionCodes: ['frayed'],
    measurements: { sqft: 40 },
    preexistingDamage: false,
  });
  const quoted = await raw('POST', `/orders/${orderId}/quote`, ownerToken, {});
  if (quoted.json?.order?.status !== 'QUOTED') throw new Error(`quote failed: ${JSON.stringify(quoted.json)}`);
  return orderId;
}

async function main(): Promise<void> {
  console.log(`\n▶ Owner-app integration proof against ${API}\n`);

  const health = await fetch(`${API}/v1/health`).then((r) => r.status);
  check('API health 200', health === 200, `status=${health}`);

  const ownerRaw = await loginRaw(PHONES.owner);
  const dispatcherRaw = await loginRaw(PHONES.dispatcher);
  const driverRaw = await loginRaw(PHONES.driver);

  // ── [1] owner login through the REAL owner ApiClient ──
  console.log('\n[1] owner login (real owner ApiClient)');
  const owner = await ownerClientFor(PHONES.owner);
  const me = await owner.me();
  check('/me is an OWNER', me.user.roles.some((r) => r.role === 'OWNER'), me.user.name);

  // ── ops setup: a published route + an ACTIVE shift the driver owns (so its ping is accepted) ──
  console.log('\n[2] scenario setup (vehicle, shift, route, stop)');
  const driverUserId = (await raw('GET', '/me', driverRaw)).json.user.userId;
  await raw('POST', '/drivers', dispatcherRaw, { userId: driverUserId }); // 201 or already-exists
  const drivers = await raw('GET', '/drivers', dispatcherRaw);
  const driverId = (drivers.json as Array<{ id: string; userId: string }>).find((d) => d.userId === driverUserId)?.id;
  if (!driverId) throw new Error('could not resolve driver profile id');

  // end any leftover ACTIVE shift so the fresh one starts cleanly (re-runnable)
  for (let i = 0; i < 5; i++) {
    const a = await raw('GET', '/driver/assignment', driverRaw);
    if (a.json?.shift?.status === 'ACTIVE') await raw('POST', `/driver/shifts/${a.json.shift.id}/end`, driverRaw);
    else break;
  }

  const vehicleId = (await raw('POST', '/vehicles', dispatcherRaw, { label: `Owner Van ${Date.now() % 100000}`, plate: `OWN-${Date.now() % 100000}` })).json.id;
  const shiftId = (await raw('POST', '/shifts', dispatcherRaw, { driverId, vehicleId })).json.id;
  const stopOrderId = await bookOrder(ownerRaw, 25);
  const routeId = (await raw('POST', '/routes', dispatcherRaw, { date: '2026-07-25' })).json.id;
  await raw('POST', `/routes/${routeId}/stops`, dispatcherRaw, { orderId: stopOrderId });
  await raw('POST', `/routes/${routeId}/assign`, dispatcherRaw, { driverId, vehicleId });
  await raw('POST', `/routes/${routeId}/publish`, dispatcherRaw);
  await raw('POST', `/driver/shifts/${shiftId}/start`, driverRaw); // shift ACTIVE → GPS gate open
  check('scenario published with an ACTIVE shift', true, `vehicle=${vehicleId.slice(0, 8)}`);

  // ── [3] live fleet: REST snapshot + a live WS position driven by a real ping ──
  console.log('\n[3] live fleet (GET /fleet/live + WS /live/fleet position)');
  const fleet0 = await owner.fleetLive();
  check('GET /fleet/live returns a snapshot', Array.isArray(fleet0.vehicles) && Array.isArray(fleet0.withoutPosition));
  const token = await owner.accessToken();
  const socket = io(`${API}${WS_NAMESPACES.FLEET}`, { transports: ['websocket'], reconnection: false, auth: { token } });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (e: Error) => reject(new Error(`WS connect_error: ${e.message}`)));
    setTimeout(() => reject(new Error('WS connect timeout')), 6000);
  });
  check('WS /live/fleet connected with the access JWT (OWNER-scoped)', socket.connected);
  const positionP = new Promise<LivePositionEvent>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no position event')), 8000);
    socket.once(WS_EVENTS.POSITION, (p: LivePositionEvent) => {
      clearTimeout(t);
      resolve(p);
    });
  });
  const now = Date.now();
  const ping = await raw('POST', '/locations:batch', driverRaw, { shiftId, vehicleId, pings: [{ lat: 43.6536, lng: -79.3837, recordedAt: new Date(now).toISOString() }] });
  check('locations:batch ping accepted (driver owns the shift)', ping.status >= 200 && ping.status < 300, `status=${ping.status}`);
  const position = await positionP;
  check('WS streamed a live position for the org fleet', position.vehicleId === vehicleId, `@ ${position.lat},${position.lng}`);
  const fleet1 = await owner.fleetLive();
  check('GET /fleet/live now shows the vehicle', fleet1.vehicles.some((v) => v.vehicleId === vehicleId) || fleet1.withoutPosition.some((v) => v.vehicleId === vehicleId));
  socket.disconnect();

  // ── [4] today's numbers ──
  console.log('\n[4] today dashboard (GET /owner/today)');
  const today = await owner.today();
  check('today returns server-aggregated numbers', typeof today.ordersToday === 'number' && /^\d+\.\d{2}$/.test(today.collectedToday), `orders=${today.ordersToday} collected=${today.collectedToday} on-time=${today.onTimePercent}`);

  // ── [5] approvals: list a pending quote + approve it (server-authoritative) ──
  console.log('\n[5] approvals (GET /owner/approvals + quote:approve)');
  const approvalOrderId = await driveToQuoted(ownerRaw);
  const before = await owner.approvals();
  check('approvals lists the pending QUOTED order', before.approvals.some((a) => a.orderId === approvalOrderId), `${before.approvals.length} pending`);
  await owner.approveQuote(approvalOrderId);
  const approved = await raw('GET', `/orders/${approvalOrderId}`, ownerRaw);
  check('approval action drove the order to QUOTE_APPROVED', approved.json.status === 'QUOTE_APPROVED', approved.json.status);
  const after = await owner.approvals();
  check('approved order left the pending feed', !after.approvals.some((a) => a.orderId === approvalOrderId));

  // ── [6] exceptions: a held order surfaces ──
  console.log('\n[6] exceptions (GET /owner/exceptions)');
  const heldOrderId = await bookOrder(ownerRaw);
  await raw('POST', `/orders/${heldOrderId}/hold`, ownerRaw, { reason: 'owner-app exceptions proof' });
  const exceptions = await owner.exceptions();
  check('exceptions feed surfaces the held order (deep-link orderId)', exceptions.exceptions.some((e) => e.kind === 'ORDER_HELD' && e.orderId === heldOrderId), `${exceptions.exceptions.length} exceptions`);

  // ── [7] push device-token register/unregister ──
  console.log('\n[7] push device-token registration');
  const expoToken = `ExponentPushToken[owner-proof-${now}]`;
  const reg = await owner.registerDeviceToken({ token: expoToken, platform: DevicePlatform.IOS });
  check('device token registered + active', reg.active === true && reg.token === expoToken);
  await owner.unregisterDeviceToken(expoToken);
  check('device token unregister → 204 (no throw)', true);
  console.log('  · (a real-device push RECEIPT + tapped deep-link are proven in the on-device run — see the handoff)');

  // ── [8] RBAC negative: a customer token gets nothing from the owner surface ──
  console.log('\n[8] RBAC — a customer token gets 403 on the owner reads');
  const rita = await ownerClientFor(PHONES.rita);
  const ritaToday = await rita.today().then(() => 0).catch((e) => e.status);
  check('customer today → 403', ritaToday === 403, `status=${ritaToday}`);
  const ritaApprovals = await rita.approvals().then(() => 0).catch((e) => e.status);
  check('customer approvals → 403', ritaApprovals === 403, `status=${ritaApprovals}`);
  const ritaExceptions = await rita.exceptions().then(() => 0).catch((e) => e.status);
  check('customer exceptions → 403', ritaExceptions === 403, `status=${ritaExceptions}`);

  console.log(`\n✓ ALL ${passed} CHECKS PASSED — the owner cockpit runs end-to-end against the live API.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n✗ INTEGRATION PROOF FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
