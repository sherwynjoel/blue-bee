/* eslint-disable no-console */
/**
 * Headless integration proof for the Track-A B2B ACCOUNT CONSOLE. Drives the console's REAL
 * `ConsoleApiClient` against the RUNNING backend over HTTP (no browser) and proves every page action
 * PERSISTS (before/after): the account directory + detail, the per-account scorecard, FULL
 * standing-order CRUD, the org-wide generation run, per-account billing terms, and batch invoicing.
 * RBAC negatives confirmed (a DRIVER token is 403 on the directory).
 *
 * Prereq: the API at API_BASE_URL with SMS_TRANSPORT=console + the seed applied (Account B =
 * Harbourview Condos, BATCH_PERIODIC). Run: npm --workspace @blue-bee/web run b2b-proof
 */
import { MemoryTokenStore, ApiError } from '@blue-bee/api-client';
import { ConsoleApiClient } from '../lib/api-client';

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const ACCOUNT_B = 'e0000000-0000-4000-8000-0000000000b0'; // Demo — Harbourview Condos (BUSINESS)
const PHONES = { owner: '+14165550001', driver: '+14165550006' };

let passed = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (!cond) throw new Error(`✗ ${label} ${detail}`);
  passed += 1;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function consoleClientFor(phone: string): Promise<ConsoleApiClient> {
  const client = new ConsoleApiClient(API, new MemoryTokenStore());
  const otp = await client.requestOtp(phone);
  await client.verifyOtp(phone, otp.devCode!);
  return client;
}

async function main(): Promise<void> {
  console.log(`\n▶ B2B account-console integration proof against ${API}\n`);

  const health = await fetch(`${API}/v1/health`).then((r) => r.status);
  check('API health 200', health === 200, `status=${health}`);

  const owner = await consoleClientFor(PHONES.owner);

  // ── [1] account directory ──
  console.log('\n[1] account directory (GET /v1/accounts)');
  const list = await owner.listAccounts({ limit: 100 });
  const b = list.accounts.find((a) => a.id === ACCOUNT_B);
  check('Account B is in the directory', !!b, b?.name);
  if (!b) throw new Error('Account B missing from the seed');
  check('B is a BUSINESS account', b.type === 'BUSINESS');
  check('B billingMode = BATCH_PERIODIC', b.billingMode === 'BATCH_PERIODIC');
  check('B has ≥1 active standing order', b.activeStandingOrderCount >= 1, `count=${b.activeStandingOrderCount}`);

  // ── [2] account detail ──
  console.log('\n[2] account detail (GET /v1/accounts/:id)');
  const detail = await owner.getAccount(ACCOUNT_B);
  check('detail returns the account sites', detail.sites.length >= 1, `${detail.sites.length} site(s)`);
  const site = detail.sites[0];
  const service = (await owner.getServices()).services[0];
  if (!site || !service) throw new Error('seed is missing a site or a service for the create flow');
  const siteId = site.id;
  const serviceId = service.id;

  // ── [3] scorecard (honesty firewall) ──
  console.log('\n[3] per-account scorecard');
  const sc = await owner.accountScorecard(ACCOUNT_B);
  check('scorecard on-time is a Metric wrapper', typeof sc.metrics.onTimePercent.status === 'string');
  check('cost-center split is honestly deferred (Phase 2)', sc.metrics.costCenterSplit.status === 'unavailable_in_phase_1');

  // ── [4] standing-order FULL CRUD — before/after persistence ──
  console.log('\n[4] standing-order CRUD (persisted)');
  const before = (await owner.listStandingOrders({ accountId: ACCOUNT_B, limit: 100 })).standingOrders.length;
  const created = await owner.createStandingOrder({
    accountId: ACCOUNT_B,
    siteId,
    serviceId,
    vertical: 'LINEN' as never,
    cadence: 'BIWEEKLY' as never,
    weekday: 3,
    pickupWindow: { start: '08:00', end: '10:00' },
    concierge: false,
    startsOn: new Date('2026-07-01T00:00:00.000Z'),
    active: true,
  });
  const afterCreate = (await owner.listStandingOrders({ accountId: ACCOUNT_B, limit: 100 })).standingOrders.length;
  check('CREATE persisted (+1)', afterCreate === before + 1, `${before} → ${afterCreate}`);

  await owner.updateStandingOrder(created.id, { active: false });
  const edited = (await owner.listStandingOrders({ accountId: ACCOUNT_B, limit: 100 })).standingOrders.find((s) => s.id === created.id);
  check('EDIT persisted (active=false)', !!edited && edited.active === false);

  await owner.deleteStandingOrder(created.id);
  const afterDelete = (await owner.listStandingOrders({ accountId: ACCOUNT_B, limit: 100 })).standingOrders.length;
  check('DELETE persisted (back to baseline)', afterDelete === before, `${afterCreate} → ${afterDelete}`);

  // ── [5] org-wide generation run ──
  console.log('\n[5] org-wide generation run');
  const gen = await owner.runStandingOrderGeneration({});
  check('run returns real counts', typeof gen.ordersCreated === 'number' && gen.standingOrdersConsidered >= 1, `considered=${gen.standingOrdersConsidered}`);
  const feed = await owner.getGeneratedForAccount(ACCOUNT_B);
  check('generated feed returns occurrences', Array.isArray(feed.occurrences));

  // ── [6] per-account billing terms — before/after (restored) ──
  console.log('\n[6] billing terms (persisted + restored)');
  const t0 = await owner.getBillingTerms(ACCOUNT_B);
  await owner.setBillingTerms(ACCOUNT_B, { billingMode: 'PER_ORDER' as never, netDays: 0 });
  const t1 = await owner.getBillingTerms(ACCOUNT_B);
  check('SET billing terms persisted (PER_ORDER)', t1.billingMode === 'PER_ORDER');
  await owner.setBillingTerms(ACCOUNT_B, { billingMode: 'BATCH_PERIODIC' as never, netDays: 30 });
  const t2 = await owner.getBillingTerms(ACCOUNT_B);
  check('billing terms restored (BATCH_PERIODIC net-30)', t2.billingMode === 'BATCH_PERIODIC' && t2.billingNetDays === 30, `was ${t0.billingMode}`);

  // ── [7] batch / periodic invoice (idempotent) ──
  console.log('\n[7] batch periodic invoice');
  const win = { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z', period: '2026-06' };
  const inv = await owner.batchInvoice(ACCOUNT_B, win);
  check('batch invoice has lines + a positive total', inv.lines.length >= 1 && Number(inv.total) > 0, `${inv.number} = ${inv.total} ${inv.currency}`);
  check('batch invoice is net-days dated', !!inv.dueAt);
  const inv2 = await owner.batchInvoice(ACCOUNT_B, win);
  check('batch invoice is idempotent (same id)', inv2.id === inv.id);

  // ── [8] RBAC negatives (server-authoritative) ──
  console.log('\n[8] RBAC negatives');
  const driver = await consoleClientFor(PHONES.driver);
  try {
    await driver.listAccounts();
    check('DRIVER blocked from the directory', false);
  } catch (e) {
    check('DRIVER → 403 on GET /v1/accounts', e instanceof ApiError && e.status === 403);
  }

  console.log(`\n✅ B2B account-console proof PASSED — ${passed} checks, all writes persisted against the real API.\n`);
}

main().catch((e) => {
  console.error(`\n✗ PROOF FAILED: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
