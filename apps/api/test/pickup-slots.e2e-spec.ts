import { INestApplication } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import request from 'supertest';
import { DEFAULT_PICKUP_SCHEDULE, type OrgSchedule, type PickupSlot, type PickupSlotsResult } from '@blue-bee/shared';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Pickup scheduling e2e (Increment 28) against the real migrated Postgres + Redis. Covers the whole loop the
 * increment exists to close:
 *
 *   Part C  OWNER saves real operating hours  → `PATCH /v1/admin/settings/schedule` (validated, audited,
 *           merged into `Organization.settings` without clobbering `tz`/`region`/`currency`).
 *   Part A  the customer reads what was saved → `GET /v1/availability/pickup-slots` serves EXACTLY those
 *           windows, resolved to real America/Toronto instants, with a REAL capacity count.
 *   Inherit the chosen slot reaches the truck  → a `RouteStop` added without an explicit `timeWindow`
 *           inherits the order's `scheduledPickupWindow`, so the optimizer sorts by it and the on-time KPI
 *           can measure against it.
 *
 * The honesty firewall is the thing under test, not a side note:
 *   • with NO cap configured, five overlapping orders still leave every slot `available`, `remaining: null`,
 *     `capacityChecked: false` — scarcity is never fabricated;
 *   • with a cap configured, `remaining` is a real count and a full slot is `reason: 'full'`;
 *   • an order already collected (`PICKED_UP`) releases its slot;
 *   • an unsaved schedule is served but LABELLED `scheduleSource: 'default'`.
 *
 * Fixtures use the `f8000000-…` id prefix and the `SLOTS E2E` name prefix, and are torn down in `beforeAll`
 * AND `afterAll`. ORG1's `settings` is snapshotted and restored, because every other spec resolves the
 * default schedule from it.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ORG2 = 'e0000000-0000-4000-8000-000000000002'; // the seeded isolation org (seed.ts `ID2.org2`)
const ORG2_ACCOUNT = 'e0000000-0000-4000-8000-0000000000c0'; // seed.ts `ID2.org2Account`
const SEEDED_SERVICE = '66666666-6666-4666-8666-666666666666'; // org1 SPECIALTY service

/**
 * Real GTA points for the fixture sites. The optimizer only sequences stops whose SITE has a PostGIS
 * point (`hasCoord`) — a geo-less stop is appended in input order and would never demonstrate the
 * window-priority ordering the inheritance test asserts.
 */
const GEO_A = { lng: -79.3839, lat: 43.6534 }; // Toronto City Hall
const GEO_B = { lng: -79.3806, lat: 43.6453 }; // Union Station

const A = { acct: 'f8000000-0000-4000-8000-000000000010', uid: 'f8000000-0000-4000-8000-000000000011', rid: 'f8000000-0000-4000-8000-000000000012', site: 'f8000000-0000-4000-8000-000000000013', phone: '+14165558801' };
const B = { acct: 'f8000000-0000-4000-8000-000000000020', uid: 'f8000000-0000-4000-8000-000000000021', rid: 'f8000000-0000-4000-8000-000000000022', site: 'f8000000-0000-4000-8000-000000000023', phone: '+14165558802' };
/** A's second site, deactivated — a removed address must not answer availability. */
const A_DEAD_SITE = 'f8000000-0000-4000-8000-000000000014';
const ABSENT_SITE = 'f8000000-0000-4000-8000-0000000000ff';

const PHONES = {
  owner: '+14165550001', // OWNER org1 — the only role that may read/write the schedule
  dispatcher: '+14165550002',
  csr: '+14165550003',
  driver: '+14165550006',
  custA: A.phone, // RESIDENTIAL_CUSTOMER, account A
  custB: B.phone, // RESIDENTIAL_CUSTOMER, account B (cross-account probe)
  org2owner: '+14165559001',
};

/** A real, non-default schedule the founder could plausibly save. */
const FOUNDER_SCHEDULE: OrgSchedule = {
  windows: [
    { label: 'Morning', start: '08:00', end: '11:00' },
    { label: 'Midday', start: '11:00', end: '14:00' },
    { label: 'Evening', start: '17:00', end: '20:00' },
  ],
  leadTimeHours: 3,
  horizonDays: 5,
  maxPerSlot: null,
  closedDays: [0], // closed Sundays
};

/** `YYYY-MM-DD`, `days` from now, in the org's business timezone (the frame the API answers in). */
function torontoDateKey(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  // en-CA renders ISO-ordered YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The wall clock (`HH:MM`) an instant reads in Toronto — used to prove the DST-correct resolution. */
function torontoClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

const weekdayOf = (key: string): number => new Date(`${key}T12:00:00Z`).getUTCDay();

/** The first date in the next fortnight that is neither today nor a Sunday — safely inside every horizon. */
function stableFutureDate(): string {
  for (let i = 2; i < 14; i++) {
    const key = torontoDateKey(i);
    if (weekdayOf(key) !== 0) return key;
  }
  throw new Error('unreachable');
}

/** Every route this spec creates, so teardown removes exactly those and nothing else. */
const createdRouteIds: string[] = [];

async function seedFixtures(prisma: PrismaClient): Promise<void> {
  for (const [c, geo] of [
    [A, GEO_A],
    [B, GEO_B],
  ] as const) {
    await prisma.account.upsert({ where: { id: c.acct }, update: {}, create: { id: c.acct, orgId: ORG1, type: 'RESIDENTIAL', name: `SLOTS E2E customer ${c.phone}` } });
    await prisma.user.upsert({ where: { id: c.uid }, update: { phone: c.phone }, create: { id: c.uid, orgId: ORG1, name: `SLOTS E2E ${c.phone}`, phone: c.phone, authProviders: ['phone'], status: 'ACTIVE' } });
    await prisma.userRole.upsert({ where: { id: c.rid }, update: {}, create: { id: c.rid, orgId: ORG1, userId: c.uid, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: c.acct } });
    await prisma.site.upsert({ where: { id: c.site }, update: { active: true }, create: { id: c.site, orgId: ORG1, accountId: c.acct, name: `SLOTS E2E home ${c.phone}`, address: '1 Main St, Toronto', active: true } });
    // `Site.geo` is Prisma `Unsupported` → raw SQL, the as-built pattern (sites.e2e-spec.ts).
    await prisma.$executeRaw`UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${geo.lng}, ${geo.lat}), 4326)::geography WHERE id = ${c.site}::uuid`;
  }
  await prisma.site.upsert({
    where: { id: A_DEAD_SITE },
    update: { active: false },
    create: { id: A_DEAD_SITE, orgId: ORG1, accountId: A.acct, name: 'SLOTS E2E removed address', address: '2 Old St, Toronto', active: false },
  });
}

/**
 * Delete every order (and its stops/items/tags) and route this spec created. `Order` has no append-only
 * trigger, but `Item` FKs it and `Tag` is FK'd BY `Item`, so the order is: stops → items → orders → tags.
 */
async function clearOrdersAndRoutes(prisma: PrismaClient): Promise<void> {
  const orders = await prisma.order.findMany({ where: { accountId: { in: [A.acct, B.acct] } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    await prisma.routeStop.deleteMany({ where: { orderId: { in: orderIds } } });
    const items = await prisma.item.findMany({ where: { orderId: { in: orderIds } }, select: { tagId: true } });
    await prisma.item.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    const tagIds = items.map((i) => i.tagId).filter((t): t is string => t !== null);
    if (tagIds.length > 0) await prisma.tag.deleteMany({ where: { id: { in: tagIds } } });
  }
  await prisma.routeStop.deleteMany({ where: { accountId: { in: [A.acct, B.acct] } } });
  if (createdRouteIds.length > 0) {
    await prisma.routeStop.deleteMany({ where: { routeId: { in: createdRouteIds } } });
    await prisma.route.deleteMany({ where: { id: { in: createdRouteIds } } });
    createdRouteIds.length = 0;
  }
}

async function tearDown(prisma: PrismaClient): Promise<void> {
  await clearOrdersAndRoutes(prisma);
  await prisma.site.deleteMany({ where: { accountId: { in: [A.acct, B.acct] } } });
}

describe('Pickup scheduling e2e (Inc-28 — availability + the founder schedule + window inheritance)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  /** ORG1's `settings` exactly as the suite found them — restored in afterAll. */
  let originalSettings: Prisma.JsonValue;

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const patch = (path: string, who: string, body: unknown = {}) => request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);

  const slots = async (who: string, query = ''): Promise<PickupSlotsResult> => (await get(`/v1/availability/pickup-slots${query}`, who).expect(200)).body;
  const byLabel = (r: PickupSlotsResult, label: string): PickupSlot => {
    const s = r.slots.find((x) => x.label === label);
    if (!s) throw new Error(`no slot labelled ${label} in [${r.slots.map((x) => x.label).join(', ')}]`);
    return s;
  };

  /** Reset ORG1 to "founder has saved nothing" — the state every other spec expects. */
  const clearSchedule = async (): Promise<void> => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ORG1 } });
    const s = { ...((org.settings ?? {}) as Record<string, unknown>) };
    delete s.schedule;
    await prisma.organization.update({ where: { id: ORG1 }, data: { settings: s as Prisma.InputJsonValue } });
  };

  /** A bare Order occupying `window` — the capacity count reads nothing else. */
  const occupy = async (window: { start: string; end: string }, status: 'REQUESTED' | 'PICKED_UP' = 'REQUESTED'): Promise<string> => {
    const o = await prisma.order.create({
      data: { orgId: ORG1, accountId: A.acct, siteId: A.site, vertical: 'SPECIALTY', type: 'JOB', status, scheduledPickupWindow: window, totals: {} },
      select: { id: true },
    });
    return o.id;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await tearDown(prisma);
    await seedFixtures(prisma);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ORG1 } });
    originalSettings = org.settings;
    await clearSchedule();

    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
  }, 60000);

  afterAll(async () => {
    await tearDown(prisma);
    await prisma.organization.update({ where: { id: ORG1 }, data: { settings: originalSettings as Prisma.InputJsonValue } });
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await clearSchedule();
    await clearOrdersAndRoutes(prisma);
  });

  // ══════════════════════════ Part A — the availability read ══════════════════════════

  describe('GET /v1/availability/pickup-slots — the documented default', () => {
    it('serves the default windows, LABELLED as a default, when the founder has saved nothing', async () => {
      const r = await slots('custA', `?date=${stableFutureDate()}`);
      expect(r.scheduleSource).toBe('default');
      expect(r.slots.map((s) => s.label)).toEqual(['Morning', 'Afternoon', 'Evening']);
      expect(r.timezone).toBe('America/Toronto');
      expect(r.closed).toBe(false);
    });

    it('resolves each window to a REAL Toronto instant (the wall clock the founder typed)', async () => {
      const date = stableFutureDate();
      const r = await slots('custA', `?date=${date}`);
      expect(torontoClock(byLabel(r, 'Morning').start)).toBe('09:00');
      expect(torontoClock(byLabel(r, 'Morning').end)).toBe('12:00');
      expect(torontoClock(byLabel(r, 'Evening').end)).toBe('18:00');
      // The instants are absolute, and they belong to the requested LOCAL day.
      expect(byLabel(r, 'Morning').start.endsWith('Z')).toBe(true);
      expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(byLabel(r, 'Morning').start))).toBe(date);
    });

    /** No cap configured ⇒ no count, no scarcity, and a `remaining` a UI cannot render a number from. */
    it('never fabricates scarcity: no cap ⇒ capacityChecked false, remaining null, nothing full', async () => {
      const date = stableFutureDate();
      const first = await slots('custA', `?date=${date}`);
      const morning = byLabel(first, 'Morning');
      // Five orders piled into the same window. With no cap, none of them may shrink availability.
      for (let i = 0; i < 5; i++) await occupy({ start: morning.start, end: morning.end });

      const r = await slots('custA', `?date=${date}`);
      expect(r.capacityChecked).toBe(false);
      expect(r.slots.every((s) => s.remaining === null)).toBe(true);
      expect(r.slots.every((s) => s.available)).toBe(true);
      expect(r.slots.every((s) => s.reason === null)).toBe(true);
    });

    it('omits the date param → answers the first bookable day, and lists the horizon', async () => {
      const r = await slots('custA');
      expect(r.bookableDates.length).toBeGreaterThan(0);
      expect(r.bookableDates.length).toBeLessThanOrEqual(DEFAULT_PICKUP_SCHEDULE.horizonDays);
      expect(r.date).toBe(r.bookableDates[0]);
      expect(r.bookableDates.every((d) => d >= torontoDateKey(0))).toBe(true); // never a past day
      expect([...r.bookableDates].sort()).toEqual(r.bookableDates); // ascending
    });

    it('a slot inside the lead time is unavailable with reason `lead_time` (not silently hidden)', async () => {
      // A 168h (7-day) lead time makes the entire 7-day horizon unbookable — deterministic, no clock control.
      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, leadTimeHours: 168, horizonDays: 7 }).expect(200);
      const r = await slots('custA', `?date=${torontoDateKey(1)}`);
      expect(r.bookableDates).toEqual([]);
      expect(r.slots).toHaveLength(3);
      expect(r.slots.every((s) => !s.available)).toBe(true);
      expect(r.slots.every((s) => s.reason === 'lead_time')).toBe(true);
    });

    it("today's already-started windows are reported `past`, and `lead_time` is unreachable at zero lead", async () => {
      // Zero lead time isolates the `past` branch: a window is unavailable only once its start has passed.
      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, leadTimeHours: 0 }).expect(200);
      const r = await slots('custA', `?date=${torontoDateKey(0)}`);
      const now = Date.now();
      expect(r.slots).toHaveLength(3);
      for (const s of r.slots) {
        const started = new Date(s.start).getTime() <= now;
        expect(s.reason).toBe(started ? 'past' : null);
        expect(s.available).toBe(!started);
      }
      expect(r.slots.some((s) => s.reason === 'lead_time')).toBe(false);
    });
  });

  describe('GET /v1/availability/pickup-slots — REAL capacity, once a cap exists', () => {
    it('counts overlapping orders against the cap: a full slot is `full` with remaining 0', async () => {
      const date = stableFutureDate();
      const base = await slots('custA', `?date=${date}`);
      const morning = byLabel(base, 'Morning');
      const afternoon = byLabel(base, 'Afternoon');

      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, maxPerSlot: 2 }).expect(200);

      await occupy({ start: morning.start, end: morning.end });
      let r = await slots('custA', `?date=${date}`);
      expect(r.capacityChecked).toBe(true);
      expect(byLabel(r, 'Morning')).toMatchObject({ available: true, remaining: 1, reason: null });

      await occupy({ start: morning.start, end: morning.end });
      r = await slots('custA', `?date=${date}`);
      expect(byLabel(r, 'Morning')).toMatchObject({ available: false, remaining: 0, reason: 'full' });
      // …and the neighbouring window is untouched: adjacent windows do not overlap.
      expect(byLabel(r, 'Afternoon')).toMatchObject({ available: true, remaining: 2, reason: null });
      expect(afternoon.start).toBe(morning.end); // they really are adjacent
    });

    it('an order that STRADDLES two windows consumes capacity in both', async () => {
      const date = stableFutureDate();
      const base = await slots('custA', `?date=${date}`);
      const morning = byLabel(base, 'Morning');
      const afternoon = byLabel(base, 'Afternoon');
      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, maxPerSlot: 2 }).expect(200);

      // 11:00–13:00 local: the last hour of Morning and the first hour of Afternoon.
      const straddle = { start: new Date(new Date(morning.end).getTime() - 3_600_000).toISOString(), end: new Date(new Date(afternoon.start).getTime() + 3_600_000).toISOString() };
      await occupy(straddle);

      const r = await slots('custA', `?date=${date}`);
      expect(byLabel(r, 'Morning').remaining).toBe(1);
      expect(byLabel(r, 'Afternoon').remaining).toBe(1);
      expect(byLabel(r, 'Evening').remaining).toBe(2); // untouched
    });

    it('an order already collected (PICKED_UP) releases its slot', async () => {
      const date = stableFutureDate();
      const base = await slots('custA', `?date=${date}`);
      const morning = byLabel(base, 'Morning');
      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, maxPerSlot: 1 }).expect(200);

      const orderId = await occupy({ start: morning.start, end: morning.end });
      expect(byLabel(await slots('custA', `?date=${date}`), 'Morning')).toMatchObject({ available: false, reason: 'full' });

      await prisma.order.update({ where: { id: orderId }, data: { status: 'PICKED_UP' } });
      expect(byLabel(await slots('custA', `?date=${date}`), 'Morning')).toMatchObject({ available: true, remaining: 1, reason: null });
    });

    it("another org's orders never consume this org's capacity", async () => {
      const date = stableFutureDate();
      const base = await slots('custA', `?date=${date}`);
      const morning = byLabel(base, 'Morning');
      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, maxPerSlot: 1 }).expect(200);

      const foreign = await prisma.order.create({
        data: { orgId: ORG2, accountId: ORG2_ACCOUNT, vertical: 'SPECIALTY', type: 'JOB', status: 'REQUESTED', scheduledPickupWindow: { start: morning.start, end: morning.end }, totals: {} },
        select: { id: true },
      });
      try {
        expect(byLabel(await slots('custA', `?date=${date}`), 'Morning')).toMatchObject({ available: true, remaining: 1 });
      } finally {
        await prisma.order.delete({ where: { id: foreign.id } });
      }
    });

    it('removing the cap removes the scarcity: capacityChecked flips back to false', async () => {
      const date = stableFutureDate();
      const base = await slots('custA', `?date=${date}`);
      const morning = byLabel(base, 'Morning');
      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, maxPerSlot: 1 }).expect(200);
      await occupy({ start: morning.start, end: morning.end });
      expect(byLabel(await slots('custA', `?date=${date}`), 'Morning').available).toBe(false);

      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, maxPerSlot: null }).expect(200);
      const r = await slots('custA', `?date=${date}`);
      expect(r.capacityChecked).toBe(false);
      expect(byLabel(r, 'Morning')).toMatchObject({ available: true, remaining: null, reason: null });
    });
  });

  describe('GET /v1/availability/pickup-slots — dates, closed days, scoping, RBAC', () => {
    it('a closed weekday answers `closed: true` with no slots (a real answer, not an empty one)', async () => {
      const target = torontoDateKey(1);
      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, closedDays: [weekdayOf(target)] }).expect(200);
      const r = await slots('custA', `?date=${target}`);
      expect(r.closed).toBe(true);
      expect(r.slots).toEqual([]);
      expect(r.bookableDates).not.toContain(target);
    });

    it('a past date, and a date beyond the horizon, are 400 date_out_of_range', async () => {
      const past = await get(`/v1/availability/pickup-slots?date=${torontoDateKey(-1)}`, 'custA').expect(400);
      expect(past.body.title).toBe('availability.date_out_of_range');
      const far = await get(`/v1/availability/pickup-slots?date=${torontoDateKey(30)}`, 'custA').expect(400);
      expect(far.body.title).toBe('availability.date_out_of_range');
    });

    it('a malformed date is a 400 validation_failed; a nonexistent calendar date is date_out_of_range', async () => {
      await get('/v1/availability/pickup-slots?date=10-07-2026', 'custA').expect(400);
      await get('/v1/availability/pickup-slots?date=not-a-date', 'custA').expect(400);
      const fake = await get('/v1/availability/pickup-slots?date=2026-02-30', 'custA').expect(400);
      expect(fake.body.title).toBe('availability.date_out_of_range');
    });

    it("another account's site is a 404 (never a 403 — no existence leak), as is an absent one", async () => {
      await get(`/v1/availability/pickup-slots?siteId=${A.site}`, 'custA').expect(200);
      const foreign = await get(`/v1/availability/pickup-slots?siteId=${B.site}`, 'custA').expect(404);
      expect(foreign.body.title).toBe('availability.site_not_found');
      const absent = await get(`/v1/availability/pickup-slots?siteId=${ABSENT_SITE}`, 'custA').expect(404);
      expect(absent.body.title).toBe('availability.site_not_found');
      // …and B, symmetrically, cannot probe A's.
      await get(`/v1/availability/pickup-slots?siteId=${A.site}`, 'custB').expect(404);
    });

    it('a DEACTIVATED (removed) address is a 404 — a removed address cannot schedule a pickup', async () => {
      const res = await get(`/v1/availability/pickup-slots?siteId=${A_DEAD_SITE}`, 'custA').expect(404);
      expect(res.body.title).toBe('availability.site_not_found');
    });

    it('a malformed siteId is a 400', async () => {
      await get('/v1/availability/pickup-slots?siteId=not-a-uuid', 'custA').expect(400);
    });

    it('the role gate is the customer side: ops staff get 403', async () => {
      await get('/v1/availability/pickup-slots', 'owner').expect(403);
      await get('/v1/availability/pickup-slots', 'dispatcher').expect(403);
      await get('/v1/availability/pickup-slots', 'driver').expect(403);
      await get('/v1/availability/pickup-slots', 'csr').expect(403);
      await get('/v1/availability/pickup-slots', 'custA').expect(200);
    });

    it('is auth-gated', async () => {
      await request(app.getHttpServer()).get('/v1/availability/pickup-slots').expect(401);
    });
  });

  // ══════════════════════════ Part C — the founder's control ══════════════════════════

  describe('GET/PATCH /v1/admin/settings/schedule', () => {
    it('GET reports the default as a default until real hours are saved', async () => {
      const r = (await get('/v1/admin/settings/schedule', 'owner').expect(200)).body;
      expect(r.source).toBe('default');
      expect(r.schedule).toEqual(DEFAULT_PICKUP_SCHEDULE);
      expect(r.timezone).toBe('America/Toronto');
    });

    it('PATCH saves the founder hours, flips source to `org`, and AVAILABILITY IMMEDIATELY SERVES THEM', async () => {
      const saved = (await patch('/v1/admin/settings/schedule', 'owner', FOUNDER_SCHEDULE).expect(200)).body;
      expect(saved.source).toBe('org');
      expect(saved.schedule).toEqual(FOUNDER_SCHEDULE);

      expect((await get('/v1/admin/settings/schedule', 'owner').expect(200)).body).toMatchObject({ source: 'org', schedule: FOUNDER_SCHEDULE });

      // The whole point of Part C: what the founder saved is what the customer is offered.
      const date = stableFutureDate();
      const r = await slots('custA', `?date=${date}`);
      expect(r.scheduleSource).toBe('org');
      expect(r.slots.map((s) => s.label)).toEqual(['Morning', 'Midday', 'Evening']);
      expect(torontoClock(byLabel(r, 'Morning').start)).toBe('08:00');
      expect(torontoClock(byLabel(r, 'Evening').end)).toBe('20:00');
      expect(r.bookableDates.length).toBeLessThanOrEqual(FOUNDER_SCHEDULE.horizonDays);
      expect(r.bookableDates.some((d) => weekdayOf(d) === 0)).toBe(false); // Sundays closed
    });

    it('PATCH preserves the sibling settings bootstrap wrote (region / currency / tz)', async () => {
      const before = (await prisma.organization.findUniqueOrThrow({ where: { id: ORG1 } })).settings as Record<string, unknown>;
      await patch('/v1/admin/settings/schedule', 'owner', FOUNDER_SCHEDULE).expect(200);
      const after = (await prisma.organization.findUniqueOrThrow({ where: { id: ORG1 } })).settings as Record<string, unknown>;
      expect(after.tz).toBe(before.tz);
      expect(after.region).toBe(before.region);
      expect(after.currency).toBe(before.currency);
      expect(after.schedule).toEqual(FOUNDER_SCHEDULE);
    });

    it('PATCH writes ONE immutable audit row naming the actor, and records that a default was replaced', async () => {
      const at = new Date();
      await patch('/v1/admin/settings/schedule', 'owner', FOUNDER_SCHEDULE).expect(200);
      const rows = await prisma.auditLog.findMany({ where: { entity: 'Organization', entityId: ORG1, action: 'PICKUP_SCHEDULE_UPDATED', at: { gte: at } } });
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.actorId).toBeTruthy();
      expect((row.before as { source: string }).source).toBe('default');
      expect((row.after as { source: string }).source).toBe('org');
      expect((row.after as { schedule: OrgSchedule }).schedule).toEqual(FOUNDER_SCHEDULE);
    });

    it.each([
      ['overlapping windows', { windows: [{ label: 'A', start: '09:00', end: '13:00' }, { label: 'B', start: '12:00', end: '15:00' }] }],
      ['an inverted window', { windows: [{ label: 'A', start: '15:00', end: '09:00' }] }],
      ['no windows at all', { windows: [] }],
      ['a duplicate label', { windows: [{ label: 'Morning', start: '09:00', end: '11:00' }, { label: 'morning', start: '12:00', end: '14:00' }] }],
      ['a zero capacity cap', { maxPerSlot: 0 }],
      ['a negative lead time', { leadTimeHours: -1 }],
      ['a zero-day horizon', { horizonDays: 0 }],
      ['a fractional horizon', { horizonDays: 2.5 }],
      ['every day closed', { closedDays: [0, 1, 2, 3, 4, 5, 6] }],
      ['an out-of-range weekday', { closedDays: [7] }],
      ['a malformed HH:MM', { windows: [{ label: 'A', start: '9:00', end: '12:00' }] }],
      ['a 25th hour', { windows: [{ label: 'A', start: '25:00', end: '26:00' }] }],
    ])('PATCH rejects %s with 400, and changes nothing', async (_name, override) => {
      const before = (await prisma.organization.findUniqueOrThrow({ where: { id: ORG1 } })).settings;
      await patch('/v1/admin/settings/schedule', 'owner', { ...DEFAULT_PICKUP_SCHEDULE, ...override }).expect(400);
      const after = (await prisma.organization.findUniqueOrThrow({ where: { id: ORG1 } })).settings;
      expect(after).toEqual(before);
    });

    it('adjacent (touching) windows are legal — 09:00–12:00 then 12:00–15:00', async () => {
      await patch('/v1/admin/settings/schedule', 'owner', DEFAULT_PICKUP_SCHEDULE).expect(200);
    });

    it('is OWNER-only: every other role is 403 on read and write', async () => {
      for (const who of ['dispatcher', 'csr', 'driver', 'custA'] as const) {
        await get('/v1/admin/settings/schedule', who).expect(403);
        await patch('/v1/admin/settings/schedule', who, FOUNDER_SCHEDULE).expect(403);
      }
    });

    it('is auth-gated', async () => {
      await request(app.getHttpServer()).get('/v1/admin/settings/schedule').expect(401);
      await request(app.getHttpServer()).patch('/v1/admin/settings/schedule').send(FOUNDER_SCHEDULE).expect(401);
    });

    it("org2's owner writes org2's schedule and cannot see or move org1's", async () => {
      await patch('/v1/admin/settings/schedule', 'owner', FOUNDER_SCHEDULE).expect(200);
      const org2Schedule: OrgSchedule = { ...DEFAULT_PICKUP_SCHEDULE, horizonDays: 3, leadTimeHours: 1 };
      await patch('/v1/admin/settings/schedule', 'org2owner', org2Schedule).expect(200);

      expect((await get('/v1/admin/settings/schedule', 'org2owner').expect(200)).body.schedule).toEqual(org2Schedule);
      expect((await get('/v1/admin/settings/schedule', 'owner').expect(200)).body.schedule).toEqual(FOUNDER_SCHEDULE);

      await prisma.organization.update({ where: { id: ORG2 }, data: { settings: {} } });
    });
  });

  // ══════════════ the loop closes: a chosen slot reaches the RouteStop the driver runs ══════════════

  describe('the chosen slot reaches RouteStop.timeWindow (Inc-28 inherit-on-create)', () => {
    /** Book through the real endpoint, using a window the availability endpoint actually offered. */
    const bookWithSlot = async (slot: PickupSlot | null): Promise<string> => {
      const body = {
        accountId: A.acct,
        siteId: A.site,
        ...(slot ? { pickupWindow: { start: slot.start, end: slot.end } } : {}),
        items: [{ kind: 'RUG', serviceId: SEEDED_SERVICE, estimatedMeasure: 40 }],
      };
      return (await post('/v1/orders', 'custA', body).expect(201)).body.id as string;
    };

    /** `Route` carries no free-text column, so teardown tracks the ids this spec created. */
    const newRoute = async (): Promise<string> => {
      const id = (await post('/v1/routes', 'dispatcher', { date: stableFutureDate() }).expect(201)).body.id as string;
      createdRouteIds.push(id);
      return id;
    };

    it('a stop added with NO explicit window inherits the window the customer picked', async () => {
      const date = stableFutureDate();
      const offered = byLabel(await slots('custA', `?date=${date}`), 'Afternoon');
      expect(offered.available).toBe(true);

      const orderId = await bookWithSlot(offered);
      // The order stored exactly what was offered.
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.scheduledPickupWindow).toEqual({ start: offered.start, end: offered.end });

      const routeId = await newRoute();
      const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;

      // …and so did the stop the driver will actually run. Before Inc-28 this was null.
      expect(stop.timeWindow).toEqual({ start: offered.start, end: offered.end });
    });

    it("an explicit dispatcher window still wins — it's the newer fact", async () => {
      const date = stableFutureDate();
      const day = await slots('custA', `?date=${date}`);
      const orderId = await bookWithSlot(byLabel(day, 'Morning'));
      const moved = byLabel(day, 'Evening');

      const routeId = await newRoute();
      const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId, timeWindow: { start: moved.start, end: moved.end } }).expect(201)).body;
      expect(stop.timeWindow).toEqual({ start: moved.start, end: moved.end });
    });

    it('an order booked WITHOUT a window leaves the stop windowless (no window is invented)', async () => {
      const orderId = await bookWithSlot(null);
      const routeId = await newRoute();
      const stop = (await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId }).expect(201)).body;
      expect(stop.timeWindow).toBeNull();
    });

    it('the inherited window is what the optimizer sorts by (earliest window first, ahead of distance)', async () => {
      const date = stableFutureDate();
      const day = await slots('custA', `?date=${date}`);
      // Book the LATER window first, so input order and window order disagree.
      const later = await bookWithSlot(byLabel(day, 'Evening'));
      const earlier = await bookWithSlot(byLabel(day, 'Morning'));

      const routeId = await newRoute();
      await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId: later }).expect(201);
      await post(`/v1/routes/${routeId}/stops`, 'dispatcher', { orderId: earlier }).expect(201);

      const optimized = (await post(`/v1/routes/${routeId}/optimize`, 'dispatcher', {}).expect(200)).body;
      expect(optimized.stops.map((s: { orderId: string }) => s.orderId)).toEqual([earlier, later]);
    });
  });
});
