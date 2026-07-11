import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { GEOCODER_PROVIDER, GeocodeError, type GeocodeResult } from '../src/geocoding/geocoder.provider';

/**
 * Saved addresses e2e (Increment 26 — POST/PATCH/POST:deactivate /v1/sites) against the real (migrated)
 * Postgres + PostGIS + Redis, with the ONE outbound seam (the geocoder) swapped for a deterministic fake so
 * no test touches the network. Proves the whole reason the feature exists — a customer with ZERO sites can
 * add their first — plus every honesty/scoping invariant:
 *
 *   • CREATE  the server owns the coordinate (fake's real point, or a trusted map pin — never a guess); an
 *     unresolvable address is 422/503 and writes NOTHING; the first active site of an account is its default,
 *     and exactly one active default survives an explicit `isDefault`; unit/buzzer/notes round-trip; the
 *     mutation is Idempotency-Key safe.
 *   • SERVICEABILITY  a three-state coverage answer: `checked:false` when the org has drawn no active zones,
 *     `serviceable:true` inside our zone, and out-of-area captures EXACTLY ONE CoverageRequest (source
 *     `saved_address`) while STILL saving the address.
 *   • UPDATE  re-geocodes only when the address moves; a pin always wins; empty patch → 400; a deactivated
 *     site → 409.
 *   • DEACTIVATE  soft delete (drops out of the customer read), promotes the oldest remaining active site
 *     when it held the default, is repeatable (never 409), and blocks a later booking on the removed address.
 *   • SCOPING / RBAC  another account's site is 404 (never a 403 existence leak) and stays unmutated; the
 *     customer-side role gate (driver/dispatcher/owner → 403); cross-account reads never leak.
 *
 * Fixtures (id prefix `f6000000-…`, name prefix `SITE E2E`) are created + torn down by prefix in beforeAll
 * AND afterAll, so ORG1 is left with ZERO active service zones for every OTHER spec (the ACTIVE downtown
 * zone this spec draws is deleted in teardown; the two seeded org zones stay `active=false`).
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
const SEEDED_SERVICE = '66666666-6666-4666-8666-666666666666'; // org1 SPECIALTY service (reused to prove a deactivated site can't book)

// Fresh customer accounts (prefix f6 = sites e2e). NEW proves onboarding-from-zero; NEW2 is a pristine
// account used to assert default-promotion + can't-book on a clean slate (no accumulated CREATE-test state).
const NEW = { acct: 'f6000000-0000-4000-8000-000000000010', uid: 'f6000000-0000-4000-8000-000000000011', rid: 'f6000000-0000-4000-8000-000000000012', phone: '+14165558601' };
const NEW2 = { acct: 'f6000000-0000-4000-8000-000000000020', uid: 'f6000000-0000-4000-8000-000000000021', rid: 'f6000000-0000-4000-8000-000000000022', phone: '+14165558602' };
const ZONE = 'f6000000-0000-4000-8000-000000000001';

// Seeded cross-account customers in DIFFERENT accounts (for the no-existence-leak scoping tests).
const PRIYA_ACCT = 'd2000000-0000-4000-8000-000000000001';
const GRACE_ACCT = 'd2000000-0000-4000-8000-000000000002';

// An ACTIVE service zone covering downtown Toronto (a simple box). Verified with ST_Covers: City Hall /
// Union / Kensington fall INSIDE; Scarborough / Mississauga fall OUTSIDE.
const ZONE_POLY = {
  type: 'Polygon' as const,
  coordinates: [[[-79.42, 43.63], [-79.36, 43.63], [-79.36, 43.68], [-79.42, 43.68], [-79.42, 43.63]]],
};

// Real GTA coordinates the fake geocoder resolves its table to.
const CITY_HALL = { lng: -79.3839, lat: 43.6534 }; // in-zone
const UNION = { lng: -79.3806, lat: 43.6453 }; // in-zone
const KENSINGTON = { lng: -79.4005, lat: 43.6547 }; // in-zone
const SCARBOROUGH = { lng: -79.19, lat: 43.77 }; // out-of-zone (real Scarborough)
const MISSISSAUGA = { lng: -79.6441, lat: 43.589 }; // out-of-zone (real Mississauga)
const PIN = { lng: -79.3776, lat: 43.6489 }; // an arbitrary in-zone map-pin point (never geocoded)

/** The fake's lookup table — trimmed address string → real GTA point (zod trims `address` before it arrives). */
const GEO_TABLE: Record<string, { lng: number; lat: number }> = {
  'SITE E2E City Hall, Toronto': CITY_HALL,
  'SITE E2E Union Station, Toronto': UNION,
  'SITE E2E Kensington Market, Toronto': KENSINGTON,
  'SITE E2E Scarborough Town Centre': SCARBOROUGH,
  'SITE E2E Square One, Mississauga': MISSISSAUGA,
};

/**
 * The deterministic geocoder double swapped in for `GEOCODER_PROVIDER`. Resolves the small table above to
 * REAL points; an address containing NOWHERE is a permanent `not_found` (→ 422), UPSTREAMDOWN a transient
 * `unavailable` (→ 503). No network, ever. `jest.fn` so the tests can assert it WAS / WASN'T invoked.
 */
const fakeGeocoder = {
  geocode: jest.fn(async (address: string): Promise<GeocodeResult> => {
    if (address.includes('NOWHERE')) throw new GeocodeError('not_found', `no match for ${address}`);
    if (address.includes('UPSTREAMDOWN')) throw new GeocodeError('unavailable', 'geocoder upstream is down');
    const hit = GEO_TABLE[address];
    if (!hit) throw new GeocodeError('not_found', `unmapped fixture address: ${address}`);
    return { lng: hit.lng, lat: hit.lat, formattedAddress: address };
  }),
};

const PHONES = {
  owner: '+14165550001', // OWNER, org-wide (not a customer → role gate)
  dispatcher: '+14165550002', // DISPATCHER, org (role gate)
  driver: '+14165550006', // DRIVER, org (role gate)
  priya: '+14165550110', // RESIDENTIAL_CUSTOMER, PRIYA_ACCT
  grace: '+14165550111', // RESIDENTIAL_CUSTOMER, GRACE_ACCT (different account → scoping probe)
  org2owner: '+14165559001', // OWNER of Org 2
  newcust: NEW.phone, // fresh RESIDENTIAL_CUSTOMER with ZERO sites
  newcust2: NEW2.phone, // fresh pristine account for promotion/booking assertions
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function seedFixtures(prisma: PrismaClient): Promise<void> {
  for (const c of [NEW, NEW2]) {
    await prisma.account.upsert({ where: { id: c.acct }, update: {}, create: { id: c.acct, orgId: ORG1, type: 'RESIDENTIAL', name: `SITE E2E customer ${c.phone}` } });
    await prisma.user.upsert({ where: { id: c.uid }, update: { phone: c.phone }, create: { id: c.uid, orgId: ORG1, name: `SITE E2E ${c.phone}`, phone: c.phone, authProviders: ['phone'], status: 'ACTIVE' } });
    await prisma.userRole.upsert({ where: { id: c.rid }, update: {}, create: { id: c.rid, orgId: ORG1, userId: c.uid, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: c.acct } });
  }
}

async function tearDown(prisma: PrismaClient): Promise<void> {
  // Remove only what THIS spec created: the captured demand, every `SITE E2E`-named site (incl. the ones
  // created under priya's account), any stray site on the fresh accounts, and the ACTIVE downtown zone.
  await prisma.coverageRequest.deleteMany({ where: { userId: { in: [NEW.uid, NEW2.uid] } } });
  await prisma.site.deleteMany({ where: { OR: [{ name: { startsWith: 'SITE E2E' } }, { accountId: { in: [NEW.acct, NEW2.acct] } }] } });
  await prisma.serviceZone.deleteMany({ where: { id: ZONE } });
}

/** Draw the ACTIVE downtown zone (Prisma `Unsupported` geography → raw ST_GeomFromGeoJSON, the as-built pattern). */
async function activateZone(prisma: PrismaClient): Promise<void> {
  await prisma.serviceZone.upsert({
    where: { id: ZONE },
    update: { active: true, name: 'SITE E2E downtown zone' },
    create: { id: ZONE, orgId: ORG1, name: 'SITE E2E downtown zone', active: true, sortOrder: 0, createdBy: NEW.uid },
  });
  await prisma.$executeRaw`UPDATE "ServiceZone" SET area = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(ZONE_POLY)}), 4326)::geography WHERE id = ${ZONE}::uuid`;
}

/** Read one site's {lng,lat} back out of PostGIS — the authoritative geo, independent of the response body. */
async function readGeo(prisma: PrismaClient, siteId: string): Promise<{ lng: number; lat: number } | null> {
  const rows = await prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
    SELECT ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng FROM "Site" WHERE id = ${siteId}::uuid AND geo IS NOT NULL`;
  const r = rows[0];
  if (!r || r.lat === null || r.lng === null) return null;
  return { lng: Number(r.lng), lat: Number(r.lat) };
}

describe('Saved addresses e2e (Increment 26 — POST/PATCH/deactivate /v1/sites, fake geocoder)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const postKey = (path: string, who: string, body: unknown, key: string) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).set('Idempotency-Key', key).send(body as object);
  const patch = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

  const listSites = async (who: string): Promise<Array<{ id: string; accountId: string; unit: string | null; buzzer: string | null; notes: string | null; geo: { lng: number; lat: number } | null }>> =>
    (await get('/v1/sites', who).expect(200)).body.sites;

  const calls = () => fakeGeocoder.geocode.mock.calls.length;

  beforeAll(async () => {
    app = await createTestApp([{ token: GEOCODER_PROVIDER, useValue: fakeGeocoder }]);
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    await tearDown(prisma);
    await seedFixtures(prisma);
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

  // ─────────────────────────── CREATE ───────────────────────────

  describe('CREATE', () => {
    let firstSiteId = '';
    let defaultSiteId = '';

    it('a customer with ZERO sites creates one → 201; geo is the fake\'s real point; it appears in GET /v1/sites', async () => {
      // The onboarding hole this whole feature closes: an empty picker.
      expect((await listSites('newcust')).length).toBe(0);

      const before = calls();
      const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E Home', address: 'SITE E2E City Hall, Toronto' }).expect(201);
      expect(calls()).toBe(before + 1); // geocoded (no pin supplied)
      firstSiteId = res.body.site.id;
      defaultSiteId = firstSiteId;

      expect(res.body.site.geo.lng).toBeCloseTo(CITY_HALL.lng, 4);
      expect(res.body.site.geo.lat).toBeCloseTo(CITY_HALL.lat, 4);
      expect(res.body.site.isDefault).toBe(true); // the account's first active site is auto-default
      const sqlGeo = await readGeo(prisma, firstSiteId);
      expect(sqlGeo?.lng).toBeCloseTo(CITY_HALL.lng, 4);
      expect(sqlGeo?.lat).toBeCloseTo(CITY_HALL.lat, 4);

      const ids = (await listSites('newcust')).map((s) => s.id);
      expect(ids).toContain(firstSiteId);
    });

    it('the FIRST site is auto-isDefault:true; a SECOND is isDefault:false (first stays default)', async () => {
      const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E Work', address: 'SITE E2E Union Station, Toronto' }).expect(201);
      expect(res.body.site.isDefault).toBe(false);
      expect((await prisma.site.findUniqueOrThrow({ where: { id: firstSiteId } })).isDefault).toBe(true);
    });

    it('explicit isDefault:true DEMOTES the previous default (exactly one active default; via SQL)', async () => {
      const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E Cottage', address: 'SITE E2E Kensington Market, Toronto', isDefault: true }).expect(201);
      expect(res.body.site.isDefault).toBe(true);
      defaultSiteId = res.body.site.id;

      expect((await prisma.site.findUniqueOrThrow({ where: { id: firstSiteId } })).isDefault).toBe(false); // demoted
      expect(await prisma.site.count({ where: { accountId: NEW.acct, isDefault: true, active: true } })).toBe(1);
    });

    it('dto.geo (a map pin) is trusted verbatim and the geocoder is NOT called', async () => {
      const before = calls();
      const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E Pinned', address: 'SITE E2E an-unmapped pinned door', geo: PIN }).expect(201);
      expect(calls()).toBe(before); // pin supplied → no lookup
      expect(res.body.site.geo.lng).toBeCloseTo(PIN.lng, 4);
      expect(res.body.site.geo.lat).toBeCloseTo(PIN.lat, 4);
      const sqlGeo = await readGeo(prisma, res.body.site.id);
      expect(sqlGeo?.lng).toBeCloseTo(PIN.lng, 4);
    });

    it('unit / buzzer / notes round-trip through GET /v1/sites', async () => {
      const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E Detailed', address: 'SITE E2E Union Station, Toronto', unit: 'Suite 4B', buzzer: '#4321', notes: 'Side door, ring twice' }).expect(201);
      const mine = (await listSites('newcust')).find((s) => s.id === res.body.site.id);
      expect(mine).toBeDefined();
      expect(mine?.unit).toBe('Suite 4B');
      expect(mine?.buzzer).toBe('#4321');
      expect(mine?.notes).toBe('Side door, ring twice');
    });

    it("address 'NOWHERE' → 422 site.geocode_failed AND zero new Site rows", async () => {
      const before = await prisma.site.count({ where: { accountId: NEW.acct } });
      const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E Ghost', address: 'SITE E2E NOWHERE lane' }).expect(422);
      expect(res.body.title).toBe('site.geocode_failed');
      expect(await prisma.site.count({ where: { accountId: NEW.acct } })).toBe(before); // wrote nothing
    });

    it("address 'UPSTREAMDOWN' → 503 site.geocode_unavailable AND zero new Site rows", async () => {
      const before = await prisma.site.count({ where: { accountId: NEW.acct } });
      const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E Flaky', address: 'SITE E2E UPSTREAMDOWN blvd' }).expect(503);
      expect(res.body.title).toBe('site.geocode_unavailable');
      expect(await prisma.site.count({ where: { accountId: NEW.acct } })).toBe(before);
    });

    it("validation: name '' → 400; address '' → 400", async () => {
      await post('/v1/sites', 'newcust', { name: '', address: 'SITE E2E City Hall, Toronto' }).expect(400);
      await post('/v1/sites', 'newcust', { name: 'SITE E2E Blank', address: '' }).expect(400);
    });

    it('idempotency: the same Idempotency-Key twice → the same site id, exactly one row', async () => {
      const key = randomUUID();
      const body = { name: 'SITE E2E Idem', address: 'SITE E2E City Hall, Toronto' };
      const r1 = await postKey('/v1/sites', 'newcust', body, key).expect(201);
      const r2 = await postKey('/v1/sites', 'newcust', body, key).expect(201);
      expect(r2.body.site.id).toBe(r1.body.site.id);
      expect(await prisma.site.count({ where: { accountId: NEW.acct, name: 'SITE E2E Idem' } })).toBe(1);
    });

    it('sanity: exactly one active default survives all the creates', async () => {
      expect(await prisma.site.count({ where: { accountId: NEW.acct, isDefault: true, active: true } })).toBe(1);
      expect((await prisma.site.findUniqueOrThrow({ where: { id: defaultSiteId } })).isDefault).toBe(true);
    });
  });

  // ─────────────────────────── SERVICEABILITY ───────────────────────────

  describe('SERVICEABILITY', () => {
    it('with NO active zones → { checked:false, serviceable:false, coverageRequestId:null }', async () => {
      // ORG1 has zero active zones here (the downtown zone is not drawn yet) — the gate is inert, claim nothing.
      const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E NoZone', address: 'SITE E2E Scarborough Town Centre' }).expect(201);
      expect(res.body.serviceability).toEqual({ checked: false, serviceable: false, coverageRequestId: null });
    });

    describe('with an ACTIVE downtown zone', () => {
      let outOfAreaSiteId = '';

      beforeAll(async () => {
        await activateZone(prisma);
      });

      it('an in-zone address → { checked:true, serviceable:true, coverageRequestId:null }', async () => {
        const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E InZone', address: 'SITE E2E City Hall, Toronto' }).expect(201);
        expect(res.body.serviceability).toEqual({ checked: true, serviceable: true, coverageRequestId: null });
      });

      it('an out-of-zone address → serviceable:false + EXACTLY ONE CoverageRequest (source saved_address)', async () => {
        const before = await prisma.coverageRequest.count({ where: { userId: NEW.uid } });
        const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E OutZone', address: 'SITE E2E Square One, Mississauga' }).expect(201);
        outOfAreaSiteId = res.body.site.id;

        expect(res.body.serviceability.checked).toBe(true);
        expect(res.body.serviceability.serviceable).toBe(false);
        expect(res.body.serviceability.coverageRequestId).toMatch(UUID_RE);
        expect(await prisma.coverageRequest.count({ where: { userId: NEW.uid } })).toBe(before + 1); // exactly one row

        const rows = await prisma.$queryRaw<Array<{ source: string | null }>>`
          SELECT context->>'source' AS source FROM "CoverageRequest" WHERE id = ${res.body.serviceability.coverageRequestId}::uuid`;
        expect(rows[0]?.source).toBe('saved_address');
      });

      it('the address IS still saved when out-of-area (we save it; booking is what blocks later)', async () => {
        expect((await listSites('newcust')).map((s) => s.id)).toContain(outOfAreaSiteId);
        expect((await prisma.site.findUniqueOrThrow({ where: { id: outOfAreaSiteId } })).active).toBe(true);
      });
    });
  });

  // ─────────────────────────── UPDATE ───────────────────────────

  describe('UPDATE', () => {
    let siteId = '';

    beforeAll(async () => {
      const res = await post('/v1/sites', 'newcust', { name: 'SITE E2E ToEdit', address: 'SITE E2E City Hall, Toronto' }).expect(201);
      siteId = res.body.site.id;
    });

    it('a rename only → 200, the geocoder is NOT called again and geo is unchanged', async () => {
      const geoBefore = await readGeo(prisma, siteId);
      const before = calls();
      const res = await patch(`/v1/sites/${siteId}`, 'newcust', { name: 'SITE E2E Renamed' }).expect(200);
      expect(calls()).toBe(before); // never re-geocode a rename
      expect(res.body.site.name).toBe('SITE E2E Renamed');
      const geoAfter = await readGeo(prisma, siteId);
      expect(geoAfter?.lng).toBeCloseTo(geoBefore!.lng, 6);
      expect(geoAfter?.lat).toBeCloseTo(geoBefore!.lat, 6);
    });

    it('changing the address → re-geocodes and geo moves', async () => {
      const before = calls();
      const res = await patch(`/v1/sites/${siteId}`, 'newcust', { address: 'SITE E2E Union Station, Toronto' }).expect(200);
      expect(calls()).toBe(before + 1); // re-geocoded
      expect(res.body.site.geo.lng).toBeCloseTo(UNION.lng, 4);
      expect(res.body.site.geo.lat).toBeCloseTo(UNION.lat, 4);
      const sqlGeo = await readGeo(prisma, siteId);
      expect(sqlGeo?.lng).toBeCloseTo(UNION.lng, 4);
    });

    it('supplying geo → the pin wins and the geocoder is NOT called (even with a changed address)', async () => {
      const before = calls();
      const res = await patch(`/v1/sites/${siteId}`, 'newcust', { address: 'SITE E2E Kensington Market, Toronto', geo: PIN }).expect(200);
      expect(calls()).toBe(before); // pin wins over the changed address → no lookup
      expect(res.body.site.geo.lng).toBeCloseTo(PIN.lng, 4);
      expect(res.body.site.geo.lat).toBeCloseTo(PIN.lat, 4);
    });

    it('PATCH {} → 400 (the .refine: at least one field)', async () => {
      await patch(`/v1/sites/${siteId}`, 'newcust', {}).expect(400);
    });

    it('PATCH a deactivated site → 409 site.inactive', async () => {
      const created = await post('/v1/sites', 'newcust', { name: 'SITE E2E EditThenDeact', address: 'SITE E2E City Hall, Toronto' }).expect(201);
      await post(`/v1/sites/${created.body.site.id}:deactivate`, 'newcust').expect(200);
      const res = await patch(`/v1/sites/${created.body.site.id}`, 'newcust', { name: 'SITE E2E nope' }).expect(409);
      expect(res.body.title).toBe('site.inactive');
    });
  });

  // ─────────────────────────── DEACTIVATE ───────────────────────────

  describe('DEACTIVATE', () => {
    it('deactivate → 200, active=false in SQL, and it DISAPPEARS from GET /v1/sites', async () => {
      const created = await post('/v1/sites', 'newcust', { name: 'SITE E2E ToRemove', address: 'SITE E2E City Hall, Toronto' }).expect(201);
      const id = created.body.site.id;
      expect((await listSites('newcust')).map((s) => s.id)).toContain(id);

      const res = await post(`/v1/sites/${id}:deactivate`, 'newcust').expect(200);
      expect(res.body.site.id).toBe(id);
      expect((await prisma.site.findUniqueOrThrow({ where: { id } })).active).toBe(false);
      expect((await listSites('newcust')).map((s) => s.id)).not.toContain(id); // customer read filters active=true
    });

    // A pristine account (NEW2) so the "oldest remaining active" promotion is deterministic, unpolluted by
    // the CREATE-section rows that accumulated on NEW.
    describe('default promotion + can\'t-book on a pristine account', () => {
      let siteA = '';
      let siteB = '';
      let siteC = '';

      beforeAll(async () => {
        siteA = (await post('/v1/sites', 'newcust2', { name: 'SITE E2E A', address: 'SITE E2E City Hall, Toronto' }).expect(201)).body.site.id; // oldest → auto-default
        siteB = (await post('/v1/sites', 'newcust2', { name: 'SITE E2E B', address: 'SITE E2E Union Station, Toronto' }).expect(201)).body.site.id;
        siteC = (await post('/v1/sites', 'newcust2', { name: 'SITE E2E C', address: 'SITE E2E Kensington Market, Toronto' }).expect(201)).body.site.id;
      });

      it('deactivating the DEFAULT promotes the OLDEST remaining active site (promotedDefaultSiteId + SQL)', async () => {
        const res = await post(`/v1/sites/${siteA}:deactivate`, 'newcust2').expect(200);
        expect(res.body.promotedDefaultSiteId).toBe(siteB); // oldest remaining active (createdAt asc)

        const a = await prisma.site.findUniqueOrThrow({ where: { id: siteA } });
        expect(a.active).toBe(false);
        expect(a.isDefault).toBe(false);
        expect((await prisma.site.findUniqueOrThrow({ where: { id: siteB } })).isDefault).toBe(true);
        expect((await prisma.site.findUniqueOrThrow({ where: { id: siteC } })).isDefault).toBe(false);
        expect(await prisma.site.count({ where: { accountId: NEW2.acct, isDefault: true, active: true } })).toBe(1);
      });

      it('deactivating an ALREADY deactivated site → 200, promotedDefaultSiteId null (repeatable, not 409)', async () => {
        const r1 = await post(`/v1/sites/${siteA}:deactivate`, 'newcust2').expect(200);
        expect(r1.body.promotedDefaultSiteId).toBeNull();
        const r2 = await post(`/v1/sites/${siteA}:deactivate`, 'newcust2').expect(200); // idempotent
        expect(r2.body.promotedDefaultSiteId).toBeNull();
        // The promotion from the first (real) deactivation is not re-run: siteB is still the sole default.
        expect(await prisma.site.count({ where: { accountId: NEW2.acct, isDefault: true, active: true } })).toBe(1);
      });

      it('a deactivated site can no longer be BOOKED → POST /v1/orders → 400', async () => {
        const res = await post('/v1/orders', 'newcust2', { accountId: NEW2.acct, siteId: siteA, items: [{ kind: 'RUG', serviceId: SEEDED_SERVICE, estimatedMeasure: 5 }] }).expect(400);
        expect(res.body.title).toBe('invalid_booking');
        // control: an ACTIVE site on the same account DOES book — proving the 400 is the deactivation, not the payload.
        await post('/v1/orders', 'newcust2', { accountId: NEW2.acct, siteId: siteB, items: [{ kind: 'RUG', serviceId: SEEDED_SERVICE, estimatedMeasure: 5 }] }).expect(201);
      });
    });
  });

  // ─────────────────────────── SCOPING / RBAC ───────────────────────────

  describe('SCOPING / RBAC', () => {
    let priyaSiteId = '';

    beforeAll(async () => {
      priyaSiteId = (await post('/v1/sites', 'priya', { name: 'SITE E2E priya home', address: 'SITE E2E City Hall, Toronto' }).expect(201)).body.site.id;
    });

    it("grace PATCHes priya's site → 404 site.not_found (no existence leak) and priya's row is unmutated", async () => {
      const before = await prisma.site.findUniqueOrThrow({ where: { id: priyaSiteId } });
      const res = await patch(`/v1/sites/${priyaSiteId}`, 'grace', { name: 'SITE E2E hijacked' }).expect(404);
      expect(res.body.title).toBe('site.not_found'); // 404, never 403 — a probe can't confirm the row exists
      const after = await prisma.site.findUniqueOrThrow({ where: { id: priyaSiteId } });
      expect(after.name).toBe(before.name); // untouched
    });

    it("grace POST …:deactivate on priya's site → 404, and priya's site stays active", async () => {
      const res = await post(`/v1/sites/${priyaSiteId}:deactivate`, 'grace').expect(404);
      expect(res.body.title).toBe('site.not_found');
      expect((await prisma.site.findUniqueOrThrow({ where: { id: priyaSiteId } })).active).toBe(true);
    });

    it('driver → 403; dispatcher → 403; owner (org-wide, no account scope) → 403 role gate', async () => {
      const body = { name: 'SITE E2E denied', address: 'SITE E2E City Hall, Toronto' };
      await post('/v1/sites', 'driver', body).expect(403);
      await post('/v1/sites', 'dispatcher', body).expect(403);
      await post('/v1/sites', 'owner', body).expect(403); // OWNER isn't a customer-side MANAGE role
    });

    it("org2owner cannot touch an ORG1 site → 403 (role gate fires before the scope check), never 200", async () => {
      // Encodes the REAL behaviour: OWNER is outside the customer MANAGE roles, so the @Roles guard denies
      // with 403 before SitesService can 404 on scope. The invariant that matters: it is NOT 200.
      const res = await patch(`/v1/sites/${priyaSiteId}`, 'org2owner', { name: 'SITE E2E cross-org' });
      expect(res.status).toBe(403);
      expect((await prisma.site.findUniqueOrThrow({ where: { id: priyaSiteId } })).name).toBe('SITE E2E priya home');
    });

    it("a site created by priya is NOT visible in grace's GET /v1/sites", async () => {
      const graceSites = await listSites('grace');
      expect(graceSites.map((s) => s.id)).not.toContain(priyaSiteId);
      expect(graceSites.every((s) => s.accountId === GRACE_ACCT)).toBe(true); // never another account's rows
      // and priya DOES see her own — proving the row exists (the 404 above was scope, not absence)
      expect((await listSites('priya')).map((s) => s.id)).toContain(priyaSiteId);
    });
  });
});
