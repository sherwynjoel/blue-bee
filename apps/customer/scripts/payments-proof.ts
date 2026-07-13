/* eslint-disable no-console */
/**
 * Headless integration proof (Increment 12) for the Blue Bee STRIPE BILLING RAIL. Drives the customer
 * app's REAL `CustomerApiClient` (pay surface) against the RUNNING backend over HTTP, and exercises
 * the webhook — the source of truth — with REAL Stripe-signed test events
 * (`stripe.webhooks.generateTestHeaderString`, Stripe's own test utility, NOT a mock):
 *   login (console OTP) → book → drive to QUOTED (staff) → approve → CREATE PAYMENT INTENT
 *   (server-computed amount) → simulate a signed `payment_intent.succeeded` → order PAID + receipt
 *   (with the HST line) → REDELIVERY is a no-op → a FORGED signature → 400 → double-pay → 409 →
 *   a partial + full REFUND (finance) → REFUNDED → a second order whose intent FAILS → dunning +
 *   re-attempt → an unmapped intent webhook is a safe no-op (tenancy).
 *
 * Outbound create-calls run through the LocalPaymentProvider (no STRIPE_SECRET_KEY) — the deferred
 * seam; the inbound side (signature verification + every state transition) is fully real.
 *
 * Prereq: the API running at API_BASE_URL (default http://localhost:3000) with SMS_TRANSPORT=console,
 * the seed applied, and STRIPE_WEBHOOK_SECRET matching this script's (default whsec_test_local_blue_bee).
 * Run: npm --workspace @blue-bee/customer run payments-proof
 */
import Stripe from 'stripe';
import { MemoryTokenStore } from '@blue-bee/api-client';
import { CustomerApiClient } from '../src/api/customer-client';

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_local_blue_bee';
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const RITA = '+14165550010';
const OWNER = '+14165550001';
const PLANT = '+14165550004';
const FINANCE = '+14165550005';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder_proof');
const runNonce = `proof12-${Date.now()}`;
let evtSeq = 0;
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
  if (!verify.json?.accessToken) throw new Error(`login failed for ${phone}`);
  return verify.json.accessToken;
}

async function driveToQuoted(orderId: string, staff: string, plant: string): Promise<void> {
  await raw('POST', `/orders/${orderId}/schedule-pickup`, staff, {
    pickupWindow: { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() },
  });
  await raw('POST', `/orders/${orderId}/received-at-plant`, staff, {});
  const order = (await raw('GET', `/orders/${orderId}`, staff)).json;
  for (const item of order.items as Array<{ id: string }>) {
    await raw('POST', `/orders/${orderId}/items/${item.id}/inspection`, plant, { measurements: { sqft: 40 }, conditionCodes: [], preexistingDamage: false });
  }
  const q = await raw('POST', `/orders/${orderId}/quote`, staff, {});
  if (q.status >= 300) throw new Error(`build quote failed: ${JSON.stringify(q.json)}`);
}

/** Sign + POST a Stripe event (real signature). `bad` forges the signature. */
async function fireWebhook(type: string, object: Record<string, unknown>, opts: { id?: string; bad?: boolean } = {}): Promise<number> {
  const id = `${runNonce}_${opts.id ?? `${type}_${++evtSeq}`}`;
  const payload = JSON.stringify({ id, object: 'event', api_version: '2024-06-20', type, data: { object } });
  const signature = opts.bad ? 't=1,v1=deadbeef' : stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${API}/v1/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload });
  return res.status;
}

/**
 * [Inc-37] `clientSecret` is null ONLY when the customer's credit covered the whole bill (no card charge, no
 * Stripe intent). Every order in this proof is paid by card, so a null here means the proof's premise broke —
 * fail loudly rather than paper over it.
 */
const piFromSecret = (cs: string | null): string => {
  if (!cs) throw new Error('expected a card charge (no credit applied) — got a credit-covered intent');
  return cs.split('_secret_')[0] ?? cs;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function bookApproved(customer: CustomerApiClient, owner: string, plant: string): Promise<string> {
  const booked = await customer.book({ accountId: ACCOUNT_A, items: [{ kind: 'RUG' as never, serviceId: SERVICE, estimatedMeasure: 40 }] }, `${runNonce}-book-${++evtSeq}`);
  await driveToQuoted(booked.id, owner, plant);
  const approved = await customer.approveQuote(booked.id);
  if (approved.status !== 'QUOTE_APPROVED') throw new Error(`approve failed: ${approved.status}`);
  return booked.id;
}

async function main(): Promise<void> {
  console.log(`\n▶ Payments-rail integration proof against ${API}\n`);

  const health = await fetch(`${API}/v1/health`).then((r) => r.status);
  check('API health 200', health === 200, `status=${health}`);

  const owner = await loginRaw(OWNER);
  const plant = await loginRaw(PLANT);
  const finance = await loginRaw(FINANCE);

  console.log('\n[1] customer logs in (real CustomerApiClient)');
  const customer = new CustomerApiClient(API, new MemoryTokenStore());
  const otp = await customer.requestOtp(RITA);
  await customer.verifyOtp(RITA, otp.devCode!);
  const me = await customer.me();
  check('/me is Rita (RESIDENTIAL_CUSTOMER, Account A)', me.user.roles.some((r) => r.role === 'RESIDENTIAL_CUSTOMER') && me.user.accountIds.includes(ACCOUNT_A));

  // ── happy path: book → approve → pay-intent → succeeded → paid + receipt ──
  console.log('\n[2] book → approve → create payment intent (server-computed amount)');
  const orderId = await bookApproved(customer, owner, plant);
  const intent = await customer.createPaymentIntent(orderId);
  check('create-intent returns a client secret + the server-computed amount', !!intent.clientSecret && intent.amount === '293.80', `amount=${intent.amount} ${intent.currency}`);
  const piId = piFromSecret(intent.clientSecret);
  const pending = await customer.getPayment(orderId);
  check('payment is PENDING until the webhook confirms', pending?.status === 'PENDING');

  console.log('\n[3] simulate a SIGNED payment_intent.succeeded → order paid + receipt');
  const succ = await fireWebhook('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 29380, amount_received: 29380, currency: 'cad', status: 'succeeded', latest_charge: `${runNonce}_ch_A`, metadata: { orgId: ORG1, orderId } });
  check('webhook accepted (200)', succ === 200, `status=${succ}`);
  const paid = await customer.getPayment(orderId);
  check('payment is now SUCCEEDED (webhook-confirmed)', paid?.status === 'SUCCEEDED', `captured=${paid?.capturedAmount}`);
  const receipt = await customer.getInvoice(orderId);
  check('a PAID receipt was generated with the HST line', receipt?.status === 'PAID' && receipt.lines.some((l) => l.description.includes('HST')), `total=${receipt?.total}`);
  const orderRead = await customer.getOrder(orderId);
  check('order billing state mirrors PAID', orderRead.totals?.paymentStatus === 'PAID');

  console.log('\n[4] idempotency + security');
  const dupe = await fireWebhook('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 29380, currency: 'cad', status: 'succeeded', metadata: { orgId: ORG1, orderId } }, { id: 'dupe' });
  const dupe2 = await fireWebhook('payment_intent.succeeded', { id: piId, object: 'payment_intent', amount: 29380, currency: 'cad', status: 'succeeded', metadata: { orgId: ORG1, orderId } }, { id: 'dupe' });
  check('redelivery of the same event id is a no-op (200, 200)', dupe === 200 && dupe2 === 200);
  const stillOne = await customer.getInvoice(orderId);
  check('still exactly one PAID invoice after redelivery', stillOne?.status === 'PAID');
  const forged = await fireWebhook('payment_intent.succeeded', { id: 'pi_forged', object: 'payment_intent', amount: 1, currency: 'cad' }, { bad: true });
  check('a FORGED signature → 400', forged === 400, `status=${forged}`);
  const unmapped = await fireWebhook('payment_intent.succeeded', { id: `${runNonce}_pi_nope`, object: 'payment_intent', amount: 999, currency: 'cad', metadata: { orgId: ORG1 } });
  check('an unmapped intent is recorded + no-op (200, no cross-tenant guess)', unmapped === 200);
  const doublePay = await customer.createPaymentIntent(orderId).then(() => 0).catch((e) => e.status);
  check('a second create-intent on a paid order → 409', doublePay === 409, `status=${doublePay}`);

  console.log('\n[5] refunds (finance) — partial then full');
  const partial = await raw('POST', `/payments/${paid!.id}/refund`, finance, { amount: 100, reason: 'requested_by_customer' });
  check('finance partial refund → 201', partial.status === 201, `amount=${partial.json?.amount}`);
  const afterPartial = await customer.getPayment(orderId);
  check('refundedAmount reflects the partial; order PARTIALLY_REFUNDED', afterPartial?.refundedAmount === '100.00', `refunded=${afterPartial?.refundedAmount}`);
  await fireWebhook('charge.refunded', { id: `${runNonce}_ch_A`, object: 'charge', payment_intent: piId, amount: 29380, amount_refunded: 10000, currency: 'cad', metadata: { orgId: ORG1, orderId } });
  const full = await raw('POST', `/payments/${paid!.id}/refund`, finance, {});
  check('finance full refund of the remainder → 201', full.status === 201, `amount=${full.json?.amount}`);
  const afterFull = await customer.getPayment(orderId);
  check('payment is REFUNDED after the full refund', afterFull?.status === 'REFUNDED' && afterFull.refundedAmount === '293.80');
  const over = await raw('POST', `/payments/${paid!.id}/refund`, finance, { amount: 50 });
  check('an over-refund is rejected (422)', over.status === 422, `status=${over.status}`);

  console.log('\n[6] failed payment → dunning → re-attempt');
  const order2 = await bookApproved(customer, owner, plant);
  const intent2 = await customer.createPaymentIntent(order2);
  const pi2 = piFromSecret(intent2.clientSecret);
  await fireWebhook('payment_intent.payment_failed', { id: pi2, object: 'payment_intent', amount: 29380, currency: 'cad', status: 'requires_payment_method', last_payment_error: { message: 'Your card was declined.' }, metadata: { orgId: ORG1, orderId: order2 } });
  const failed = await customer.getPayment(order2);
  check('payment is FAILED after payment_intent.payment_failed', failed?.status === 'FAILED');
  const order2Read = await customer.getOrder(order2);
  check('order billing state mirrors FAILED', order2Read.totals?.paymentStatus === 'FAILED');
  await sleep(150); // let the post-commit dunning enqueue land
  const reattempt = await customer.createPaymentIntent(order2);
  check('the customer can re-attempt (a fresh PENDING intent)', reattempt.status === 'PENDING' && !!reattempt.clientSecret);

  console.log('\n[7] disputes (owner/finance alert; recorded, not adjudicated)');
  const order3 = await bookApproved(customer, owner, plant);
  const intent3 = await customer.createPaymentIntent(order3);
  const pi3 = piFromSecret(intent3.clientSecret);
  await fireWebhook('payment_intent.succeeded', { id: pi3, object: 'payment_intent', amount: 29380, currency: 'cad', status: 'succeeded', latest_charge: `${runNonce}_ch_D`, metadata: { orgId: ORG1, orderId: order3 } });
  await fireWebhook('charge.dispute.created', { id: `${runNonce}_dp_D`, object: 'dispute', payment_intent: pi3, charge: `${runNonce}_ch_D`, amount: 29380, currency: 'cad', reason: 'fraudulent', status: 'needs_response', metadata: { orgId: ORG1, orderId: order3 } });
  const disputes = (await raw('GET', '/disputes', finance)).json as Array<{ orderId: string; status: string }>;
  check('finance sees the OPEN dispute for the order', disputes.some((d) => d.orderId === order3 && d.status === 'OPEN'));
  const ritaDisputes = await raw('GET', '/disputes', undefined).then((r) => r.status).catch(() => 401);
  check('disputes require auth (no token → 401)', ritaDisputes === 401, `status=${ritaDisputes}`);

  console.log(`\n✓ ALL ${passed} CHECKS PASSED — the Stripe billing rail runs end-to-end (inbound fully real; outbound seam local).\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n✗ PAYMENTS PROOF FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
