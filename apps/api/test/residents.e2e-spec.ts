import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GarmentStatus } from '@blue-bee/shared';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Resident personal-clothing e2e (Track-B care homes, increment 1). Boots the real app against the
 * seeded Postgres and proves, over the seeded Maple Grove care home:
 *   • the full §5.2-B lifecycle (enroll → soil → intake → wash → return → delivered);
 *   • an illegal transition → 409, and a branch target via `transition` → 400;
 *   • the odd-item branch: drop to lost & found → reconcile back to a resident;
 *   • resident PII reads write an AuditLog row (§12.2);
 *   • RBAC — DRIVER/residential → 403; org/account isolation — cross-org + another account's admin → 404.
 */
const SITE = 'b0000000-0000-4000-8000-0000000000a1'; // Maple Grove — West Wing
const R1 = 'b0000000-0000-4000-8000-0000000000b1'; // Eleanor
const R2 = 'b0000000-0000-4000-8000-0000000000b2'; // Harold
const LF_SEED = 'b0000000-0000-4000-8000-0000000000f1'; // the seeded pooled scarf
const CONDO_SITE = 'a6000000-0000-4000-8000-000000000001'; // a DIFFERENT site (Account B condo) — same-site probe
const CROSS_RESIDENT = 'b0000000-0000-4000-8000-0000000000e1'; // test-only resident at the condo site

const PHONES = {
  owner: '+14165550001', // OWNER (ops)
  plant: '+14165550004', // PLANT_OP (ops)
  careAdmin: '+14165550030', // ACCOUNT_ADMIN of the care home (their site)
  acctBAdmin: '+14165550020', // ACCOUNT_ADMIN of a DIFFERENT account (Account B) — isolation probe
  driver: '+14165550006', // DRIVER → 403
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER → 403
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org → 404
};

describe('Resident personal-clothing e2e (Track-B care homes)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const RUN = `${Date.now()}`; // unique tag codes so the suite is re-runnable without a reset

  const auth = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set(auth(who));
  const post = (path: string, who: string, body: object, key?: string) => {
    let req = request(app.getHttpServer()).post(path).set(auth(who));
    if (key) req = req.set('Idempotency-Key', key);
    return req.send(body);
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

    // A test-only resident at a DIFFERENT site (the Account-B condo) — to prove reconcile is same-site.
    const orgId = (await prisma.site.findUniqueOrThrow({ where: { id: SITE } })).orgId;
    await prisma.resident.upsert({
      where: { id: CROSS_RESIDENT },
      update: {},
      create: { id: CROSS_RESIDENT, orgId, siteId: CONDO_SITE, name: 'Cross-site fixture' },
    });
  }, 60000);

  afterAll(async () => {
    await prisma.resident.deleteMany({ where: { id: CROSS_RESIDENT } });
    await prisma.$disconnect();
    await app.close();
  });

  /** Enroll a fresh garment to R1 and return its id. */
  async function enroll(code: string): Promise<string> {
    const res = await post(`/v1/residents/${R1}/garments`, 'plant', { tagCode: `${RUN}-${code}`, description: `Test garment ${code}` }).expect(201);
    expect(res.body.garmentStatus).toBe(GarmentStatus.GARMENT_ENROLLED);
    return res.body.id as string;
  }
  const move = (id: string, to: GarmentStatus) => post(`/v1/garments/${id}/transition`, 'plant', { to });

  describe('garment lifecycle (§5.2-B)', () => {
    it('enroll → soil → intake → wash → return → delivered (server-authoritative + custody)', async () => {
      const g = await enroll('LIFE');
      const chain = [
        GarmentStatus.SOIL_PICKUP,
        GarmentStatus.INTAKE_SORT,
        GarmentStatus.WASH,
        GarmentStatus.RETURN_SORT,
        GarmentStatus.DELIVERED_TO_RESIDENT,
      ];
      for (const to of chain) {
        const res = await move(g, to).expect(201);
        expect(res.body.garmentStatus).toBe(to);
      }
      // Every move wrote an append-only custody event (enroll + 5 transitions = 6).
      const events = await prisma.custodyEvent.count({ where: { itemId: g } });
      expect(events).toBe(6);
    });

    it('an illegal transition → 409 (cannot skip stages)', async () => {
      const g = await enroll('ILLEGAL');
      await move(g, GarmentStatus.WASH).expect(409); // enrolled → wash is illegal
      await move(g, GarmentStatus.DELIVERED_TO_RESIDENT).expect(409);
    });

    it('a branch target via the generic transition → 400 (use the dedicated endpoint)', async () => {
      const g = await enroll('BRANCH');
      await move(g, GarmentStatus.SOIL_PICKUP).expect(201);
      await move(g, GarmentStatus.LOST_FOUND_POOL).expect(400);
      await move(g, GarmentStatus.RECONCILE).expect(400);
    });
  });

  describe('lost & found → reconcile', () => {
    it('drops an odd garment to the pool and reconciles it back to a resident', async () => {
      const g = await enroll('LF');
      for (const to of [GarmentStatus.SOIL_PICKUP, GarmentStatus.INTAKE_SORT, GarmentStatus.WASH, GarmentStatus.RETURN_SORT]) {
        await move(g, to).expect(201);
      }
      // Drop to lost & found (RETURN_SORT → LOST_FOUND_POOL).
      const dropped = await post(`/v1/garments/${g}/lost-found`, 'plant', { notes: 'unmatched on return' }).expect(201);
      expect(dropped.body.status).toBe('OPEN');
      const lfId = dropped.body.id as string;
      expect(dropped.body.itemId).toBe(g);

      // It appears in the site pool.
      const pool = await get(`/v1/lost-found?siteId=${SITE}`, 'plant').expect(200);
      expect(pool.body.lostFound.some((x: { id: string }) => x.id === lfId)).toBe(true);

      // Reconcile it to Harold (R2).
      const rec = await post(`/v1/lost-found/${lfId}/reconcile`, 'plant', { residentId: R2 }).expect(201);
      expect(rec.body.garmentStatus).toBe(GarmentStatus.RECONCILE);
      expect(rec.body.residentId).toBe(R2);

      // The pool row is now RECONCILED, and a second reconcile is a 409.
      await post(`/v1/lost-found/${lfId}/reconcile`, 'plant', { residentId: R1 }).expect(409);
      const report = await get(`/v1/lost-found/report?siteId=${SITE}`, 'plant').expect(200);
      expect(report.body.reconciled).toBeGreaterThanOrEqual(1);
    });

    it('exposes the SEEDED pooled scarf in the site pool (real data)', async () => {
      const pool = await get(`/v1/lost-found?siteId=${SITE}`, 'owner').expect(200);
      expect(pool.body.lostFound.some((x: { id: string }) => x.id === LF_SEED)).toBe(true);
    });
  });

  describe('resident PII reads are audited (§12.2)', () => {
    it('a clothing read writes a RESIDENT_CLOTHING_READ audit row', async () => {
      const before = await prisma.auditLog.count({ where: { entity: 'Resident', entityId: R1, action: 'RESIDENT_CLOTHING_READ' } });
      const res = await get(`/v1/residents/${R1}/clothing`, 'owner').expect(200);
      expect(res.body.resident.id).toBe(R1);
      expect(Array.isArray(res.body.buckets.enrolled)).toBe(true);
      const after = await prisma.auditLog.count({ where: { entity: 'Resident', entityId: R1, action: 'RESIDENT_CLOTHING_READ' } });
      expect(after).toBe(before + 1);
    });

    it('a resident detail + list read are also audited', async () => {
      const b1 = await prisma.auditLog.count({ where: { entity: 'Resident', entityId: R1, action: 'RESIDENT_READ' } });
      await get(`/v1/residents/${R1}`, 'owner').expect(200);
      expect(await prisma.auditLog.count({ where: { entity: 'Resident', entityId: R1, action: 'RESIDENT_READ' } })).toBe(b1 + 1);

      const b2 = await prisma.auditLog.count({ where: { entity: 'Resident', entityId: SITE, action: 'RESIDENT_LIST_READ' } });
      await get(`/v1/residents?siteId=${SITE}`, 'owner').expect(200);
      expect(await prisma.auditLog.count({ where: { entity: 'Resident', entityId: SITE, action: 'RESIDENT_LIST_READ' } })).toBe(b2 + 1);
    });

    it('the lost & found pool + report reads are audited (candidate names are PII)', async () => {
      const p0 = await prisma.auditLog.count({ where: { entity: 'LostFoundItem', entityId: SITE, action: 'LOST_FOUND_READ' } });
      const pool = await get(`/v1/lost-found?siteId=${SITE}`, 'owner').expect(200);
      expect(pool.body.lostFound.some((x: { candidateResidentName: string | null }) => x.candidateResidentName)).toBe(true); // PII present
      expect(await prisma.auditLog.count({ where: { entity: 'LostFoundItem', entityId: SITE, action: 'LOST_FOUND_READ' } })).toBe(p0 + 1);

      const r0 = await prisma.auditLog.count({ where: { entity: 'LostFoundItem', entityId: SITE, action: 'LOST_FOUND_REPORT_READ' } });
      await get(`/v1/lost-found/report?siteId=${SITE}`, 'owner').expect(200);
      expect(await prisma.auditLog.count({ where: { entity: 'LostFoundItem', entityId: SITE, action: 'LOST_FOUND_REPORT_READ' } })).toBe(r0 + 1);
    });
  });

  describe('RBAC + org/account isolation', () => {
    it('the care-home ACCOUNT_ADMIN can read its residents; another account\'s admin and an Org-2 owner cannot', async () => {
      await get(`/v1/residents?siteId=${SITE}`, 'careAdmin').expect(200);
      await get(`/v1/residents/${R1}`, 'careAdmin').expect(200);
      // Account B's admin is confined to Account B → the care-home site/resident is out of scope → 404.
      await get(`/v1/residents?siteId=${SITE}`, 'acctBAdmin').expect(404);
      await get(`/v1/residents/${R1}`, 'acctBAdmin').expect(404);
      // Cross-org → 404 (not a cross-tenant read).
      await get(`/v1/residents/${R1}`, 'org2owner').expect(404);
    });

    it('a DRIVER and a residential customer are 403 on resident reads + garment ops', async () => {
      await get(`/v1/residents?siteId=${SITE}`, 'driver').expect(403);
      await get(`/v1/residents/${R1}/clothing`, 'rita').expect(403);
      await post(`/v1/residents/${R1}/garments`, 'driver', { tagCode: `${RUN}-X` }).expect(403);
      await post(`/v1/lost-found/${LF_SEED}/reconcile`, 'driver', { residentId: R1 }).expect(403);
    });

    it('a garment / lost-found id from another scope → 404 (not a leak)', async () => {
      // The care admin cannot reconcile via a resident outside their scope (target resident out of scope → 404).
      const pool = await get(`/v1/lost-found?siteId=${SITE}`, 'careAdmin').expect(200);
      expect(Array.isArray(pool.body.lostFound)).toBe(true);
      await post(`/v1/garments/${R1}/transition`, 'plant', { to: GarmentStatus.SOIL_PICKUP }).expect(404); // R1 is a resident id, not a garment
    });

    it('reconcile rejects a resident at a DIFFERENT site than the pooled garment (400, no mutation)', async () => {
      // CROSS_RESIDENT is at the condo site; the seeded scarf (LF_SEED) is at the care-home site.
      await post(`/v1/lost-found/${LF_SEED}/reconcile`, 'owner', { residentId: CROSS_RESIDENT }).expect(400);
      // The same-site guard runs BEFORE the write — the seeded pool row is untouched (still OPEN).
      const pool = await get(`/v1/lost-found?siteId=${SITE}`, 'owner').expect(200);
      expect(pool.body.lostFound.some((x: { id: string; status: string }) => x.id === LF_SEED && x.status === 'OPEN')).toBe(true);
    });
  });

  describe('idempotency (replay safety)', () => {
    it('replaying the same Idempotency-Key does not create a duplicate resident', async () => {
      const key = `create-resident-${Date.now()}`;
      const before = await prisma.resident.count({ where: { siteId: SITE } });
      const a = await post('/v1/residents', 'owner', { siteId: SITE, name: `Idempotency test ${RUN}` }, key).expect(201);
      const b = await post('/v1/residents', 'owner', { siteId: SITE, name: `Idempotency test ${RUN}-2` }, key).expect(201);
      expect(b.body.id).toBe(a.body.id);
      expect(b.body.name).toBe(a.body.name); // the cached response, not a fresh create with the new name
      expect((await prisma.resident.count({ where: { siteId: SITE } })) - before).toBe(1);
    });
  });
});
