/* eslint-disable no-console */
/**
 * Headless corporate-pricing proof (Increment 16) for the Blue Bee CUSTOMER app. Drives the customer app's
 * REAL `CustomerApiClient` against the RUNNING backend over HTTP — proving the TTC join-code path the
 * customer app now exposes, against Inc-15's shipped engine:
 *   login (console OTP) → a BAD code is a clean 400 (ApiError) → redeem the seeded code MAPLELOFT
 *   (idempotent) → GET /corporate/memberships shows the joined account → BOOK with no service point →
 *   the order is priced on the corporate account (server truth: pricingAccount.name) → the same indicator
 *   the Settings/Book/OrderDetail screens render.
 *
 * Pricing is resolved SERVER-side (Inc-15); this proves the app reads + displays that truth, never
 * computes it. The on-device render of the screens is the founder's run.
 *
 * Prereq: the API running at API_BASE_URL (default http://localhost:3000) with SMS_TRANSPORT=console and
 * the seed applied (the corporate demo: Maple District Towers + MAPLELOFT). Run:
 *   npm --workspace @blue-bee/customer run corporate-proof
 */
import { ApiError, MemoryTokenStore } from '@blue-bee/api-client';
import { CustomerApiClient } from '../src/api/customer-client';

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const RITA = '+14165550010';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SVC_WASHFOLD = 'c0000000-0000-4000-8000-000000000002'; // seeded per-pound wash & fold
const MAPLE_CODE = 'MAPLELOFT';
const MAPLE_NAME = 'Demo — Maple District Towers (corporate)';

let passed = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (!cond) throw new Error(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
  passed += 1;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  console.log(`\n▶ Customer-app corporate-pricing proof against ${API}\n`);

  const health = await fetch(`${API}/v1/health`).then((r) => r.status);
  check('API health 200', health === 200, `status=${health}`);

  // ── [1] login through the REAL customer client ──
  console.log('\n[1] phone-OTP login (real customer client)');
  const customer = new CustomerApiClient(API, new MemoryTokenStore());
  const otp = await customer.requestOtp(RITA);
  check('OTP issued with a dev code', !!otp.devCode);
  await customer.verifyOtp(RITA, otp.devCode!);
  const me = await customer.me();
  check('/me hydrates the customer', me.user.accountIds.includes(ACCOUNT_A), me.user.name);

  // ── [2] a bad code is a clean 400 (server authority) — never a crash or a fake join ──
  console.log('\n[2] a bad join code → 400 (handled)');
  let badStatus = 0;
  try {
    await customer.redeemJoinCode({ code: 'NOTREAL9' });
  } catch (e) {
    badStatus = e instanceof ApiError ? e.status : -1;
  }
  check('an invalid code returns 400 (ApiError)', badStatus === 400, `status=${badStatus}`);

  // ── [3] redeem the seeded corporate code (idempotent) ──
  console.log('\n[3] redeem MAPLELOFT');
  const redeem = await customer.redeemJoinCode({ code: MAPLE_CODE });
  check('redeem grants an ACTIVE membership on the corporate account', redeem.status === 'ACTIVE', redeem.accountName);
  check('redeem names the corporate account (server truth)', redeem.accountName === MAPLE_NAME);
  const redeemAgain = await customer.redeemJoinCode({ code: MAPLE_CODE.toLowerCase() });
  check('re-redeeming the same code is idempotent (alreadyMember)', redeemAgain.alreadyMember === true);

  // ── [4] memberships shows ONLY the caller's own membership ──
  console.log('\n[4] my memberships');
  const memberships = await customer.listMyMemberships();
  const mine = memberships.memberships.find((m) => m.accountId === redeem.accountId);
  check('GET /corporate/memberships includes the joined account', !!mine && mine.status === 'ACTIVE', mine?.accountName);

  // ── [5] a booking with NO service point is priced on the corporate account (server truth) ──
  console.log('\n[5] book → corporate pricing applied (the indicator data)');
  const booked = await customer.book(
    { accountId: ACCOUNT_A, items: [{ kind: 'GARMENT' as never, serviceId: SVC_WASHFOLD, estimatedMeasure: 20 }] },
    `corp-proof-${Date.now()}`,
  );
  check('order booked', !!booked.id, booked.id);
  const detail = await customer.getOrder(booked.id);
  check('the order is priced on the corporate account', detail.pricingAccountId === redeem.accountId, detail.pricingAccountId ?? 'null');
  check('the order read carries the corporate account NAME (the app indicator)', detail.pricingAccount?.name === MAPLE_NAME, detail.pricingAccount?.name ?? 'null');

  console.log(`\n✅ corporate-pricing proof passed — ${passed} checks.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
