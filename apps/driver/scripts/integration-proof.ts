/* eslint-disable no-console */
/**
 * Headless integration proof (Increment 9 + the Increment-17 POD-capture flow). Drives the driver
 * app's REAL ApiClient against the RUNNING backend over HTTP — proving the whole duty loop end-to-end
 * without a simulator:
 *   login (console OTP) → /me → /driver/assignment → start shift → POST /locations:batch →
 *   walk a stop through §5.4 (depart→arrive→start→complete) → register + unregister a device token →
 *   [6] proof of delivery: presign → PUT REAL photo+signature bytes (MinIO) → POST the POD (gated
 *   delivery complete, signed reads, idempotent) → complete the delivery stop.
 *
 * What this CANNOT prove headlessly (documented in the handoff): the UI rendered on a device, the OS
 * background-location task firing, a push physically arriving, and the REAL camera + signature pad +
 * device GPS — those need the on-device run.
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

  console.log('\n[6] proof of delivery at a DELIVERY stop (photo + signature + geo, REAL bytes → MinIO)');
  // A fresh DELIVERY stop on driver1's active shift (the seeded walk above was a PICKUP).
  const dOrderId = (
    await raw('POST', '/orders', owner, {
      accountId: ACCOUNT_A,
      siteId: SITE_NORTH,
      pickupWindow: { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() },
      items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40 }],
    })
  ).json.id;
  const dRouteId = (await raw('POST', '/routes', dispatcher, { date: '2026-07-21' })).json.id;
  const dStopId = (await raw('POST', `/routes/${dRouteId}/stops`, dispatcher, { orderId: dOrderId, kind: 'DELIVERY' })).json.id;
  await raw('POST', `/routes/${dRouteId}/assign`, dispatcher, { driverId, vehicleId });
  await raw('POST', `/routes/${dRouteId}/publish`, dispatcher);
  for (const action of ['depart', 'arrive', 'start'] as const) await driver.stopAction(dStopId, action);

  // The delivery complete is GATED on a POD (server-authoritative; clean 400, machine untouched).
  const gated = await driver.stopAction(dStopId, 'complete').then(() => false).catch((e) => (e as { status?: number })?.status === 400);
  check('delivery complete is gated on POD (→ 400)', gated === true);

  // presign → PUT REAL bytes (photo jpeg + signature png) through the REAL driver client.
  async function uploadPod(contentType: string, bytes: Buffer): Promise<string> {
    const pre = await driver.presignPodMedia(dStopId, { contentType, byteSize: bytes.length });
    const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes) });
    check(`PUT real ${contentType} bytes to the presigned URL → 200`, put.status === 200, `key=${pre.storageKey}`);
    return pre.storageKey;
  }
  const photoKey = await uploadPod('image/jpeg', Buffer.from('pod-photo-' + 'x'.repeat(400)));
  const sigKey = await uploadPod('image/png', Buffer.from('pod-signature-' + 'y'.repeat(200)));

  // POST the POD (the endpoint HEAD-verifies each object + links them) — then read back signed.
  const pod = await driver.captureProofOfDelivery(dStopId, { signatureStorageKey: sigKey, photoStorageKeys: [photoKey], geo: { lng: -79.4111, lat: 43.7615 } });
  check('POD signature is a signed read (no raw key)', !!pod.signature?.downloadUrl?.includes('X-Amz-Signature'));
  check('POD has 1 delivery photo (signed read)', pod.photos.length === 1 && !!pod.photos[0]?.downloadUrl?.includes('X-Amz-Signature'));
  check('POD geo round-trips', Math.abs((pod.geo?.lat ?? 0) - 43.7615) < 0.001, `${pod.geo?.lat?.toFixed(4)},${pod.geo?.lng?.toFixed(4)}`);

  // Idempotent on the stop — re-POST returns the same row.
  const pod2 = await driver.captureProofOfDelivery(dStopId, { signatureStorageKey: sigKey, photoStorageKeys: [photoKey] });
  check('POD is idempotent on the stop (same row)', pod2.id === pod.id);

  // With the POD captured, the delivery stop now COMPLETES.
  await driver.stopAction(dStopId, 'complete');
  const dWalked = await raw('GET', `/route-stops/${dStopId}`, dispatcher);
  check('delivery stop reached COMPLETED after POD', dWalked.json.status === 'COMPLETED');
  console.log('  · (the real camera + signature pad + device GPS are proven in the on-device run — see the handoff)');

  console.log(`\n✓ ALL ${passed} CHECKS PASSED — the driver duty loop + proof-of-delivery run end-to-end against the live API.\n`);
}

main().catch((err) => {
  console.error(`\n✗ INTEGRATION PROOF FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
