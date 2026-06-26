/* eslint-disable no-console */
/**
 * Headless integration proof (Increment 13) for the Blue Bee WEB CONSOLE. Drives the console's REAL
 * `ConsoleApiClient` against the RUNNING backend over HTTP — the full operator loop, no browser:
 *   ops login → orders queue → intake (schedule-pickup → receive → REAL /media upload → inspect) →
 *   quote (generate + approve) → routing (create → add stop → assign → optimize → publish → manifest)
 *   → live fleet (GET /fleet/live + a live WS /live/fleet position driven by a real locations:batch
 *   ping) → finance (signed payment_intent.succeeded → getPayment SUCCEEDED → invoice → partial
 *   refund → disputes). Plus RBAC negatives (a customer token gets no fleet/disputes).
 *
 * A web console is FULLY provable headlessly — there is NO on-device parked item.
 *
 * Prereq: the API running at API_BASE_URL with SMS_TRANSPORT=console, MinIO up, the seed applied, and
 * STRIPE_WEBHOOK_SECRET matching (default whsec_test_local_blue_bee).
 * Run: npm --workspace @blue-bee/web run integration
 */
import Stripe from 'stripe';
import { io } from 'socket.io-client';
import { MemoryTokenStore } from '@blue-bee/api-client';
import { PhotoKind, WS_EVENTS, WS_NAMESPACES, type LivePositionEvent } from '@blue-bee/shared';
import { ConsoleApiClient } from '../lib/api-client';

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_local_blue_bee';
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const SITE_NORTH = 'f1000000-0000-4000-8000-000000000001';
const PHONES = { owner: '+14165550001', dispatcher: '+14165550002', plant: '+14165550004', driver: '+14165550006', rita: '+14165550010' };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder_proof');
const runNonce = `web13-${Date.now()}`;
let evtSeq = 0;
let passed = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (!cond) throw new Error(`✗ ${label} ${detail}`);
  passed += 1;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function raw(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}/v1${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
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
  if (!code) throw new Error(`no devCode for ${phone} (SMS_TRANSPORT=console?)`);
  const verify = await raw('POST', '/auth/verify', undefined, { phone, code });
  return verify.json.accessToken;
}
async function fireWebhook(type: string, object: Record<string, unknown>): Promise<number> {
  const id = `${runNonce}_${type}_${++evtSeq}`;
  const payload = JSON.stringify({ id, object: 'event', api_version: '2024-06-20', type, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${API}/v1/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload });
  return res.status;
}
const piFromSecret = (cs: string): string => cs.split('_secret_')[0] ?? cs;

async function consoleClientFor(phone: string): Promise<ConsoleApiClient> {
  const client = new ConsoleApiClient(API, new MemoryTokenStore());
  const otp = await client.requestOtp(phone);
  await client.verifyOtp(phone, otp.devCode!);
  return client;
}

async function bookOrder(staffToken: string, ritaToken: string, measure = 40): Promise<string> {
  const res = await raw('POST', '/orders', ritaToken, { accountId: ACCOUNT_A, siteId: SITE_NORTH, items: [{ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: measure }] });
  if (res.status >= 300) throw new Error(`book failed: ${JSON.stringify(res.json)}`);
  return res.json.id;
}

async function main(): Promise<void> {
  console.log(`\n▶ Web-console integration proof against ${API}\n`);

  const health = await fetch(`${API}/v1/health`).then((r) => r.status);
  check('API health 200', health === 200, `status=${health}`);

  const ownerRaw = await loginRaw(PHONES.owner);
  const dispatcherRaw = await loginRaw(PHONES.dispatcher);
  const driverRaw = await loginRaw(PHONES.driver);
  const ritaRaw = await loginRaw(PHONES.rita);

  // ── [1] ops login through the REAL ConsoleApiClient ──
  console.log('\n[1] ops login (real ConsoleApiClient)');
  const owner = await consoleClientFor(PHONES.owner);
  const me = await owner.me();
  check('/me is an ops role (OWNER)', me.user.roles.some((r) => r.role === 'OWNER'), me.user.name);

  // ── [2] orders queue ──
  console.log('\n[2] orders queue');
  const queue = await owner.listOrders({ limit: 50 });
  check('GET /orders returns the queue', Array.isArray(queue.orders), `${queue.orders.length} orders`);

  // ── [3] intake: schedule-pickup → receive → REAL media upload → inspect ──
  console.log('\n[3] intake + inspection (+ real /media upload)');
  const orderId = await bookOrder(ownerRaw, ritaRaw);
  await owner.schedulePickup(orderId, { pickupWindow: { start: new Date(Date.now() + 3.6e6).toISOString(), end: new Date(Date.now() + 7.2e6).toISOString() } });
  const received = await owner.receivedAtPlant(orderId);
  check('received-at-plant → PICKED_UP', received.status === 'PICKED_UP', received.status);
  const itemId = received.items[0]!.id;

  const bytes = Buffer.from('blue-bee-console-damage-photo-' + 'x'.repeat(300));
  const presign = await owner.presignMedia({ orderId, itemId, kind: PhotoKind.INTAKE, contentType: 'image/jpeg', byteSize: bytes.length });
  check('media presign → signed PUT url + org key', presign.uploadUrl.includes('X-Amz-Signature') && /^org\//.test(presign.storageKey));
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(bytes) });
  check('PUT real bytes accepted', put.status >= 200 && put.status < 300, `status=${put.status}`);
  const photo = await owner.confirmMedia({ storageKey: presign.storageKey, takenAt: new Date().toISOString() });
  check('confirm → Photo with a signed downloadUrl', !!photo.downloadUrl && photo.downloadUrl.includes('X-Amz-Signature'));

  const inspected = await owner.inspectItem(orderId, itemId, { conditionCodes: ['frayed'], measurements: { sqft: 40 }, preexistingDamage: true, customerAck: true, damagePhotoId: photo.id });
  check('inspection w/ pre-existing damage recorded', inspected.status === 'DAMAGE_PREEXISTING_FLAGGED' || inspected.status === 'INTAKE_INSPECTED', inspected.status);

  // ── [4] quote: generate + approve ──
  console.log('\n[4] quote');
  const built = await owner.buildQuote(orderId, { upcharges: [], expiresInDays: 14 });
  check('buildQuote → QUOTED with a total', built.order.status === 'QUOTED' && !!built.order.totals?.total, built.order.totals?.total ?? '');
  const approved = await owner.approveQuote(orderId);
  check('approveQuote (ops) → QUOTE_APPROVED', approved.status === 'QUOTE_APPROVED');

  // ── [5] routing / dispatch ──
  console.log('\n[5] routing / dispatch');
  const stopOrderId = await bookOrder(ownerRaw, ritaRaw, 25); // a REQUESTED order for the pickup stop
  // Resolve the driver profile that OWNS the driver token (so its locations:batch ping is accepted).
  const driverUserId = (await raw('GET', '/me', driverRaw)).json.user.userId;
  await raw('POST', '/drivers', dispatcherRaw, { userId: driverUserId }); // ensure a profile (201 or already-exists)
  const drivers = await owner.listDrivers();
  const driverId = drivers.find((d) => d.userId === driverUserId)?.id;
  if (!driverId) throw new Error('no driver profile for the driver token');
  const vehicle = await owner.createVehicle({ label: `Console Van ${Date.now() % 100000}`, plate: `CON-${Date.now() % 100000}` });
  let route = await owner.createRoute({ date: new Date('2026-07-22') as unknown as Date });
  check('createRoute → PLANNED', route.status === 'PLANNED');
  await owner.addStop(route.id, { orderId: stopOrderId, kind: 'PICKUP' as never });
  route = await owner.getRoute(route.id); // addStop returns the stop; re-fetch the route to re-sync
  check('addStop → 1 stop', route.stops.length === 1);
  route = await owner.assignRoute(route.id, { driverId, vehicleId: vehicle.id });
  route = await owner.optimizeRoute(route.id);
  check('optimize → optimized', route.optimized === true);
  route = await owner.publishRoute(route.id);
  check('publish → PUBLISHED', route.status === 'PUBLISHED');
  const manifest = await owner.routeManifest(route.id);
  check('manifest generated', Array.isArray(manifest.lines) && manifest.lines.length >= 1, `${manifest.lines.length} line(s)`);

  // ── [6] live fleet: snapshot + WS position (driven by a real ping) ──
  console.log('\n[6] live fleet (REST snapshot + WS position)');
  const shift = await owner.createShift({ driverId, vehicleId: vehicle.id });
  await owner.startShift(shift.id);
  const token = await owner.accessToken();
  const socket = io(`${API}${WS_NAMESPACES.FLEET}`, { transports: ['websocket'], reconnection: false, auth: { token } });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (e: Error) => reject(new Error(`WS connect_error: ${e.message}`)));
    setTimeout(() => reject(new Error('WS connect timeout')), 6000);
  });
  check('WS /live/fleet connected with the access JWT', socket.connected);
  const positionP = new Promise<LivePositionEvent>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no position event')), 8000);
    socket.once(WS_EVENTS.POSITION, (p: LivePositionEvent) => {
      clearTimeout(t);
      resolve(p);
    });
  });
  const now = Date.now();
  const ping = await raw('POST', '/locations:batch', driverRaw, { shiftId: shift.id, vehicleId: vehicle.id, pings: [{ lat: 43.7615, lng: -79.4111, recordedAt: new Date(now).toISOString() }] });
  check('locations:batch ping accepted (driver owns the shift)', ping.status >= 200 && ping.status < 300, `status=${ping.status}`);
  const position = await positionP;
  check('WS streamed a live position for the org fleet', position.vehicleId === vehicle.id, `@ ${position.lat},${position.lng}`);
  const fleet = await owner.fleetLive();
  check('GET /fleet/live shows the vehicle', fleet.vehicles.some((v) => v.vehicleId === vehicle.id) || fleet.withoutPosition.some((v) => v.vehicleId === vehicle.id));
  socket.disconnect();

  // ── [7] finance: webhook-confirmed payment → invoice → refund → disputes ──
  console.log('\n[7] finance (payment → invoice → refund → disputes)');
  const intent = await raw('POST', `/orders/${orderId}/payment-intent`, ownerRaw, {});
  check('create-payment-intent (server amount)', intent.status === 201 && !!intent.json?.clientSecret, intent.json?.amount);
  const piId = piFromSecret(intent.json.clientSecret);
  const succ = await fireWebhook('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: Math.round(Number(intent.json.amount) * 100), amount_received: Math.round(Number(intent.json.amount) * 100), currency: 'cad', status: 'succeeded', latest_charge: `${runNonce}_ch`, metadata: { orgId: ORG1, orderId } });
  check('signed payment_intent.succeeded accepted (200)', succ === 200);
  const payment = await owner.getPayment(orderId);
  check('console reads the SUCCEEDED payment', payment?.status === 'SUCCEEDED', `captured=${payment?.capturedAmount}`);
  const invoice = await owner.getInvoice(orderId);
  check('console reads the PAID receipt', invoice?.status === 'PAID', `total=${invoice?.total}`);
  const refund = await owner.refundPayment(payment!.id, { amount: 10, reason: 'requested_by_customer' });
  check('console issues a partial refund', refund.amount === '10.00', `status=${refund.status}`);
  const disputes = await owner.listDisputes();
  check('console reads disputes (owner/finance)', Array.isArray(disputes));

  // ── [8] RBAC negatives: a customer token gets no ops surfaces ──
  console.log('\n[8] RBAC — a customer token gets nothing');
  const rita = await consoleClientFor(PHONES.rita);
  const ritaFleet = await rita.fleetLive().then(() => 0).catch((e) => e.status);
  check('customer fleetLive → 403', ritaFleet === 403, `status=${ritaFleet}`);
  const ritaDisputes = await rita.listDisputes().then(() => 0).catch((e) => e.status);
  check('customer listDisputes → 403', ritaDisputes === 403, `status=${ritaDisputes}`);

  console.log(`\n✓ ALL ${passed} CHECKS PASSED — the web console operator loop runs end-to-end against the live API.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n✗ INTEGRATION PROOF FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
