/* eslint-disable no-console */
/**
 * Headless integration proof (Increment 9). Drives the driver app's REAL ApiClient against the
 * RUNNING backend over HTTP — proving the whole duty loop end-to-end without a simulator:
 *   login (console OTP) → /me → /driver/assignment → start shift → POST /locations:batch →
 *   walk a stop through §5.4 (depart→arrive→start→complete) → register + unregister a device token.
 *
 * What this CANNOT prove headlessly (documented in the handoff): the UI rendered on a device, the OS
 * background-location task firing, and a push physically arriving — those need the on-device run.
 *
 * Prereq: the API running at API_BASE_URL (default http://localhost:3000) with the seed applied.
 * Run:    npm --workspace @blue-bee/driver run integration
 */
import { ApiClient } from '../src/api/client';
import { MemoryTokenStore } from '../src/api/token-store';
import { DevicePlatform, type DriverAssignment, type GpsPingDto } from '@blue-bee/shared';

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001';
const DRIVER_PHONE = '+14165550006';
const DISPATCHER_PHONE = '+14165550002';
const OWNER_PHONE = '+14165550001';

let passed = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (!cond) throw new Error(`✗ ${label} ${detail}`);
  passed += 1;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Raw fetch for the ops setup (the app client only exposes the driver surface). */
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

async function main(): Promise<void> {
  console.log(`\n▶ Driver-app integration proof against ${API}\n`);

  // ── health ──
  const health = await fetch(`${API}/v1/health`).then((r) => r.status);
  check('API health 200', health === 200, `status=${health}`);

  // ── ops setup (dispatcher/owner): a published route assigned to driver1 with one PENDING stop ──
  const dispatcher = await loginRaw(DISPATCHER_PHONE);
  const owner = await loginRaw(OWNER_PHONE);

  // ensure driver1 has a Driver profile, and get its id
  const driverClientForId = new ApiClient(API, new MemoryTokenStore());
  await driverClientForId.requestOtp(DRIVER_PHONE).then((r) => driverClientForId.verifyOtp(DRIVER_PHONE, r.devCode!));
  const meEarly = await driverClientForId.me();
  const driverUserId = meEarly.user.userId;
  await raw('POST', '/drivers', dispatcher, { userId: driverUserId }); // 201 or already-exists
  const drivers = await raw('GET', '/drivers', dispatcher);
  const driverId = (drivers.json as Array<{ id: string; userId: string }>).find((d) => d.userId === driverUserId)?.id;
  if (!driverId) throw new Error('could not resolve driver profile id');

  // Re-runnable: end any leftover ACTIVE shift so getAssignment deterministically returns THIS run's
  // freshly-created SCHEDULED shift (the suite reuses the seeded driver1).
  for (let i = 0; i < 5; i++) {
    const a = await driverClientForId.getAssignment();
    if (a.shift && a.shift.status === 'ACTIVE') await driverClientForId.endShift(a.shift.id);
    else break;
  }

  const vehicleId = (await raw('POST', '/vehicles', dispatcher, { label: `Proof Van ${Date.now() % 100000}`, plate: `PRF-${Date.now() % 100000}` })).json.id;
  const shiftId = (await raw('POST', '/shifts', dispatcher, { driverId, vehicleId })).json.id;
  const orderId = (
    await raw('POST', '/orders', owner, {
      accountId: ACCOUNT_A,
      siteId: SITE_NORTH,
      pickupWindow: { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() },
      items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }],
    })
  ).json.id;
  const routeId = (await raw('POST', '/routes', dispatcher, { date: '2026-07-20' })).json.id;
  const stopId = (await raw('POST', `/routes/${routeId}/stops`, dispatcher, { orderId })).json.id;
  await raw('POST', `/routes/${routeId}/assign`, dispatcher, { driverId, vehicleId });
  await raw('POST', `/routes/${routeId}/publish`, dispatcher);
  console.log('  · scenario published (vehicle, shift, order, route, stop) for driver1');

  // ── the driver app, through the REAL ApiClient ──
  const driver = new ApiClient(API, new MemoryTokenStore());

  console.log('\n[1] phone-OTP login');
  const otp = await driver.requestOtp(DRIVER_PHONE);
  check('OTP issued with a dev code', !!otp.devCode);
  const pair = await driver.verifyOtp(DRIVER_PHONE, otp.devCode!);
  check('verify returns an access + refresh pair', !!pair.accessToken && !!pair.refreshToken);
  const me = await driver.me();
  check('/me hydrates the driver', me.user.userId === driverUserId, me.user.name);

  console.log('\n[2] my route today');
  const assignment: DriverAssignment = await driver.getAssignment();
  check('assignment is the driver’s own', assignment.driverId === driverId);
  check('shift is present + SCHEDULED', assignment.shift?.id === shiftId && assignment.shift?.status === 'SCHEDULED');
  const stop = assignment.route?.stops.find((s) => s.id === stopId);
  check('route + ordered stop present with geo', !!stop && stop.lat != null && stop.lng != null, `${stop?.siteName} @ ${stop?.lat?.toFixed(4)},${stop?.lng?.toFixed(4)}`);

  console.log('\n[3] start shift → background GPS ingestion');
  await driver.startShift(shiftId);
  const afterStart = await driver.getAssignment();
  check('shift is ACTIVE (GPS gate open)', afterStart.shift?.status === 'ACTIVE');
  const now = Date.now();
  const pings: GpsPingDto[] = [
    { lat: 43.7, lng: -79.41, recordedAt: new Date(now - 60_000).toISOString() },
    { lat: 43.74, lng: -79.411, recordedAt: new Date(now - 30_000).toISOString() },
    { lat: 43.7612, lng: -79.4111, recordedAt: new Date(now).toISOString() }, // ~at the stop → geofence
  ];
  const batch = await driver.postLocations({ shiftId, vehicleId, pings });
  check('locations:batch accepted + advanced last-known', batch.accepted === 3 && batch.lastKnownUpdated, `accepted=${batch.accepted} inserted=${batch.inserted}`);
  // idempotent re-send (the retry-buffer guarantee): zero new rows
  const replay = await driver.postLocations({ shiftId, vehicleId, pings });
  check('re-send is idempotent (0 inserted)', replay.inserted === 0, `inserted=${replay.inserted}`);

  // the whole Inc 5–7 chain lit up by a real client: the owner fleet view sees the vehicle's position
  const fleet = await raw('GET', '/fleet/live', owner);
  const tracked = (fleet.json.vehicles as Array<{ vehicleId: string }>).find((v) => v.vehicleId === vehicleId);
  check('owner /fleet/live reflects the driver’s pings', !!tracked);

  console.log('\n[4] walk the stop through §5.4');
  const illegal = await driver.stopAction(stopId, 'complete').then(() => false).catch((e) => e?.status === 409);
  check('illegal transition (complete a PENDING stop) → 409', illegal === true);
  for (const action of ['depart', 'arrive', 'start', 'complete'] as const) {
    await driver.stopAction(stopId, action);
    console.log(`  · ${action} → ok`);
  }
  const walked = await raw('GET', `/route-stops/${stopId}`, dispatcher);
  check('stop reached COMPLETED', walked.json.status === 'COMPLETED');

  console.log('\n[5] push device-token registration (Increment-8 surface)');
  const expoToken = `ExponentPushToken[proof-${now}]`;
  const reg = await driver.registerDeviceToken({ token: expoToken, platform: DevicePlatform.IOS });
  check('device token registered + active', reg.active === true && reg.token === expoToken);
  await driver.unregisterDeviceToken(expoToken);
  check('device token unregister → 204 (no throw)', true);
  console.log('  · (real-device push RECEIPT is proven in the on-device run — see the handoff)');

  console.log(`\n✓ ALL ${passed} CHECKS PASSED — the driver duty loop runs end-to-end against the live API.\n`);
}

main().catch((err) => {
  console.error(`\n✗ INTEGRATION PROOF FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
