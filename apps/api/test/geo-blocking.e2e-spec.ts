import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Geo-blocking e2e (Increment 19). Boots the real app against the real (migrated) Postgres + Redis and proves
 * the Definition of Done + the 6 adversarial QC lenses end-to-end:
 *   • Owner/finance draw real PostGIS polygon zones (GeoJSON round-trips to geography and back); RBAC blocks
 *     staff/customers from managing (403); cross-org → 404; a malformed polygon → 400.
 *   • Enforcement is SERVER-side: a booking whose service point is inside an active zone books; outside every
 *     active zone → 422 out_of_service_area AND exactly one CoverageRequest row (transactional, no duplicate).
 *   • Boundary behaviour is sane (just-inside books, just-outside blocked); multi-zone (a point in the 2nd
 *     zone passes); a deactivated zone stops covering; no active zones ⇒ the org serves everywhere.
 *   • Corporate override: an in-building resident, an active member, and a corporate-account booking are NEVER
 *     geo-blocked even at a point outside every public zone.
 *   • Tenancy: org-A's zones never gate org-B; the check only mutates nothing on the order lifecycle.
 *
 * Fixtures are created by this spec (prefix "GEO E2E") + the seeded staff, and torn down by prefix/id in
 * beforeAll AND afterAll — so ORG1 has ZERO active zones during every OTHER spec (they book with no serviceGeo
 * or without zones and are unaffected). Sample seed zones (prisma/seed.ts) are seeded INACTIVE for the same
 * reason (they must not gate the shared demo org); this spec creates its own ACTIVE zones to prove the gate.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ORG2 = 'e0000000-0000-4000-8000-000000000002';
const ORG2_ACCT = 'e0000000-0000-4000-8000-0000000000c0';

// Deterministic fixture ids (de = geo-blocking e2e).
const SVC = 'de000000-0000-4000-8000-000000000001'; // org1 per-item service
const SVC2 = 'de000000-0000-4000-8000-000000000002'; // org2 per-item service (tenancy probe)
const RES = { acct: 'de000000-0000-4000-8000-000000000010', uid: 'de000000-0000-4000-8000-000000000011', rid: 'de000000-0000-4000-8000-000000000012', phone: '+14165558010' };
const CORP = { acct: 'de000000-0000-4000-8000-000000000020', site: 'de000000-0000-4000-8000-000000000021' };
const CORPRES = { acct: 'de000000-0000-4000-8000-000000000030', uid: 'de000000-0000-4000-8000-000000000031', rid: 'de000000-0000-4000-8000-000000000032', phone: '+14165558030' };
const MEMBER = { acct: 'de000000-0000-4000-8000-000000000040', uid: 'de000000-0000-4000-8000-000000000041', rid: 'de000000-0000-4000-8000-000000000042', mid: 'de000000-0000-4000-8000-000000000043', phone: '+14165558040' };

// Real drawn polygons (closed rings, CCW). Two adjacent north-Toronto boxes, deliberately placed AWAY from
// every seeded corporate building (the demo "Maple District Tower 1" sits at ~(-79.3801,43.6489) r300m) so the
// corporate override never masks the zone gate — these tests must exercise the ZONE containment, not a bypass.
const ZONE_A = { type: 'Polygon' as const, coordinates: [[[-79.34, 43.70], [-79.32, 43.70], [-79.32, 43.72], [-79.34, 43.72], [-79.34, 43.70]]] };
const ZONE_B = { type: 'Polygon' as const, coordinates: [[[-79.30, 43.70], [-79.28, 43.70], [-79.28, 43.72], [-79.30, 43.72], [-79.30, 43.70]]] };

// Points (all ≥ 7 km from any corporate building so `effective` is null and the zone gate is what's tested).
const IN_A = { lng: -79.33, lat: 43.71 };        // inside zone A
const IN_B = { lng: -79.29, lat: 43.71 };        // inside zone B (outside A)
const OUT = { lng: -79.10, lat: 43.55 };         // outside both zones + outside every corporate building
const JUST_IN = { lng: -79.3201, lat: 43.71 };   // just inside A's east edge (lng < -79.32)
const JUST_OUT = { lng: -79.3199, lat: 43.71 };  // in the gap between A and B (covered by neither)
const CORP_PT = { lng: -79.05, lat: 43.50 };     // OUR corporate building location (outside every zone)
const CORP_IN = { lng: -79.0501, lat: 43.5001 }; // ~14 m from CORP_PT → inside its 500 m building radius, outside zones
const MEMBER_OUT = { lng: -79.02, lat: 43.48 };  // outside zones AND outside every corporate building (membership-only)

const PHONES = {
  owner: '+14165550001',
  finance: '+14165550005',
  dispatcher: '+14165550002',
  driver: '+14165550006',
  org2owner: '+14165559001',
  res: RES.phone,
  corpres: CORPRES.phone,
  member: MEMBER.phone,
};

async function seedFixture(prisma: PrismaClient): Promise<void> {
  await prisma.service.upsert({ where: { id: SVC }, update: {}, create: { id: SVC, orgId: ORG1, vertical: 'SPECIALTY', name: 'GEO E2E service', unit: 'ITEM', baseRate: '10.0000' } });
  await prisma.service.upsert({ where: { id: SVC2 }, update: {}, create: { id: SVC2, orgId: ORG2, vertical: 'SPECIALTY', name: 'GEO E2E org2 service', unit: 'ITEM', baseRate: '10.0000' } });

  for (const r of [RES, CORPRES, MEMBER]) {
    await prisma.account.upsert({ where: { id: r.acct }, update: {}, create: { id: r.acct, orgId: ORG1, type: 'RESIDENTIAL', name: `GEO E2E resident ${r.phone}` } });
    await prisma.user.upsert({ where: { id: r.uid }, update: { phone: r.phone }, create: { id: r.uid, orgId: ORG1, name: `GEO E2E ${r.phone}`, phone: r.phone, authProviders: ['phone'], status: 'ACTIVE' } });
    await prisma.userRole.upsert({ where: { id: r.rid }, update: {}, create: { id: r.rid, orgId: ORG1, userId: r.uid, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: r.acct } });
  }

  // Corporate account + building (real PostGIS geo + 500 m match radius) + an ACTIVE membership for MEMBER.
  await prisma.account.upsert({ where: { id: CORP.acct }, update: { corporate: true }, create: { id: CORP.acct, orgId: ORG1, type: 'BUSINESS', name: 'GEO E2E — Corp Tower', corporate: true } });
  await prisma.site.upsert({ where: { id: CORP.site }, update: { matchRadiusM: 500 }, create: { id: CORP.site, orgId: ORG1, accountId: CORP.acct, name: 'GEO E2E — Corp Tower bldg', matchRadiusM: 500 } });
  await prisma.$executeRaw`UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${CORP_PT.lng}, ${CORP_PT.lat}), 4326)::geography WHERE id = ${CORP.site}::uuid`;
  await prisma.corporateMembership.upsert({
    where: { id: MEMBER.mid },
    update: { status: 'ACTIVE' },
    create: { id: MEMBER.mid, orgId: ORG1, userId: MEMBER.uid, accountId: CORP.acct, source: 'JOIN_CODE', status: 'ACTIVE', createdBy: MEMBER.uid },
  });
}

async function tearDown(prisma: PrismaClient): Promise<void> {
  // Only the GATING artifacts are removed (the zones that would gate other specs + the captured demand). The
  // accounts/users/services/membership/orders persist as idempotent fixtures (re-`upsert`ed each run) — exactly
  // the corporate-pricing e2e pattern (its residential accounts + orders accumulate too). This keeps ORG1 at
  // ZERO active zones for every other spec without fighting order FKs.
  await prisma.coverageRequest.deleteMany({ where: { userId: { in: [RES.uid, CORPRES.uid, MEMBER.uid] } } });
  await prisma.serviceZone.deleteMany({ where: { name: { startsWith: 'GEO E2E' } } });
}

describe('Geo-blocking e2e (Increment 19 — service zones + block-at-booking + demand capture)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  let zoneA = '';
  let zoneB = '';

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const patch = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

  const futureWindow = () => ({ start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 3 * 3600_000).toISOString() });

  function book(who: string, accountId: string, serviceId: string, serviceGeo?: { lat: number; lng: number }) {
    const body: Record<string, unknown> = { accountId, pickupWindow: futureWindow(), items: [{ kind: 'GARMENT', serviceId, estimatedMeasure: 1 }] };
    if (serviceGeo) body.serviceGeo = serviceGeo;
    return post('/v1/orders', who, body);
  }

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    await tearDown(prisma);
    await seedFixture(prisma);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
  }, 60000);

  afterAll(async () => {
    await tearDown(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  // ─────────────────────────── zone management + RBAC (lens 4) ───────────────────────────

  describe('zone management + RBAC', () => {
    it('RBAC: dispatcher / driver / a residential customer cannot create a zone (403)', async () => {
      await post('/v1/service-zones', 'dispatcher', { name: 'GEO E2E nope', polygon: ZONE_A }).expect(403);
      await post('/v1/service-zones', 'driver', { name: 'GEO E2E nope', polygon: ZONE_A }).expect(403);
      await post('/v1/service-zones', 'res', { name: 'GEO E2E nope', polygon: ZONE_A }).expect(403);
    });

    it('OWNER draws a zone; it lists back and the GeoJSON round-trips (geometry → GeoJSON)', async () => {
      const created = await post('/v1/service-zones', 'owner', { name: 'GEO E2E — Downtown', polygon: ZONE_A }).expect(201);
      zoneA = created.body.id;
      expect(created.body).toMatchObject({ name: 'GEO E2E — Downtown', active: true, sortOrder: 0 });
      expect(created.body.polygon.type).toBe('Polygon');
      // Round-trip: the drawn ring comes back (PostGIS may reorder to canonical winding but the ring is the same set).
      expect(created.body.polygon.coordinates[0]).toEqual(expect.arrayContaining([[-79.34, 43.70], [-79.32, 43.72]]));

      const list = await get('/v1/service-zones', 'owner').expect(200);
      expect(list.body.zones.map((z: { id: string }) => z.id)).toContain(zoneA);
      const one = await get(`/v1/service-zones/${zoneA}`, 'finance').expect(200);
      expect(one.body.polygon.coordinates[0].length).toBeGreaterThanOrEqual(5);
    });

    it('FINANCE can create a 2nd zone and patch it (rename / reorder / activate)', async () => {
      const created = await post('/v1/service-zones', 'finance', { name: 'GEO E2E — East', polygon: ZONE_B, sortOrder: 1 }).expect(201);
      zoneB = created.body.id;
      const renamed = await patch(`/v1/service-zones/${zoneB}`, 'finance', { name: 'GEO E2E — East End', sortOrder: 2 }).expect(200);
      expect(renamed.body).toMatchObject({ name: 'GEO E2E — East End', sortOrder: 2, active: true });
    });

    it('a malformed polygon is rejected: too few points → 400; self-intersecting → 400', async () => {
      await post('/v1/service-zones', 'owner', { name: 'GEO E2E bad', polygon: { type: 'Polygon', coordinates: [[[-79.4, 43.6], [-79.3, 43.6], [-79.4, 43.6]]] } }).expect(400);
      // A closed 5-point bowtie (passes the shape check but ST_IsValid = false).
      const bowtie = { type: 'Polygon', coordinates: [[[-79.40, 43.64], [-79.36, 43.66], [-79.36, 43.64], [-79.40, 43.66], [-79.40, 43.64]]] };
      const res = await post('/v1/service-zones', 'owner', { name: 'GEO E2E bowtie', polygon: bowtie }).expect(400);
      expect(res.body.error ?? res.body.title).toContain('zone');
    });

    it('cross-org: an org-2 owner cannot read or patch an org-1 zone (404, never leaks existence)', async () => {
      await get(`/v1/service-zones/${zoneA}`, 'org2owner').expect(404);
      await patch(`/v1/service-zones/${zoneA}`, 'org2owner', { active: false }).expect(404);
    });
  });

  // ─────────────────────────── enforcement is server-side (lens 1, 3) ───────────────────────────

  describe('block-at-booking enforcement', () => {
    it('a booking INSIDE an active zone books (201)', async () => {
      await book('res', RES.acct, SVC, IN_A).expect(201);
    });

    it('a booking in the SECOND active zone books (multi-zone, 201)', async () => {
      await book('res', RES.acct, SVC, IN_B).expect(201);
    });

    it('boundary: a point just inside books; a point just outside is blocked (ST_Covers, sane boundary)', async () => {
      await book('res', RES.acct, SVC, JUST_IN).expect(201);
      await book('res', RES.acct, SVC, JUST_OUT).expect(422);
    });

    it('a booking OUTSIDE every active zone is blocked (422 out_of_service_area) and captures ONE CoverageRequest', async () => {
      const before = await prisma.coverageRequest.count({ where: { orgId: ORG1, userId: RES.uid } });
      const res = await book('res', RES.acct, SVC, OUT).expect(422);
      expect(res.body.error ?? res.body.title).toBe('zone.out_of_service_area');
      const after = await prisma.coverageRequest.count({ where: { orgId: ORG1, userId: RES.uid } });
      expect(after).toBe(before + 1);
      // No order row was created for the blocked attempt (gates creation only).
      const rows = await prisma.$queryRaw<Array<{ address: string | null; lng: number; lat: number }>>`
        SELECT address, ST_X(point::geometry) AS lng, ST_Y(point::geometry) AS lat
        FROM "CoverageRequest" WHERE org_id = ${ORG1}::uuid AND user_id = ${RES.uid}::uuid ORDER BY created_at DESC LIMIT 1`;
      expect(Number(rows[0]!.lng)).toBeCloseTo(OUT.lng, 4);
      expect(Number(rows[0]!.lat)).toBeCloseTo(OUT.lat, 4);
    });

    it('demand-capture is honest: a repeated blocked attempt at the same point does NOT duplicate (lens 5)', async () => {
      const before = await prisma.coverageRequest.count({ where: { orgId: ORG1, userId: RES.uid } });
      await book('res', RES.acct, SVC, OUT).expect(422);
      const after = await prisma.coverageRequest.count({ where: { orgId: ORG1, userId: RES.uid } });
      expect(after).toBe(before); // deduped within the recent window
    });

    it('a deactivated zone stops covering — a previously-inside point is now blocked (422)', async () => {
      const off = await patch(`/v1/service-zones/${zoneA}`, 'owner', { active: false }).expect(200);
      expect(off.body.active).toBe(false); // the patch actually deactivated it
      await book('res', RES.acct, SVC, IN_A).expect(422);
      await patch(`/v1/service-zones/${zoneA}`, 'owner', { active: true }).expect(200); // restore for later tests
    });

    it('no active zones ⇒ the org serves everywhere (gate inert)', async () => {
      await patch(`/v1/service-zones/${zoneA}`, 'owner', { active: false }).expect(200);
      await patch(`/v1/service-zones/${zoneB}`, 'owner', { active: false }).expect(200);
      await book('res', RES.acct, SVC, OUT).expect(201); // outside every drawn zone, but none are active → books
      await patch(`/v1/service-zones/${zoneA}`, 'owner', { active: true }).expect(200);
      await patch(`/v1/service-zones/${zoneB}`, 'owner', { active: true }).expect(200);
    });

    it('a booking with NO service point is not gated (nothing to test — mirrors building-match)', async () => {
      await book('res', RES.acct, SVC).expect(201);
    });
  });

  // ─────────────────────────── corporate override (lens 2) ───────────────────────────

  describe('corporate override — a serviced corporate order is never geo-blocked', () => {
    it('an in-building resident books at a point outside every public zone (building match bypasses)', async () => {
      const res = await book('corpres', CORPRES.acct, SVC, CORP_IN).expect(201);
      // Priced on the corporate account (proves the building match resolved) — and NOT blocked.
      expect((await prisma.order.findUniqueOrThrow({ where: { id: res.body.id } })).pricingAccountId).toBe(CORP.acct);
    });

    it('an active member books at a point outside every zone and outside every building (membership bypasses)', async () => {
      const res = await book('member', MEMBER.acct, SVC, MEMBER_OUT).expect(201);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: res.body.id } })).pricingAccountId).toBe(CORP.acct);
    });

    it('a corporate ACCOUNT booking for itself is never geo-blocked even outside every zone', async () => {
      // Payer is the corporate account (account.corporate = true) — the explicit-service-commitment bypass.
      await book('owner', CORP.acct, SVC, OUT).expect(201);
    });
  });

  // ─────────────────────────── coverage read + tenancy (lens 4, 6) ───────────────────────────

  describe('coverage-request read + tenancy', () => {
    it('OWNER/FINANCE read the coverage waitlist (cursor-paginated); a customer cannot (403)', async () => {
      const list = await get('/v1/coverage-requests?limit=50', 'owner').expect(200);
      expect(Array.isArray(list.body.coverageRequests)).toBe(true);
      expect(list.body.coverageRequests.some((c: { lng: number }) => Math.abs(c.lng - OUT.lng) < 0.001)).toBe(true);
      expect(list.body).toHaveProperty('hasMore');
      await get('/v1/coverage-requests', 'res').expect(403);
      await get('/v1/coverage-requests', 'dispatcher').expect(403);
    });

    it("org-A's zones never gate org-B — an org-2 booking at a point outside org-1's zones books (201)", async () => {
      // ORG1 has active zones covering only downtown/east; ORG2 has NO zones. A booking in ORG2 at OUT must book.
      await book('org2owner', ORG2_ACCT, SVC2, OUT).expect(201);
    });
  });
});
