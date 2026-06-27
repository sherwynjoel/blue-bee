import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Care-home facility-linen par loop e2e (Track B Phase 2, PRD §2.2/§5.2/§B3). Boots the real app against
 * the real (migrated + seeded) Postgres + Redis. Proves the Definition of Done end-to-end:
 *   • Par CRUD per (site, cost-centre?, SKU): set/update/list; RBAC (OWNER/CSR write, ops+account read,
 *     DRIVER/residential 403); a non-LINEN service → 400; a cross-account cost-centre → 400 mismatch.
 *   • Tenancy lock: the owning account's ACCOUNT_ADMIN sees ONLY its own sites' par/stock/pickups/sheet;
 *     a cross-account site → 404; a cross-org reader → 404 (the inverse-scope, e2e-locked).
 *   • On-hand ledger: an ADJUSTMENT sets on-hand to an absolute target; a soiled-cart pickup writes an
 *     append-only CustodyEvent + a SOIL_PICKUP LinenMovement that DECREMENTS on-hand; on-hand reconciles
 *     EXACTLY to Σ(movements); the ledger is append-only (UPDATE/DELETE refused by the DB trigger).
 *   • Driver self-scope: a driver records a pickup at THEIR OWN stop; a foreign stop → 403.
 *   • Pack-to-par: gap = max(0, par − on-hand) EXACTLY (cost-centre split correct); generate snapshots a
 *     Manifest(kind = PACK_TO_PAR) that the account + ops can view.
 *
 * Fixture: the linen account is the SEEDED Maple Grove care home (so its real ACCOUNT_ADMIN drives the
 * inverse-scope reads); a fresh e2e site + LINEN SKUs + a second account live under deterministic ids.
 * Append-only rows (LinenMovement / CustodyEvent) are never deleted (the codebase convention); the
 * mutable fixture is reset, and on-hand is reset to absolutes via the adjust endpoint, so re-runs are
 * deterministic without a DB reset and on_hand == Σ(movements) holds every run.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
const CARE_HOME = 'b0000000-0000-4000-8000-0000000000a0'; // seeded Maple Grove (ACCOUNT_ADMIN +14165550030)

// Fixture ids (face = facility-linen e2e).
const SITE_A = 'face0000-0000-4000-8000-000000000001'; // a fresh e2e site UNDER the seeded care home
const ACCT_B = 'face0000-0000-4000-8000-000000000002'; // a second account (cross-account probe)
const SITE_B = 'face0000-0000-4000-8000-000000000003';
const SVC_SHEET = 'face0000-0000-4000-8000-000000000011';
const SVC_TOWEL = 'face0000-0000-4000-8000-000000000012';
const SVC_GOWN = 'face0000-0000-4000-8000-000000000013';
const SVC_SPECIALTY = 'face0000-0000-4000-8000-000000000014'; // a SPECIALTY service (the not-LINEN probe)
const CC_WEST = 'face0000-0000-4000-8000-000000000021'; // cost-centre under the care home, scoped to SITE_A
const CC_OTHER = 'face0000-0000-4000-8000-000000000022'; // cost-centre under ACCT_B (cross-account probe)
const ROUTE_OWN = 'face0000-0000-4000-8000-000000000031';
const STOP_OWN = 'face0000-0000-4000-8000-000000000032'; // the driver-owned SOIL_PICKUP stop at SITE_A
const ROUTE_FOREIGN = 'face0000-0000-4000-8000-000000000033';
const STOP_FOREIGN = 'face0000-0000-4000-8000-000000000034'; // a stop the driver does NOT own

const PHONES = {
  owner: '+14165550001',
  csr: '+14165550003',
  dispatcher: '+14165550002',
  plant: '+14165550004',
  driver: '+14165550006',
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER → 403
  careAdmin: '+14165550030', // ACCOUNT_ADMIN scoped to the care home (inverse-scope reads)
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org isolation probe
};

async function tearDown(prisma: PrismaClient): Promise<void> {
  const sites = [SITE_A, SITE_B];
  // Mutable rows only — the append-only LinenMovement / CustodyEvent ledger is NEVER deleted; on-hand
  // (LinenStock) for SITE_A persists and is reset to absolutes by the adjust endpoint in the tests.
  await prisma.soilPickup.deleteMany({ where: { siteId: { in: sites } } });
  await prisma.manifest.deleteMany({ where: { siteId: { in: sites } } });
  await prisma.parLevel.deleteMany({ where: { siteId: { in: sites } } });
  await prisma.routeStop.deleteMany({ where: { id: { in: [STOP_OWN, STOP_FOREIGN] } } });
  await prisma.route.deleteMany({ where: { id: { in: [ROUTE_OWN, ROUTE_FOREIGN] } } });
  await prisma.account.deleteMany({ where: { id: ACCT_B } }); // cascades SITE_B + CC_OTHER (no stock/ledger there)
}

async function seedFixture(prisma: PrismaClient, driverId: string): Promise<void> {
  // A fresh e2e site UNDER the seeded Maple Grove account (so its real ACCOUNT_ADMIN owns it).
  await prisma.site.upsert({ where: { id: SITE_A }, update: {}, create: { id: SITE_A, orgId: ORG1, accountId: CARE_HOME, name: 'Linen E2E — North Wing' } });
  // A second account + site (cross-account / cross-account-cost-centre probes).
  await prisma.account.upsert({ where: { id: ACCT_B }, update: {}, create: { id: ACCT_B, orgId: ORG1, type: 'BUSINESS', name: 'Linen E2E — other building' } });
  await prisma.site.upsert({ where: { id: SITE_B }, update: {}, create: { id: SITE_B, orgId: ORG1, accountId: ACCT_B, name: 'Linen E2E — other site' } });
  // LINEN SKUs + one SPECIALTY service (the not-LINEN probe).
  await prisma.service.createMany({
    data: [
      { id: SVC_SHEET, orgId: ORG1, vertical: 'LINEN', name: 'Bed sheets', unit: 'PIECE', baseRate: '0.8500' },
      { id: SVC_TOWEL, orgId: ORG1, vertical: 'LINEN', name: 'Bath towels', unit: 'PIECE', baseRate: '0.6000' },
      { id: SVC_GOWN, orgId: ORG1, vertical: 'LINEN', name: 'Patient gowns', unit: 'PIECE', baseRate: '0.9000' },
      { id: SVC_SPECIALTY, orgId: ORG1, vertical: 'SPECIALTY', name: 'Area rug clean', unit: 'SQFT', baseRate: '4.0000' },
    ],
    skipDuplicates: true,
  });
  // Cost-centres: CC_WEST under the care home scoped to SITE_A; CC_OTHER under ACCT_B.
  await prisma.costCenter.upsert({ where: { id: CC_WEST }, update: {}, create: { id: CC_WEST, orgId: ORG1, accountId: CARE_HOME, siteId: SITE_A, code: 'E2E-NW', name: 'E2E North Wing', kind: 'WING', active: true } });
  await prisma.costCenter.upsert({ where: { id: CC_OTHER }, update: {}, create: { id: CC_OTHER, orgId: ORG1, accountId: ACCT_B, code: 'E2E-OTH', name: 'E2E Other', active: true } });
  // A driver-OWNED soil-pickup route + stop at SITE_A, and a FOREIGN route + stop (no driver).
  await prisma.route.create({ data: { id: ROUTE_OWN, orgId: ORG1, date: new Date('2026-06-27T00:00:00.000Z'), driverId, status: 'IN_PROGRESS' } });
  await prisma.routeStop.create({ data: { id: STOP_OWN, orgId: ORG1, routeId: ROUTE_OWN, seq: 1, accountId: CARE_HOME, siteId: SITE_A, kind: 'PICKUP', status: 'PENDING' } });
  await prisma.route.create({ data: { id: ROUTE_FOREIGN, orgId: ORG1, date: new Date('2026-06-27T00:00:00.000Z'), status: 'PLANNED' } });
  await prisma.routeStop.create({ data: { id: STOP_FOREIGN, orgId: ORG1, routeId: ROUTE_FOREIGN, seq: 1, accountId: CARE_HOME, siteId: SITE_A, kind: 'PICKUP', status: 'PENDING' } });
}

describe('Care-home facility-linen par loop e2e (Track B Phase 2)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: object) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body);
  const patch = (path: string, who: string, body: object) => request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body);

  /** Σ of all ledger movements for a (site, cost-centre?, sku) cell — the reconciliation source of truth. */
  const ledgerSum = async (serviceId: string, costCenterId: string | null): Promise<number> => {
    const agg = await prisma.linenMovement.aggregate({ _sum: { qty: true }, where: { siteId: SITE_A, serviceId, costCenterId } });
    return agg._sum.qty ?? 0;
  };
  const cachedOnHand = async (serviceId: string, costCenterId: string | null): Promise<number> => {
    const row = await prisma.linenStock.findFirst({ where: { siteId: SITE_A, serviceId, costCenterId } });
    return row?.onHand ?? 0;
  };

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
    const driver = await prisma.driver.findFirstOrThrow({ where: { user: { phone: PHONES.driver } } });
    await tearDown(prisma);
    await seedFixture(prisma, driver.id);
  }, 60000);

  afterAll(async () => {
    await tearDown(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  // ─────────────────────────── par levels ───────────────────────────

  describe('par levels (CRUD + RBAC + tenancy)', () => {
    it('OWNER/CSR set par per site + cost-centre; re-set updates (idempotent); audited', async () => {
      const site = await post(`/v1/sites/${SITE_A}/par-levels`, 'owner', { serviceId: SVC_SHEET, targetQty: 100 }).expect(201);
      expect(site.body).toMatchObject({ siteId: SITE_A, accountId: CARE_HOME, serviceId: SVC_SHEET, sku: 'Bed sheets', unit: 'PIECE', costCenterId: null, targetQty: 100 });
      await post(`/v1/sites/${SITE_A}/par-levels`, 'csr', { serviceId: SVC_TOWEL, targetQty: 80 }).expect(201);
      // A wing (cost-centre) par for the SAME sku is a DISTINCT row (NULL site-level vs CC_WEST).
      await post(`/v1/sites/${SITE_A}/par-levels`, 'owner', { serviceId: SVC_SHEET, costCenterId: CC_WEST, targetQty: 40 }).expect(201);
      // Re-set the site-level sheet par → updates in place (idempotent, not a duplicate).
      const reSet = await post(`/v1/sites/${SITE_A}/par-levels`, 'owner', { serviceId: SVC_SHEET, targetQty: 120 }).expect(201);
      expect(reSet.body.targetQty).toBe(120);

      expect(await prisma.parLevel.count({ where: { siteId: SITE_A, serviceId: SVC_SHEET } })).toBe(2); // site-level + CC_WEST
      expect(await prisma.auditLog.findFirst({ where: { entity: 'ParLevel', action: 'PAR_LEVEL_SET' } })).not.toBeNull();
    });

    it('a non-LINEN service → 400; a cost-centre from another account → 400 mismatch', async () => {
      const notLinen = await post(`/v1/sites/${SITE_A}/par-levels`, 'owner', { serviceId: SVC_SPECIALTY, targetQty: 10 }).expect(400);
      expect(notLinen.body.error ?? notLinen.body.title).toContain('service_not_linen');
      const mismatch = await post(`/v1/sites/${SITE_A}/par-levels`, 'owner', { serviceId: SVC_GOWN, costCenterId: CC_OTHER, targetQty: 10 }).expect(400);
      expect(mismatch.body.error ?? mismatch.body.title).toContain('cost_center_site_mismatch');
    });

    it('RBAC: DISPATCHER / DRIVER / residential cannot set par (403)', async () => {
      const body = { serviceId: SVC_GOWN, targetQty: 5 };
      await post(`/v1/sites/${SITE_A}/par-levels`, 'dispatcher', body).expect(403);
      await post(`/v1/sites/${SITE_A}/par-levels`, 'driver', body).expect(403);
      await post(`/v1/sites/${SITE_A}/par-levels`, 'rita', body).expect(403);
    });

    it('PATCH updates a target by id (OWNER/CSR; DISPATCHER 403)', async () => {
      const created = (await post(`/v1/sites/${SITE_A}/par-levels`, 'owner', { serviceId: SVC_GOWN, targetQty: 30 }).expect(201)).body;
      const updated = await patch(`/v1/par-levels/${created.id}`, 'csr', { targetQty: 36 }).expect(200);
      expect(updated.body).toMatchObject({ id: created.id, targetQty: 36 });
      await patch(`/v1/par-levels/${created.id}`, 'dispatcher', { targetQty: 1 }).expect(403);
    });

    it('list returns the site par; the owning ACCOUNT_ADMIN sees its own site, a cross-account site → 404, cross-org → 404', async () => {
      const ops = await get(`/v1/sites/${SITE_A}/par-levels`, 'owner').expect(200);
      expect(ops.body.parLevels.length).toBeGreaterThanOrEqual(3);
      // The care-home ACCOUNT_ADMIN reads ITS OWN site's par (inverse-scope read).
      const acct = await get(`/v1/sites/${SITE_A}/par-levels`, 'careAdmin').expect(200);
      expect(acct.body.parLevels.some((p: { serviceId: string }) => p.serviceId === SVC_SHEET)).toBe(true);
      // …but NOT another account's site, and a cross-org reader sees nothing.
      await get(`/v1/sites/${SITE_B}/par-levels`, 'careAdmin').expect(404);
      await get(`/v1/sites/${SITE_A}/par-levels`, 'org2owner').expect(404);
    });
  });

  // ─────────────────────────── on-hand ledger ───────────────────────────

  describe('on-hand ledger (adjust + reconciliation + append-only)', () => {
    it('ADJUSTMENT sets on-hand to an absolute target; on-hand reconciles EXACTLY to Σ(movements)', async () => {
      const res = await post(`/v1/sites/${SITE_A}/linen-stock/adjust`, 'plant', { serviceId: SVC_SHEET, onHand: 90 }).expect(201);
      expect(res.body.stock).toMatchObject({ siteId: SITE_A, serviceId: SVC_SHEET, onHand: 90, costCenterId: null });
      expect(res.body.movement.type).toBe('ADJUSTMENT');
      expect(await cachedOnHand(SVC_SHEET, null)).toBe(90);
      expect(await ledgerSum(SVC_SHEET, null)).toBe(90); // cache == ledger
      // Idempotent: re-setting to 90 nets a 0-delta movement, on-hand stays 90.
      await post(`/v1/sites/${SITE_A}/linen-stock/adjust`, 'plant', { serviceId: SVC_SHEET, onHand: 90 }).expect(201);
      expect(await cachedOnHand(SVC_SHEET, null)).toBe(90);
      expect(await ledgerSum(SVC_SHEET, null)).toBe(90);
    });

    it('RBAC: DISPATCHER cannot adjust on-hand (403); GET stock readable by ops + the account', async () => {
      await post(`/v1/sites/${SITE_A}/linen-stock/adjust`, 'dispatcher', { serviceId: SVC_SHEET, onHand: 1 }).expect(403);
      await get(`/v1/sites/${SITE_A}/linen-stock`, 'careAdmin').expect(200);
      await get(`/v1/sites/${SITE_B}/linen-stock`, 'careAdmin').expect(404); // cross-account
    });
  });

  // ─────────────────────────── soiled-cart pickup ───────────────────────────

  describe('soiled-cart pickup (decrement + custody + append-only + driver self-scope)', () => {
    it('a pickup writes a CustodyEvent + a SOIL_PICKUP movement and DECREMENTS on-hand; the ledger is append-only', async () => {
      await post(`/v1/sites/${SITE_A}/linen-stock/adjust`, 'plant', { serviceId: SVC_TOWEL, onHand: 60 }).expect(201);
      const before = await cachedOnHand(SVC_TOWEL, null);
      const custodyBefore = await prisma.custodyEvent.count({ where: { garmentStage: 'SOIL_PICKUP' } });

      const res = await post(`/v1/sites/${SITE_A}/soil-pickups`, 'dispatcher', {
        cartCount: 3,
        bagCount: 6,
        weightKg: 42.5,
        lines: [{ serviceId: SVC_TOWEL, qty: 18 }],
      }).expect(201);
      expect(res.body).toMatchObject({ siteId: SITE_A, cartCount: 3, bagCount: 6, weightKg: '42.50', soiled: true, totalPieces: 18 });
      expect(res.body.lines[0]).toMatchObject({ serviceId: SVC_TOWEL, sku: 'Bath towels', qty: 18 });

      // On-hand decremented by exactly the picked-up qty; cache still == ledger.
      expect(await cachedOnHand(SVC_TOWEL, null)).toBe(before - 18);
      expect(await ledgerSum(SVC_TOWEL, null)).toBe(before - 18);
      // The append-only custody checkpoint (cart custody: itemId null, garmentStage SOIL_PICKUP) was written.
      expect(await prisma.custodyEvent.count({ where: { garmentStage: 'SOIL_PICKUP' } })).toBe(custodyBefore + 1);
      const mv = await prisma.linenMovement.findFirstOrThrow({ where: { sourceType: 'SOIL_PICKUP', sourceId: res.body.id } });
      expect(mv.qty).toBe(-18);

      // The ledger is append-only — UPDATE and DELETE are refused by the DB trigger.
      await expect(prisma.linenMovement.update({ where: { id: mv.id }, data: { qty: 0 } })).rejects.toThrow();
      await expect(prisma.linenMovement.delete({ where: { id: mv.id } })).rejects.toThrow();
      // The cart-custody CustodyEvent is append-only too (same DB trigger).
      const ce = await prisma.custodyEvent.findFirstOrThrow({ where: { garmentStage: 'SOIL_PICKUP', itemId: null }, orderBy: { createdAt: 'desc' } });
      await expect(prisma.custodyEvent.update({ where: { id: ce.id }, data: { garmentStage: 'WASH' } })).rejects.toThrow();
      await expect(prisma.custodyEvent.delete({ where: { id: ce.id } })).rejects.toThrow();
    });

    it('RBAC: residential / account-admin cannot record an ops pickup (403); a SOIL_PICKUP stop links', async () => {
      await post(`/v1/sites/${SITE_A}/soil-pickups`, 'rita', { cartCount: 1, lines: [{ serviceId: SVC_TOWEL, qty: 1 }] }).expect(403);
      await post(`/v1/sites/${SITE_A}/soil-pickups`, 'careAdmin', { cartCount: 1, lines: [{ serviceId: SVC_TOWEL, qty: 1 }] }).expect(403);
      const withStop = await post(`/v1/sites/${SITE_A}/soil-pickups`, 'owner', { routeStopId: STOP_OWN, cartCount: 2, lines: [{ serviceId: SVC_TOWEL, qty: 2 }] }).expect(201);
      expect(withStop.body.routeStopId).toBe(STOP_OWN);
    });

    it('driver records a pickup at THEIR OWN stop (201); a foreign stop → 403; the account sees the confirmation', async () => {
      const own = await post(`/v1/driver/stops/${STOP_OWN}/soil-pickup`, 'driver', { cartCount: 4, weightKg: 30, lines: [{ serviceId: SVC_TOWEL, qty: 5 }] }).expect(201);
      expect(own.body).toMatchObject({ siteId: SITE_A, routeStopId: STOP_OWN, cartCount: 4, totalPieces: 5 });
      await post(`/v1/driver/stops/${STOP_FOREIGN}/soil-pickup`, 'driver', { cartCount: 1, lines: [{ serviceId: SVC_TOWEL, qty: 1 }] }).expect(403);

      // The account sees its own site's pickup history; a cross-account site → 404.
      const feed = await get(`/v1/sites/${SITE_A}/soil-pickups`, 'careAdmin').expect(200);
      expect(feed.body.pickups.length).toBeGreaterThanOrEqual(1);
      await get(`/v1/sites/${SITE_B}/soil-pickups`, 'careAdmin').expect(404);
    });
  });

  // ─────────────────────────── pack-to-par load sheet ───────────────────────────

  describe('pack-to-par load sheet (gap = max(0, par − on-hand), cost-centre-correct)', () => {
    it('live gaps are EXACT and a site-level par never bleeds into a wing gap', async () => {
      // Site-level: par 120 (set above), on-hand 90 → gap 30. Wing CC_WEST: par 40, on-hand 12 → gap 28.
      await post(`/v1/sites/${SITE_A}/linen-stock/adjust`, 'plant', { serviceId: SVC_SHEET, onHand: 90 }).expect(201);
      await post(`/v1/sites/${SITE_A}/linen-stock/adjust`, 'plant', { serviceId: SVC_SHEET, costCenterId: CC_WEST, onHand: 12 }).expect(201);

      const sheet = await get(`/v1/sites/${SITE_A}/pack-to-par`, 'owner').expect(200);
      const siteLevel = sheet.body.lines.find((l: { serviceId: string; costCenterId: string | null }) => l.serviceId === SVC_SHEET && l.costCenterId === null);
      const wing = sheet.body.lines.find((l: { serviceId: string; costCenterId: string | null }) => l.serviceId === SVC_SHEET && l.costCenterId === CC_WEST);
      expect(siteLevel).toMatchObject({ par: 120, onHand: 90, gap: 30 });
      expect(wing).toMatchObject({ par: 40, onHand: 12, gap: 28 });

      // Filter to the wing only.
      const wingOnly = await get(`/v1/sites/${SITE_A}/pack-to-par?costCenterId=${CC_WEST}`, 'owner').expect(200);
      expect(wingOnly.body.lines.every((l: { costCenterId: string | null }) => l.costCenterId === CC_WEST)).toBe(true);
    });

    it('generate snapshots a PACK_TO_PAR Manifest the account + ops can view; DISPATCHER may generate; DRIVER 403', async () => {
      const gen = await post(`/v1/sites/${SITE_A}/pack-to-par`, 'dispatcher', {}).expect(201);
      expect(gen.body).toMatchObject({ siteId: SITE_A, kind: 'PACK_TO_PAR' });
      expect(gen.body.lines.length).toBeGreaterThanOrEqual(1);
      const persisted = await prisma.manifest.findUniqueOrThrow({ where: { id: gen.body.id } });
      expect(persisted.kind).toBe('PACK_TO_PAR');

      await post(`/v1/sites/${SITE_A}/pack-to-par`, 'driver', {}).expect(403);

      // The account views the generated load sheet for its own site; a cross-account site → 404.
      const list = await get(`/v1/sites/${SITE_A}/pack-to-par/manifests`, 'careAdmin').expect(200);
      expect(list.body.manifests.some((m: { id: string }) => m.id === gen.body.id)).toBe(true);
      await get(`/v1/sites/${SITE_B}/pack-to-par/manifests`, 'org2owner').expect(404);
    });
  });
});
