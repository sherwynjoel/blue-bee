import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Analytics e2e (Increment 15, PRD §13 / Epic B6.1) — locks the three read-only aggregation routes
 * (GET /v1/analytics/operational | /commercial | /accounts/:id/scorecard). Proves:
 *   • REAL aggregation — every asserted number is computed by the server over rows this spec planted.
 *   • RBAC — a non-authorized role (DRIVER, customer) → 403; commercial/scorecard are tighter than operational.
 *   • ORG-SCOPING — an Org-2 owner gets 200 but never sees Org-1 rows (commercial = 0; scorecard id → 404).
 *   • HONESTY FIREWALL — Phase-2-only metrics carry status 'unavailable_in_phase_1' (never faked).
 *
 * The fixture lives in a FIXED HISTORICAL WINDOW [2025-11-01, 2025-12-01) under two dedicated Org-1
 * accounts, with deterministic ids, created + torn down by this spec. The shared dev DB accumulates
 * rows from other e2e runs (all `now()`-stamped, 2026+), so querying the Nov-2025 window isolates the
 * fixture exactly — the asserted aggregates are immune to that noise.
 */

const ORG1 = '11111111-1111-4111-8111-111111111111';
const WIN_FROM = new Date('2025-11-01T00:00:00.000Z');
const WIN_TO = new Date('2025-12-01T00:00:00.000Z');
const QS = `from=${WIN_FROM.toISOString()}&to=${WIN_TO.toISOString()}`;

// Deterministic fixture ids (prefix a5 = analytics Inc-15).
const ACCT_A = 'a5000000-0000-4000-8000-000000000001';
const ACCT_B = 'a5000000-0000-4000-8000-000000000002';
const O1 = 'a5000000-0000-4000-8000-000000000101';
const O2 = 'a5000000-0000-4000-8000-000000000102';
const O3 = 'a5000000-0000-4000-8000-000000000103';
const O4 = 'a5000000-0000-4000-8000-000000000104';
const ORDER_IDS = [O1, O2, O3, O4];
const ITEM1 = 'a5000000-0000-4000-8000-000000000201';
const ITEM2 = 'a5000000-0000-4000-8000-000000000202';
const ITEM3 = 'a5000000-0000-4000-8000-000000000203';
const ITEM4 = 'a5000000-0000-4000-8000-000000000204';
const CLAIM_LOSS = 'a5000000-0000-4000-8000-000000000301';
const CLAIM_DMG = 'a5000000-0000-4000-8000-000000000302';
const Q1 = 'a5000000-0000-4000-8000-000000000401';
const Q2 = 'a5000000-0000-4000-8000-000000000402';
const Q3 = 'a5000000-0000-4000-8000-000000000403';
const Q4 = 'a5000000-0000-4000-8000-000000000404';
const ROUTE1 = 'a5000000-0000-4000-8000-000000000501';
const S1 = 'a5000000-0000-4000-8000-000000000601';
const S2 = 'a5000000-0000-4000-8000-000000000602';
const S3 = 'a5000000-0000-4000-8000-000000000603';
const S4 = 'a5000000-0000-4000-8000-000000000604';
const S5 = 'a5000000-0000-4000-8000-000000000605';
const PAY1 = 'a5000000-0000-4000-8000-000000000701';
const PAY2 = 'a5000000-0000-4000-8000-000000000702';
const INV1 = 'a5000000-0000-4000-8000-000000000801';
const INV2 = 'a5000000-0000-4000-8000-000000000802';
const INV3 = 'a5000000-0000-4000-8000-000000000803';

const PHONES = {
  owner: '+14165550001', // OWNER (Org 1)
  finance: '+14165550005', // FINANCE (Org 1)
  dispatcher: '+14165550002', // DISPATCHER (Org 1) — RBAC negative on commercial/scorecard
  csr: '+14165550003', // CSR (Org 1)
  driver: '+14165550006', // DRIVER (Org 1) — org staff but NOT analytics → 403 everywhere
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER — 403 everywhere
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org isolation probe
};

const at = (iso: string) => new Date(iso);
const money = (v: string) => v; // fixed-2 dollar strings cross the wire verbatim

async function tearDown(prisma: PrismaClient): Promise<void> {
  // FK-safe order; idempotent (no-op when absent).
  await prisma.geofenceEvent.deleteMany({ where: { routeStop: { routeId: ROUTE1 } } });
  await prisma.routeStop.deleteMany({ where: { routeId: ROUTE1 } });
  await prisma.route.deleteMany({ where: { id: ROUTE1 } });
  await prisma.payment.deleteMany({ where: { id: { in: [PAY1, PAY2] } } });
  await prisma.invoice.deleteMany({ where: { id: { in: [INV1, INV2, INV3] } } });
  await prisma.quote.deleteMany({ where: { id: { in: [Q1, Q2, Q3, Q4] } } });
  await prisma.claim.deleteMany({ where: { id: { in: [CLAIM_LOSS, CLAIM_DMG] } } });
  await prisma.item.deleteMany({ where: { id: { in: [ITEM1, ITEM2, ITEM3, ITEM4] } } });
  await prisma.order.deleteMany({ where: { id: { in: ORDER_IDS } } });
  await prisma.account.deleteMany({ where: { id: { in: [ACCT_A, ACCT_B] } } });
}

async function seedFixture(prisma: PrismaClient): Promise<void> {
  await prisma.account.createMany({
    data: [
      { id: ACCT_A, orgId: ORG1, type: 'BUSINESS', name: 'Analytics Fixture A' },
      { id: ACCT_B, orgId: ORG1, type: 'BUSINESS', name: 'Analytics Fixture B' },
    ],
  });

  // 4 orders (createdAt in window): GMV 100+200+300+400=1000; O3 is REWASH; AcctA has 3, AcctB has 1.
  await prisma.order.createMany({
    data: [
      { id: O1, orgId: ORG1, accountId: ACCT_A, vertical: 'SPECIALTY', type: 'JOB', status: 'DELIVERED', totals: { total: '100.00', currency: 'CAD' }, createdAt: at('2025-11-05T09:00:00Z') },
      { id: O2, orgId: ORG1, accountId: ACCT_A, vertical: 'SPECIALTY', type: 'JOB', status: 'DELIVERED', totals: { total: '200.00', currency: 'CAD' }, createdAt: at('2025-11-06T09:00:00Z') },
      { id: O3, orgId: ORG1, accountId: ACCT_A, vertical: 'SPECIALTY', type: 'JOB', status: 'REWASH', totals: { total: '300.00', currency: 'CAD' }, createdAt: at('2025-11-07T09:00:00Z') },
      { id: O4, orgId: ORG1, accountId: ACCT_B, vertical: 'SPECIALTY', type: 'JOB', status: 'DELIVERED', totals: { total: '400.00', currency: 'CAD' }, createdAt: at('2025-11-08T09:00:00Z') },
    ],
  });

  // Items: 4 total in AcctA(3: I1,I2 on O1; I3 on O2) + AcctB(1: I4 on O4). 3 are READY/DELIVERED (throughput).
  await prisma.item.createMany({
    data: [
      { id: ITEM1, orgId: ORG1, orderId: O1, kind: 'RUG', status: 'DELIVERED', createdAt: at('2025-11-05T09:30:00Z') },
      { id: ITEM2, orgId: ORG1, orderId: O1, kind: 'RUG', status: 'DELIVERED', createdAt: at('2025-11-05T09:30:00Z') },
      { id: ITEM3, orgId: ORG1, orderId: O2, kind: 'RUG', status: 'READY', createdAt: at('2025-11-06T09:30:00Z') },
      { id: ITEM4, orgId: ORG1, orderId: O4, kind: 'RUG', status: 'RECEIVED', createdAt: at('2025-11-08T09:30:00Z') },
    ],
  });

  // Claims: 1 LOSS (item I2, AcctA), 1 DAMAGE (RESOLVED, item I1) — resolution 3 days via backdated updatedAt.
  await prisma.claim.createMany({
    data: [
      { id: CLAIM_LOSS, orgId: ORG1, orderId: O1, itemId: ITEM2, type: 'LOSS', status: 'OPEN', createdAt: at('2025-11-09T09:00:00Z') },
      { id: CLAIM_DMG, orgId: ORG1, orderId: O1, itemId: ITEM1, type: 'DAMAGE', status: 'RESOLVED', amount: '50.00', createdAt: at('2025-11-10T00:00:00Z') },
    ],
  });

  // Quotes: 2 APPROVED (2h, 6h), 1 SENT, 1 DECLINED → conversion 2/4=50%, median approval 4h.
  await prisma.quote.createMany({
    data: [
      { id: Q1, orgId: ORG1, orderId: O1, subtotal: '88.50', tax: '11.50', total: '100.00', status: 'APPROVED', createdAt: at('2025-11-05T10:00:00Z'), approvedAt: at('2025-11-05T12:00:00Z') },
      { id: Q2, orgId: ORG1, orderId: O2, subtotal: '177.00', tax: '23.00', total: '200.00', status: 'APPROVED', createdAt: at('2025-11-06T10:00:00Z'), approvedAt: at('2025-11-06T16:00:00Z') },
      { id: Q3, orgId: ORG1, orderId: O3, subtotal: '265.50', tax: '34.50', total: '300.00', status: 'SENT', createdAt: at('2025-11-07T10:00:00Z') },
      { id: Q4, orgId: ORG1, orderId: O4, subtotal: '354.00', tax: '46.00', total: '400.00', status: 'DECLINED', createdAt: at('2025-11-08T10:00:00Z') },
    ],
  });

  // Route + 5 stops on 2025-11-15. 4 COMPLETED (2 pickup, 2 delivery; 1 on-time each kind) + 1 FAILED.
  await prisma.route.create({
    data: { id: ROUTE1, orgId: ORG1, date: at('2025-11-15T00:00:00Z'), status: 'COMPLETED', createdAt: at('2025-11-15T08:00:00Z') },
  });
  await prisma.routeStop.createMany({
    data: [
      { id: S1, orgId: ORG1, routeId: ROUTE1, seq: 1, kind: 'PICKUP', accountId: ACCT_A, orderId: O1, status: 'COMPLETED', timeWindow: { start: '2025-11-15T09:00:00Z', end: '2025-11-15T10:00:00Z' }, arrivedAt: at('2025-11-15T09:30:00Z'), completedAt: at('2025-11-15T09:50:00Z'), createdAt: at('2025-11-15T08:00:00Z') },
      { id: S2, orgId: ORG1, routeId: ROUTE1, seq: 2, kind: 'PICKUP', accountId: ACCT_A, orderId: O2, status: 'COMPLETED', timeWindow: { start: '2025-11-15T10:00:00Z', end: '2025-11-15T11:00:00Z' }, arrivedAt: at('2025-11-15T11:10:00Z'), completedAt: at('2025-11-15T11:30:00Z'), createdAt: at('2025-11-15T08:00:00Z') },
      { id: S3, orgId: ORG1, routeId: ROUTE1, seq: 3, kind: 'DELIVERY', accountId: ACCT_A, orderId: O1, status: 'COMPLETED', timeWindow: { start: '2025-11-15T13:00:00Z', end: '2025-11-15T14:00:00Z' }, arrivedAt: at('2025-11-15T13:30:00Z'), completedAt: at('2025-11-15T13:45:00Z'), createdAt: at('2025-11-15T08:00:00Z') },
      { id: S4, orgId: ORG1, routeId: ROUTE1, seq: 4, kind: 'DELIVERY', accountId: ACCT_A, orderId: O2, status: 'COMPLETED', timeWindow: { start: '2025-11-15T14:00:00Z', end: '2025-11-15T15:00:00Z' }, arrivedAt: at('2025-11-15T15:10:00Z'), completedAt: at('2025-11-15T15:20:00Z'), createdAt: at('2025-11-15T08:00:00Z') },
      { id: S5, orgId: ORG1, routeId: ROUTE1, seq: 5, kind: 'DELIVERY', accountId: ACCT_B, orderId: O4, status: 'FAILED', exceptionReason: 'customer absent', createdAt: at('2025-11-15T08:00:00Z') },
    ],
  });
  // Geofence ARRIVED→DEPARTED for S1 (25m) + S3 (20m); S2/S4 fall back to arrived→completed (20m, 10m).
  await prisma.geofenceEvent.createMany({
    data: [
      { orgId: ORG1, routeStopId: S1, type: 'ARRIVED', occurredAt: at('2025-11-15T09:30:00Z') },
      { orgId: ORG1, routeStopId: S1, type: 'DEPARTED', occurredAt: at('2025-11-15T09:55:00Z') },
      { orgId: ORG1, routeStopId: S3, type: 'ARRIVED', occurredAt: at('2025-11-15T13:30:00Z') },
      { orgId: ORG1, routeStopId: S3, type: 'DEPARTED', occurredAt: at('2025-11-15T13:50:00Z') },
    ],
  });

  // Payments for AcctA (monthly spend = 250). Not linked to the AR invoices (so those stay fully outstanding).
  await prisma.payment.createMany({
    data: [
      { id: PAY1, orgId: ORG1, orderId: O1, accountId: ACCT_A, method: 'CARD', amount: '100.00', status: 'SUCCEEDED', capturedAmount: '100.00', capturedAt: at('2025-11-20T09:00:00Z') },
      { id: PAY2, orgId: ORG1, orderId: O2, accountId: ACCT_A, method: 'CARD', amount: '150.00', status: 'SUCCEEDED', capturedAmount: '150.00', capturedAt: at('2025-11-21T09:00:00Z') },
    ],
  });
  // Invoices issued in window: INV1 OVERDUE due 2025-11-29 (1-30, 500), INV2 ISSUED due 2025-12-15 (current, 300),
  // INV3 PAID (excluded from AR). AR total outstanding = 800.
  await prisma.invoice.createMany({
    data: [
      { id: INV1, orgId: ORG1, accountId: ACCT_A, subtotal: '442.48', tax: '57.52', total: '500.00', status: 'OVERDUE', issuedAt: at('2025-11-02T09:00:00Z'), dueAt: at('2025-11-29T00:00:00Z') },
      { id: INV2, orgId: ORG1, accountId: ACCT_B, subtotal: '265.49', tax: '34.51', total: '300.00', status: 'ISSUED', issuedAt: at('2025-11-03T09:00:00Z'), dueAt: at('2025-12-15T00:00:00Z') },
      { id: INV3, orgId: ORG1, accountId: ACCT_A, subtotal: '176.99', tax: '23.01', total: '200.00', status: 'PAID', issuedAt: at('2025-11-04T09:00:00Z'), paidAt: at('2025-11-10T09:00:00Z'), dueAt: at('2025-11-18T00:00:00Z') },
    ],
  });

  // Backdate the @updatedAt-managed fields the metrics key on (Prisma forces updatedAt=now on create).
  // RouteStop adherence/failed-skip & Item throughput query updatedAt ∈ window; the resolved claim's
  // resolution time is updatedAt−createdAt (3 days).
  await prisma.$executeRaw`UPDATE "RouteStop" SET updated_at = created_at WHERE route_id = ${ROUTE1}::uuid`;
  // Window+org targets exactly the 4 fixture items (the Nov-2025 window is provably free of other rows).
  await prisma.$executeRaw`UPDATE "Item" SET updated_at = created_at WHERE org_id = ${ORG1}::uuid AND created_at >= ${WIN_FROM} AND created_at < ${WIN_TO}`;
  await prisma.$executeRaw`UPDATE "Claim" SET updated_at = ${at('2025-11-13T00:00:00Z')} WHERE id = ${CLAIM_DMG}::uuid`;
}

describe('Analytics e2e — Increment 15 (operational | commercial | account scorecard)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
    await tearDown(prisma); // idempotent — clear any leftovers from an interrupted run
    await seedFixture(prisma);
  }, 60000);

  afterAll(async () => {
    await tearDown(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  // ───────────────────────────── operational ─────────────────────────────

  describe('GET /v1/analytics/operational', () => {
    it('computes the real operational aggregates over the fixture window', async () => {
      const res = await get(`/v1/analytics/operational?${QS}`, 'owner').expect(200);
      const m = res.body.metrics;
      expect(res.body.timezone).toBe('America/Toronto');
      expect(res.body.range.from).toBe(WIN_FROM.toISOString());

      expect(m.onTimePickupPercent).toMatchObject({ value: 50, status: 'ok', rowCount: 2 });
      expect(m.onTimeDeliveryPercent).toMatchObject({ value: 50, status: 'ok', rowCount: 2 });
      expect(m.routeAdherencePercent).toMatchObject({ value: 80, status: 'ok', rowCount: 5 }); // 4 of 5 terminal
      expect(m.failedSkipRatePercent).toMatchObject({ value: 20, status: 'ok', rowCount: 5 }); // 1 of 5
      expect(m.avgDwellMinutes).toMatchObject({ value: 18.8, status: 'ok', rowCount: 4 }); // [25,20,20,10]
      expect(m.itemsLostRatePercent).toMatchObject({ value: 25, status: 'ok', rowCount: 4 }); // 1 lost of 4 items
      expect(m.rewashRatePercent).toMatchObject({ value: 25, status: 'ok', rowCount: 4 }); // 1 REWASH of 4
      expect(m.plantThroughput.value).toMatchObject({ itemsCompleted: 3, perDay: 0.1 }); // 3 items / 30 days
      // stops/hour: 4 completed-with-arrival stops over a 09:30→15:20 span (5.8333h) = 0.69.
      expect(m.stopsPerHour).toMatchObject({ value: 0.69, status: 'ok', rowCount: 4 });
    });

    it('HONESTY FIREWALL: Phase-2-only operational metrics are flagged unavailable, never faked', async () => {
      const m = (await get(`/v1/analytics/operational?${QS}`, 'owner').expect(200)).body.metrics;
      expect(m.parStockoutIncidents).toMatchObject({ value: null, available: false, status: 'unavailable_in_phase_1' });
      expect(m.ppoh).toMatchObject({ value: null, available: false, status: 'unavailable_in_phase_1' });
    });

    it('RBAC: a DRIVER (org staff, not analytics) and a customer are 403', async () => {
      await get(`/v1/analytics/operational?${QS}`, 'driver').expect(403);
      await get(`/v1/analytics/operational?${QS}`, 'rita').expect(403);
    });

    it('RBAC: ops staff (dispatcher) may read operational', async () => {
      await get(`/v1/analytics/operational?${QS}`, 'dispatcher').expect(200);
    });

    it('400 on an invalid range (from ≥ to)', async () => {
      await get('/v1/analytics/operational?from=2025-12-01T00:00:00Z&to=2025-11-01T00:00:00Z', 'owner').expect(400);
    });
  });

  // ───────────────────────────── commercial ─────────────────────────────

  describe('GET /v1/analytics/commercial', () => {
    it('computes the real commercial aggregates over the fixture window', async () => {
      const res = await get(`/v1/analytics/commercial?${QS}`, 'finance').expect(200);
      const m = res.body.metrics;
      expect(res.body.currency).toBe('CAD');

      expect(m.trackedGmv).toMatchObject({ value: money('1000.00'), status: 'ok', rowCount: 4 });
      expect(m.jobCount).toMatchObject({ value: 4, status: 'ok' });
      expect(m.jobsPerWeek).toMatchObject({ value: 0.93, status: 'ok', rowCount: 4 }); // 4 / (30/7 weeks)
      expect(m.repeatRatePercent).toMatchObject({ value: 50, status: 'ok', rowCount: 2 }); // AcctA repeat of 2 accounts
      expect(m.quoteApprovalConversionPercent).toMatchObject({ value: 50, status: 'ok', rowCount: 4 }); // 2 approved of 4
      expect(m.medianQuoteApprovalHours).toMatchObject({ value: 4, status: 'ok', rowCount: 2 }); // median(2,6)
      expect(m.damageClaimRatePercent).toMatchObject({ value: 25, status: 'ok' }); // 1 damage of 4 orders
      expect(m.medianClaimResolutionDays).toMatchObject({ value: 3, status: 'ok', rowCount: 1 });
      expect(m.revenuePerRoute).toMatchObject({ value: money('700.00'), status: 'ok', rowCount: 1 }); // (100+200+400)/1 route

      // AR aging — unpaid invoices issued in window, aged to range end.
      expect(m.arAging.value.totalOutstanding).toBe('800.00');
      const byLabel = Object.fromEntries(m.arAging.value.buckets.map((b: { label: string; amount: string; count: number }) => [b.label, b]));
      expect(byLabel['current']).toMatchObject({ amount: '300.00', count: 1 });
      expect(byLabel['1-30']).toMatchObject({ amount: '500.00', count: 1 });
    });

    it('HONESTY FIREWALL: active contracts + CSAT are Phase-2 — flagged unavailable, never faked', async () => {
      const m = (await get(`/v1/analytics/commercial?${QS}`, 'owner').expect(200)).body.metrics;
      expect(m.activeContracts).toMatchObject({ value: null, available: false, status: 'unavailable_in_phase_1' });
      expect(m.csat).toMatchObject({ value: null, available: false, status: 'unavailable_in_phase_1' });
    });

    it('RBAC: commercial is tighter — a DISPATCHER is 403; OWNER/FINANCE are 200', async () => {
      await get(`/v1/analytics/commercial?${QS}`, 'dispatcher').expect(403);
      await get(`/v1/analytics/commercial?${QS}`, 'driver').expect(403);
      await get(`/v1/analytics/commercial?${QS}`, 'owner').expect(200);
      await get(`/v1/analytics/commercial?${QS}`, 'finance').expect(200);
    });
  });

  // ───────────────────────────── account scorecard ─────────────────────────────

  describe('GET /v1/analytics/accounts/:accountId/scorecard', () => {
    it('computes the real per-account aggregates (Account A)', async () => {
      const res = await get(`/v1/analytics/accounts/${ACCT_A}/scorecard?${QS}`, 'owner').expect(200);
      expect(res.body.accountId).toBe(ACCT_A);
      expect(res.body.accountName).toBe('Analytics Fixture A');
      const m = res.body.metrics;
      expect(m.lossRatePercent).toMatchObject({ value: 33, status: 'ok', rowCount: 3 }); // 1 lost of 3 AcctA items
      expect(m.onTimePercent).toMatchObject({ value: 50, status: 'ok', rowCount: 4 }); // 2 on-time of 4 AcctA stops
      expect(m.monthlySpend.value).toMatchObject({ total: '250.00', perMonth: '250.00' });
      expect(m.monthlySpend.rowCount).toBe(2);
      expect(m.costCenterSplit).toMatchObject({ value: null, status: 'unavailable_in_phase_1' });
    });

    it('RBAC: OWNER/FINANCE/CSR may read; DISPATCHER + customer 403', async () => {
      await get(`/v1/analytics/accounts/${ACCT_A}/scorecard?${QS}`, 'finance').expect(200);
      await get(`/v1/analytics/accounts/${ACCT_A}/scorecard?${QS}`, 'csr').expect(200);
      await get(`/v1/analytics/accounts/${ACCT_A}/scorecard?${QS}`, 'dispatcher').expect(403);
      await get(`/v1/analytics/accounts/${ACCT_A}/scorecard?${QS}`, 'rita').expect(403);
    });

    it('404 for an account outside the principal scope', async () => {
      await get(`/v1/analytics/accounts/${'a5999999-0000-4000-8000-000000009999'}/scorecard?${QS}`, 'owner').expect(404);
    });
  });

  // ───────────────────────────── org-scoping (tenancy) ─────────────────────────────

  describe('org-scoping (tenancy)', () => {
    it('an Org-2 owner gets 200 but sees NONE of Org-1 commercial rows (jobCount 0)', async () => {
      const res = await get(`/v1/analytics/commercial?${QS}`, 'org2owner').expect(200);
      expect(res.body.metrics.jobCount.value).toBe(0);
      expect(res.body.metrics.trackedGmv.value).toBe('0.00');
    });

    it("an Org-2 owner cannot read an Org-1 account scorecard (cross-org id → 404)", async () => {
      await get(`/v1/analytics/accounts/${ACCT_A}/scorecard?${QS}`, 'org2owner').expect(404);
    });
  });
});
