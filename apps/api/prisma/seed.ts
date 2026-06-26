/**
 * Blue Bee — Phase-1 demo seed (PRD §10.5 "seeded demo tenant").
 *
 * Inserts ONE honest, clearly-labelled demo specialty job and walks it through a
 * LEGAL §5.1 lifecycle path (validated by `canTransitionOrder` from
 * @blue-bee/shared), writing real CustodyEvents + AuditLog rows at each step.
 *
 * Idempotent: if the demo org already exists the seed is a no-op (re-runnable;
 * also avoids the append-only triggers on CustodyEvent/AuditLog).
 *
 * No fabricated capacity, counts, or certifications (honesty firewall, CLAUDE.md).
 */
import { PrismaClient } from '@prisma/client';
import {
  AccountType,
  BillingMode,
  CustodyStage,
  ItemKind,
  ItemStatus,
  OrderStatus,
  OrderType,
  OrderVertical,
  PhotoKind,
  QuoteStatus,
  RoleScope,
  RoleType,
  RouteStatus,
  RouteStopHandoff,
  RouteStopKind,
  RouteStopStatus,
  ServiceUnit,
  ServiceVertical,
  StandingOrderCadence,
  TagBinding,
  TagType,
  UserStatus,
  canTransitionOrder,
} from '@blue-bee/shared';

const prisma = new PrismaClient();

// Fixed demo UUIDs so the seed is idempotent.
const ID = {
  org: '11111111-1111-4111-8111-111111111111',
  owner: '22222222-2222-4222-8222-222222222222',
  role: '33333333-3333-4333-8333-333333333333',
  account: '44444444-4444-4444-8444-444444444444',
  site: '55555555-5555-4555-8555-555555555555',
  service: '66666666-6666-4666-8666-666666666666',
  order: '77777777-7777-4777-8777-777777777777',
  line: '88888888-8888-4888-8888-888888888888',
  tag: '99999999-9999-4999-8999-999999999999',
  item: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  inspection: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  photo: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  quote: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  priceListDefault: 'f0000000-0000-4000-8000-000000000001',
  priceListItemDefault: 'f0000000-0000-4000-8000-000000000002',
  // Increment 4 — extra Account-A sites with distinct GTA geo so the route sequencer has
  // real, distinct PostGIS points to order. (id, lng, lat)
  siteNorth: 'f1000000-0000-4000-8000-000000000001', // North York
  siteEast: 'f1000000-0000-4000-8000-000000000002', // Scarborough
  siteWest: 'f1000000-0000-4000-8000-000000000003', // Etobicoke
  driverUser2: 'f1000000-0000-4000-8000-000000000010', // 2nd driver (for stop-reassign tests)
  driverRole2: 'f1000000-0000-4000-8000-000000000011',
} as const;

// Distinct GTA coordinates (WGS84 lng/lat) for the sequencer fixtures.
const GTA_SITES = [
  { id: ID.siteNorth, name: 'Demo — North York site', lng: -79.4111, lat: 43.7615 },
  { id: ID.siteEast, name: 'Demo — Scarborough site', lng: -79.2318, lat: 43.7731 },
  { id: ID.siteWest, name: 'Demo — Etobicoke site', lng: -79.5435, lat: 43.6205 },
];

// Toronto City Hall — a real GTA coordinate for the demo site (WGS84 lng/lat).
const SITE_LNG = -79.3839;
const SITE_LAT = 43.6534;

// The legal §5.1 walk this demo order takes.
const LIFECYCLE_PATH: OrderStatus[] = [
  OrderStatus.REQUESTED,
  OrderStatus.SCHEDULED_PICKUP,
  OrderStatus.PICKUP_EN_ROUTE,
  OrderStatus.PICKED_UP,
  OrderStatus.INTAKE_INSPECTED,
  OrderStatus.QUOTED,
];

async function seedDemoOrder(): Promise<void> {
  const existing = await prisma.organization.findUnique({ where: { id: ID.org } });
  if (existing) {
    console.log(`[seed] Demo org ${ID.org} already present — skipping demo-order phase (idempotent).`);
    return;
  }

  // Assert the planned lifecycle walk is legal per §5.1 BEFORE touching the DB.
  for (let i = 0; i < LIFECYCLE_PATH.length - 1; i++) {
    const from = LIFECYCLE_PATH[i];
    const to = LIFECYCLE_PATH[i + 1];
    if (!canTransitionOrder(from, to)) {
      throw new Error(`Illegal lifecycle transition in seed path: ${from} -> ${to}`);
    }
  }

  const now = new Date();
  const at = (minutes: number): Date => new Date(now.getTime() + minutes * 60_000);

  await prisma.$transaction(
    async (tx) => {
      // ── Organization (tenant root; org_id == id) ──
      await tx.organization.create({
        data: {
          id: ID.org,
          orgId: ID.org,
          name: 'Blue Bee (demo operating org)',
          settings: { region: 'GTA', currency: 'CAD', tz: 'America/Toronto' },
          billingConfig: { taxRate: 0.13, taxLabel: 'HST (Ontario)' },
        },
      });

      // ── Owner user + OWNER role ──
      await tx.user.create({
        data: {
          id: ID.owner,
          orgId: ID.org,
          name: 'Demo Owner',
          email: 'owner@bluebee.example',
          phone: '+14160000000',
          authProviders: ['email'],
          status: UserStatus.ACTIVE,
        },
      });
      await tx.userRole.create({
        data: {
          id: ID.role,
          orgId: ID.org,
          userId: ID.owner,
          role: RoleType.OWNER,
          scope: RoleScope.ORG,
          createdBy: ID.owner,
        },
      });

      // ── Residential account + site (PostGIS point set via raw SQL) ──
      await tx.account.create({
        data: {
          id: ID.account,
          orgId: ID.org,
          type: AccountType.RESIDENTIAL,
          name: 'Demo — Rita (residential specialty customer)',
          createdBy: ID.owner,
        },
      });
      await tx.site.create({
        data: {
          id: ID.site,
          orgId: ID.org,
          accountId: ID.account,
          name: 'Demo residence',
          address: '100 Queen St W, Toronto, ON',
          serviceWindows: [{ day: 'MON', start: '09:00', end: '17:00' }],
          createdBy: ID.owner,
        },
      });
      // Set the geography(Point,4326) column (Unsupported in Prisma → raw SQL).
      await tx.$executeRaw`
        UPDATE "Site"
        SET geo = ST_SetSRID(ST_MakePoint(${SITE_LNG}, ${SITE_LAT}), 4326)::geography
        WHERE id = ${ID.site}::uuid
      `;

      // ── Catalog service for the specialty line ──
      await tx.service.create({
        data: {
          id: ID.service,
          orgId: ID.org,
          vertical: ServiceVertical.SPECIALTY,
          name: 'Area rug hand-wash (wool)',
          unit: ServiceUnit.SQFT,
          baseRate: '6.5000',
          createdBy: ID.owner,
        },
      });

      // ── Order at REQUESTED, then a tag + item ──
      await tx.order.create({
        data: {
          id: ID.order,
          orgId: ID.org,
          accountId: ID.account,
          siteId: ID.site,
          vertical: OrderVertical.SPECIALTY,
          type: OrderType.JOB,
          status: OrderStatus.REQUESTED,
          scheduledPickupWindow: { start: at(60).toISOString(), end: at(180).toISOString() },
          totals: { subtotal: '260.00', tax: '33.80', total: '293.80', currency: 'CAD' },
          createdBy: ID.owner,
        },
      });
      await tx.orderLine.create({
        data: {
          id: ID.line,
          orgId: ID.org,
          orderId: ID.order,
          serviceId: ID.service,
          qty: 1,
          measure: 40, // 5ft x 8ft = 40 sq ft
          rate: '6.5000',
          amount: '260.00',
          createdBy: ID.owner,
        },
      });
      await tx.tag.create({
        data: {
          id: ID.tag,
          orgId: ID.org,
          code: 'BB-DEMO-RUG-0001',
          type: TagType.QR,
          boundTo: TagBinding.ITEM,
          active: true,
          createdBy: ID.owner,
        },
      });
      await tx.item.create({
        data: {
          id: ID.item,
          orgId: ID.org,
          orderId: ID.order,
          tagId: ID.tag,
          kind: ItemKind.RUG,
          status: ItemStatus.RECEIVED,
          measurements: { widthFt: 5, lengthFt: 8, sqft: 40, fiber: 'wool' },
          createdBy: ID.owner,
        },
      });

      // ── Walk the legal §5.1 path, writing real audit + custody evidence ──
      let current = OrderStatus.REQUESTED;
      for (let i = 1; i < LIFECYCLE_PATH.length; i++) {
        const next = LIFECYCLE_PATH[i];
        // (Re)assert legality at apply-time too — defence in depth.
        if (!canTransitionOrder(current, next)) {
          throw new Error(`Illegal transition at apply: ${current} -> ${next}`);
        }
        await tx.order.update({ where: { id: ID.order }, data: { status: next } });
        await tx.auditLog.create({
          data: {
            orgId: ID.org,
            actorId: ID.owner,
            entity: 'Order',
            entityId: ID.order,
            action: 'STATUS_TRANSITION',
            before: { status: current },
            after: { status: next },
            at: at(i),
            createdBy: ID.owner,
          },
        });

        if (next === OrderStatus.PICKED_UP) {
          await tx.item.update({ where: { id: ID.item }, data: { status: ItemStatus.RECEIVED } });
          await tx.custodyEvent.create({
            data: {
              orgId: ID.org,
              itemId: ID.item,
              stage: CustodyStage.PICKED_UP,
              actorId: ID.owner,
              deviceId: 'demo-driver-device',
              occurredAt: at(i),
              createdBy: ID.owner,
            },
          });
        }

        if (next === OrderStatus.INTAKE_INSPECTED) {
          await tx.custodyEvent.create({
            data: {
              orgId: ID.org,
              itemId: ID.item,
              stage: CustodyStage.INTAKE,
              actorId: ID.owner,
              deviceId: 'demo-plant-station',
              occurredAt: at(i),
              createdBy: ID.owner,
            },
          });
          await tx.inspection.create({
            data: {
              id: ID.inspection,
              orgId: ID.org,
              itemId: ID.item,
              conditionCodes: ['MINOR_FRINGE_WEAR'],
              notes: 'Demo seed — pre-service condition recorded at intake.',
              preexistingDamage: false,
              ackBy: ID.owner,
              ackAt: at(i),
              createdBy: ID.owner,
            },
          });
          await tx.photo.create({
            data: {
              id: ID.photo,
              orgId: ID.org,
              itemId: ID.item,
              kind: PhotoKind.INTAKE,
              url: 'https://demo.local/intake/bb-demo-rug-0001-front.jpg',
              takenAt: at(i),
              createdBy: ID.owner,
            },
          });
          await tx.custodyEvent.create({
            data: {
              orgId: ID.org,
              itemId: ID.item,
              stage: CustodyStage.INSPECTED,
              actorId: ID.owner,
              deviceId: 'demo-plant-station',
              occurredAt: at(i),
              createdBy: ID.owner,
            },
          });
          await tx.item.update({ where: { id: ID.item }, data: { status: ItemStatus.INSPECTED } });
        }

        if (next === OrderStatus.QUOTED) {
          await tx.quote.create({
            data: {
              id: ID.quote,
              orgId: ID.org,
              orderId: ID.order,
              lines: [
                {
                  description: 'Area rug hand-wash (wool)',
                  measure: 40,
                  unit: 'SQFT',
                  rate: 6.5,
                  amount: 260.0,
                },
              ],
              subtotal: '260.00',
              tax: '33.80',
              total: '293.80',
              status: QuoteStatus.SENT,
              expiresAt: at(60 * 24 * 14), // +14 days
              createdBy: ID.owner,
            },
          });
        }

        current = next;
      }
    },
    { timeout: 30_000 },
  );

  console.log('[seed] Done. Demo specialty order seeded at status QUOTED:');
  console.log(`        org=${ID.org} account=${ID.account} site=${ID.site} order=${ID.order}`);
}

// ─────────────────────── Increment 2 — auth/RBAC fixtures (idempotent upserts) ───────────────────────
// Two isolation boundaries so scoping is provable:
//   • Org 1 (ID.org): staff (org-wide roles) + Account A (residential, Rita) + Account B (business).
//   • Org 2: its own owner + account + order — Org 1 staff must never see it.
const ID2 = {
  org2: 'e0000000-0000-4000-8000-000000000002',
  accountB: 'e0000000-0000-4000-8000-0000000000b0', // business account under Org 1
  org2Account: 'e0000000-0000-4000-8000-0000000000c0', // account under Org 2
  orderB: 'e0000000-0000-4000-8000-0000000000b1', // Org1 / Account B order
  orderO2: 'e0000000-0000-4000-8000-0000000000c1', // Org2 order
  priceListB: 'f0000000-0000-4000-8000-000000000003', // Account B rate card (override)
  priceListItemB: 'f0000000-0000-4000-8000-000000000004',
} as const;

interface Fixture {
  uid: string;
  rid: string;
  name: string;
  phone: string;
  email: string;
  orgId: string;
  role: RoleType;
  scope: RoleScope;
  scopeId: string | null;
}

async function seedAuthFixtures(): Promise<void> {
  // Account B (business) under Org 1, plus Org 2 with its own account — scoping targets.
  await prisma.account.upsert({
    where: { id: ID2.accountB },
    update: {},
    create: { id: ID2.accountB, orgId: ID.org, type: AccountType.BUSINESS, name: 'Demo — Account B (business)', createdBy: ID.owner },
  });
  await prisma.organization.upsert({
    where: { id: ID2.org2 },
    update: {},
    create: {
      id: ID2.org2,
      orgId: ID2.org2,
      name: 'Blue Bee — Demo Org 2 (isolation test)',
      settings: { region: 'GTA', currency: 'CAD' },
    },
  });
  await prisma.account.upsert({
    where: { id: ID2.org2Account },
    update: {},
    create: { id: ID2.org2Account, orgId: ID2.org2, type: AccountType.BUSINESS, name: 'Demo — Org 2 Account' },
  });

  // Cross-tenant orders (no custody/append-only rows — pure scoping targets).
  await prisma.order.upsert({
    where: { id: ID2.orderB },
    update: {},
    create: {
      id: ID2.orderB,
      orgId: ID.org,
      accountId: ID2.accountB,
      vertical: OrderVertical.SPECIALTY,
      type: OrderType.JOB,
      status: OrderStatus.REQUESTED,
      totals: { note: 'Account B scoping target' },
      createdBy: ID.owner,
    },
  });
  await prisma.order.upsert({
    where: { id: ID2.orderO2 },
    update: {},
    create: {
      id: ID2.orderO2,
      orgId: ID2.org2,
      accountId: ID2.org2Account,
      vertical: OrderVertical.SPECIALTY,
      type: OrderType.JOB,
      status: OrderStatus.REQUESTED,
      totals: { note: 'Org 2 scoping target' },
    },
  });

  // Give the Increment-1 owner a clean phone for OTP login.
  await prisma.user.update({ where: { id: ID.owner }, data: { phone: '+14165550001', authProviders: ['phone'] } });

  const fixtures: Fixture[] = [
    { uid: 'e1000000-0000-4000-8000-000000000001', rid: 'e2000000-0000-4000-8000-000000000001', name: 'Demo Dispatcher', phone: '+14165550002', email: 'dispatcher@bluebee.example', orgId: ID.org, role: RoleType.DISPATCHER, scope: RoleScope.ORG, scopeId: null },
    { uid: 'e1000000-0000-4000-8000-000000000002', rid: 'e2000000-0000-4000-8000-000000000002', name: 'Demo CSR', phone: '+14165550003', email: 'csr@bluebee.example', orgId: ID.org, role: RoleType.CSR, scope: RoleScope.ORG, scopeId: null },
    { uid: 'e1000000-0000-4000-8000-000000000003', rid: 'e2000000-0000-4000-8000-000000000003', name: 'Demo Plant Operator', phone: '+14165550004', email: 'plant@bluebee.example', orgId: ID.org, role: RoleType.PLANT_OP, scope: RoleScope.ORG, scopeId: null },
    { uid: 'e1000000-0000-4000-8000-000000000004', rid: 'e2000000-0000-4000-8000-000000000004', name: 'Demo Finance', phone: '+14165550005', email: 'finance@bluebee.example', orgId: ID.org, role: RoleType.FINANCE, scope: RoleScope.ORG, scopeId: null },
    { uid: 'e1000000-0000-4000-8000-000000000005', rid: 'e2000000-0000-4000-8000-000000000005', name: 'Demo Driver', phone: '+14165550006', email: 'driver@bluebee.example', orgId: ID.org, role: RoleType.DRIVER, scope: RoleScope.ORG, scopeId: null },
    { uid: 'e1000000-0000-4000-8000-000000000006', rid: 'e2000000-0000-4000-8000-000000000006', name: 'Demo Rita (residential)', phone: '+14165550010', email: 'rita@example.com', orgId: ID.org, role: RoleType.RESIDENTIAL_CUSTOMER, scope: RoleScope.ACCOUNT, scopeId: ID.account },
    { uid: 'e1000000-0000-4000-8000-000000000007', rid: 'e2000000-0000-4000-8000-000000000007', name: 'Demo Account-B Admin', phone: '+14165550020', email: 'admin@account-b.example', orgId: ID.org, role: RoleType.ACCOUNT_ADMIN, scope: RoleScope.ACCOUNT, scopeId: ID2.accountB },
    { uid: 'e1000000-0000-4000-8000-000000000008', rid: 'e2000000-0000-4000-8000-000000000008', name: 'Demo Account-B Staff', phone: '+14165550021', email: 'staff@account-b.example', orgId: ID.org, role: RoleType.ACCOUNT_STAFF, scope: RoleScope.ACCOUNT, scopeId: ID2.accountB },
    { uid: 'e1000000-0000-4000-8000-000000000009', rid: 'e2000000-0000-4000-8000-000000000009', name: 'Demo Org-2 Owner', phone: '+14165559001', email: 'owner@org2.example', orgId: ID2.org2, role: RoleType.OWNER, scope: RoleScope.ORG, scopeId: null },
  ];

  for (const f of fixtures) {
    await prisma.user.upsert({
      where: { id: f.uid },
      update: { phone: f.phone, name: f.name },
      create: { id: f.uid, orgId: f.orgId, name: f.name, phone: f.phone, email: f.email, authProviders: ['phone'], status: UserStatus.ACTIVE, createdBy: ID.owner },
    });
    await prisma.userRole.upsert({
      where: { id: f.rid },
      update: {},
      create: { id: f.rid, orgId: f.orgId, userId: f.uid, role: f.role, scope: f.scope, scopeId: f.scopeId, createdBy: ID.owner },
    });
  }

  console.log(`[seed] Auth fixtures ready: ${fixtures.length + 1} role users across Org1 (Accounts A+B) and Org2.`);
  console.log('       Login phones — OWNER:+14165550001 DISPATCHER:+14165550002 CSR:+14165550003 PLANT:+14165550004');
  console.log('                      FINANCE:+14165550005 DRIVER:+14165550006 RITA(resident):+14165550010');
  console.log('                      ACCT_B_ADMIN:+14165550020 ACCT_B_STAFF:+14165550021 ORG2_OWNER:+14165559001');
}

// ─────────────────────── Increment 3 — pricing fixtures (per-account override proof) ───────────────────────
// Default org rate card (base) + an Account-B rate card whose account_override supersedes
// it, so the quote engine's resolution order (override → list → service base) is provable.
async function seedPricing(): Promise<void> {
  await prisma.priceList.upsert({
    where: { id: ID.priceListDefault },
    update: {},
    create: { id: ID.priceListDefault, orgId: ID.org, name: 'Org default rate card', accountId: null, active: true, createdBy: ID.owner },
  });
  await prisma.priceListItem.upsert({
    where: { id: ID.priceListItemDefault },
    update: { rate: '6.5000', accountOverride: null },
    create: { id: ID.priceListItemDefault, orgId: ID.org, priceListId: ID.priceListDefault, serviceId: ID.service, rate: '6.5000', createdBy: ID.owner },
  });

  await prisma.priceList.upsert({
    where: { id: ID2.priceListB },
    update: {},
    create: { id: ID2.priceListB, orgId: ID.org, name: 'Account B rate card', accountId: ID2.accountB, active: true, createdBy: ID.owner },
  });
  await prisma.priceListItem.upsert({
    where: { id: ID2.priceListItemB },
    update: { rate: '6.5000', accountOverride: '5.0000' },
    create: { id: ID2.priceListItemB, orgId: ID.org, priceListId: ID2.priceListB, serviceId: ID.service, rate: '6.5000', accountOverride: '5.0000', createdBy: ID.owner },
  });

  console.log('[seed] Pricing ready: org default rate $6.50/sqft; Account B override $5.00/sqft (override → list → base).');
}

// ─────────────────────── Increment 4 — logistics fixtures ───────────────────────
// 3 Account-A sites with distinct GTA geo (sequencer), and a 2nd driver-capable user
// (stop reassignment). Vehicles/drivers/shifts/routes themselves are created via the API
// in the e2e to exercise those endpoints.
async function seedLogistics(): Promise<void> {
  for (const s of GTA_SITES) {
    await prisma.site.upsert({
      where: { id: s.id },
      update: {},
      create: { id: s.id, orgId: ID.org, accountId: ID.account, name: s.name, createdBy: ID.owner },
    });
    await prisma.$executeRaw`
      UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326)::geography
      WHERE id = ${s.id}::uuid`;
  }

  await prisma.user.upsert({
    where: { id: ID.driverUser2 },
    update: { phone: '+14165550007', name: 'Demo Driver 2' },
    create: { id: ID.driverUser2, orgId: ID.org, name: 'Demo Driver 2', phone: '+14165550007', email: 'driver2@bluebee.example', authProviders: ['phone'], status: UserStatus.ACTIVE, createdBy: ID.owner },
  });
  await prisma.userRole.upsert({
    where: { id: ID.driverRole2 },
    update: {},
    create: { id: ID.driverRole2, orgId: ID.org, userId: ID.driverUser2, role: RoleType.DRIVER, scope: RoleScope.ORG, scopeId: null, createdBy: ID.owner },
  });

  console.log('[seed] Logistics ready: 3 Account-A geo sites (N/E/W) + a 2nd driver user (+14165550007).');
}

// ─────────────────────── Track A (condo B2B) — standing orders + billing terms + a realistic completed route ───────────────────────
// One cohesive, clearly-labelled honest demo for the Track-A thin slice:
//   • Account B (business) becomes a condo building account: a downtown condo Site, BATCH_PERIODIC
//     billing terms (net-30), a LINEN amenity Service, and a WEEKLY-Monday StandingOrder with a
//     CONCIERGE/lobby handoff (so `POST /v1/standing-orders/run` immediately materializes real Orders).
//   • Four DELIVERED route-stop orders (with totals) so the batch-invoicing path has billable orders.
//   • A COMPLETED demo route whose stops carry DISTINCT, realistic arrivedAt/completedAt (12–23 min
//     on-site, spaced across a morning). THIS IS THE SEED-FIX for the Inc-15 "195,652" anomaly: the
//     analytics stops/hour = COMPLETED stops ÷ Σ(lastCompleted−firstArrived); API-completed stops sit
//     milliseconds apart (server-stamped back-to-back), collapsing that denominator → a degenerate
//     blow-up. A freshly-seeded demo tenant now has a real route with sane on-site spans, so
//     stops/hour and avg-dwell compute to sane values at the data source.
const A6 = {
  condoSite: 'a6000000-0000-4000-8000-000000000001',
  linenService: 'a6000000-0000-4000-8000-000000000002',
  standingOrder: 'a6000000-0000-4000-8000-000000000003',
  route: 'a6000000-0000-4000-8000-000000000010',
  orders: [
    'a6000000-0000-4000-8000-000000000101',
    'a6000000-0000-4000-8000-000000000102',
    'a6000000-0000-4000-8000-000000000103',
    'a6000000-0000-4000-8000-000000000104',
  ],
  stops: [
    'a6000000-0000-4000-8000-000000000201',
    'a6000000-0000-4000-8000-000000000202',
    'a6000000-0000-4000-8000-000000000203',
    'a6000000-0000-4000-8000-000000000204',
  ],
  // Two real amenity-linen items on the CONCIERGE pickup order + its load-sheet manifest (so the B2B
  // portal's Manifests tab renders a REAL snapshot, not a fabricated one).
  items: ['a6000000-0000-4000-8000-000000000301', 'a6000000-0000-4000-8000-000000000302'],
  tags: ['a6000000-0000-4000-8000-000000000311', 'a6000000-0000-4000-8000-000000000312'],
  manifest: 'a6000000-0000-4000-8000-000000000401',
} as const;

// CityPlace (downtown Toronto) condo — a real GTA coordinate for the demo condo building.
const CONDO_LNG = -79.3925;
const CONDO_LAT = 43.641;

async function seedTrackADemo(): Promise<void> {
  // Condo building Site under Account B (business). Upsert + set its PostGIS point.
  await prisma.site.upsert({
    where: { id: A6.condoSite },
    update: {},
    create: {
      id: A6.condoSite,
      orgId: ID.org,
      accountId: ID2.accountB,
      name: 'Demo — Harbourview Condos (B2B building)',
      address: '10 CityPlace Dr, Toronto, ON',
      serviceWindows: [{ day: 'MON', start: '07:00', end: '09:00' }],
      createdBy: ID.owner,
    },
  });
  await prisma.$executeRaw`
    UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${CONDO_LNG}, ${CONDO_LAT}), 4326)::geography
    WHERE id = ${A6.condoSite}::uuid`;

  // Account B billing terms → BATCH_PERIODIC (net-30) for the periodic-invoice demo.
  await prisma.account.update({
    where: { id: ID2.accountB },
    data: { billingMode: BillingMode.BATCH_PERIODIC, billingNetDays: 30 },
  });

  // Amenity LINEN service for the building.
  await prisma.service.upsert({
    where: { id: A6.linenService },
    update: {},
    create: {
      id: A6.linenService,
      orgId: ID.org,
      vertical: ServiceVertical.LINEN,
      name: 'Amenity linen (gym/pool) — per piece',
      unit: ServiceUnit.PIECE,
      baseRate: '1.2500',
      createdBy: ID.owner,
    },
  });

  // WEEKLY-Monday standing order with a CONCIERGE/lobby handoff. startsOn 2026-06-01 (a Monday) so a
  // `run` at any later date materializes real Orders. Generation is driven by the job/API — NOT faked.
  await prisma.standingOrder.upsert({
    where: { id: A6.standingOrder },
    update: {},
    create: {
      id: A6.standingOrder,
      orgId: ID.org,
      accountId: ID2.accountB,
      siteId: A6.condoSite,
      serviceId: A6.linenService,
      vertical: OrderVertical.LINEN,
      cadence: StandingOrderCadence.WEEKLY,
      weekday: 1, // Monday
      pickupWindow: { start: '07:00', end: '09:00' },
      concierge: true,
      active: true,
      startsOn: new Date('2026-06-01T00:00:00.000Z'),
      nextRunAt: new Date('2026-06-29T00:00:00.000Z'),
      createdBy: ID.owner,
    },
  });

  // Idempotency guard for the heavier order/route/stop block (no upsert on createMany of the route).
  const existingRoute = await prisma.route.findUnique({ where: { id: A6.route } });
  if (existingRoute) {
    console.log('[seed] Track-A demo already present — skipping completed-route phase (idempotent).');
    console.log(`[seed] Track-A ready: condo standing order ${A6.standingOrder} (WEEKLY Mon, CONCIERGE), Account B = BATCH_PERIODIC net-30.`);
    return;
  }

  // Four DELIVERED route-stop orders for the condo (createdAt in June 2026) — billable (totals set), so
  // the batch-invoicing path has real orders to batch into ONE periodic invoice.
  const ORDER_MONEY = [
    { subtotal: '120.00', tax: '15.60', total: '135.60' },
    { subtotal: '95.00', tax: '12.35', total: '107.35' },
    { subtotal: '140.00', tax: '18.20', total: '158.20' },
    { subtotal: '110.00', tax: '14.30', total: '124.30' },
  ];
  await prisma.order.createMany({
    data: A6.orders.map((id, i) => ({
      id,
      orgId: ID.org,
      accountId: ID2.accountB,
      siteId: A6.condoSite,
      vertical: OrderVertical.LINEN,
      type: OrderType.ROUTE_STOP_ORDER,
      status: OrderStatus.DELIVERED,
      totals: { ...ORDER_MONEY[i], currency: 'CAD' },
      createdAt: new Date('2026-06-24T07:00:00.000Z'),
      createdBy: ID.owner,
    })),
    skipDuplicates: true,
  });

  // A COMPLETED demo route on 2026-06-24 with DISTINCT, realistic on-site spans (the seed-fix). Stop 1 is
  // the CONCIERGE/lobby handoff; the rest are deliveries at the three GTA sites. Each stop has a time
  // window so on-time% also computes. firstArrived 07:35 → lastCompleted 10:22 ⇒ ~2.78h, 4 stops ⇒
  // ~1.44 stops/hour; dwell avg (23+15+15+12)/4 = 16.25 min — both SANE (no 195,652 blow-up).
  await prisma.route.create({
    data: {
      id: A6.route,
      orgId: ID.org,
      date: new Date('2026-06-24T00:00:00.000Z'),
      status: RouteStatus.COMPLETED,
      optimized: true,
      createdAt: new Date('2026-06-24T06:30:00.000Z'),
      createdBy: ID.owner,
    },
  });
  const at = (iso: string): Date => new Date(iso);
  const STOPS = [
    { kind: RouteStopKind.PICKUP, stopKind: RouteStopHandoff.CONCIERGE, siteId: A6.condoSite, win: ['07:00', '08:00'], arr: '07:35', done: '07:58' },
    { kind: RouteStopKind.DELIVERY, stopKind: RouteStopHandoff.DIRECT, siteId: ID.siteNorth, win: ['08:30', '09:00'], arr: '08:40', done: '08:55' },
    { kind: RouteStopKind.DELIVERY, stopKind: RouteStopHandoff.DIRECT, siteId: ID.siteEast, win: ['09:15', '09:45'], arr: '09:25', done: '09:40' },
    { kind: RouteStopKind.DELIVERY, stopKind: RouteStopHandoff.DIRECT, siteId: ID.siteWest, win: ['10:00', '10:30'], arr: '10:10', done: '10:22' },
  ];
  await prisma.routeStop.createMany({
    data: STOPS.map((s, i) => ({
      id: A6.stops[i],
      orgId: ID.org,
      routeId: A6.route,
      seq: i + 1,
      accountId: ID2.accountB,
      siteId: s.siteId,
      orderId: A6.orders[i],
      kind: s.kind,
      stopKind: s.stopKind,
      timeWindow: { start: at(`2026-06-24T${s.win[0]}:00Z`).toISOString(), end: at(`2026-06-24T${s.win[1]}:00Z`).toISOString() },
      status: RouteStopStatus.COMPLETED,
      arrivedAt: at(`2026-06-24T${s.arr}:00Z`),
      completedAt: at(`2026-06-24T${s.done}:00Z`),
      createdBy: ID.owner,
    })),
    skipDuplicates: true,
  });

  // Two REAL amenity-linen items on the CONCIERGE pickup order (stop 1) + the load-sheet Manifest for
  // that stop — exactly what ManifestService.generateForStop snapshots. This gives the B2B portal's
  // Manifests tab a real (non-fabricated) row to show; no schema change, additive seed data.
  await prisma.tag.createMany({
    data: [
      { id: A6.tags[0], orgId: ID.org, code: 'BB-AMENITY-01', type: TagType.QR, boundTo: TagBinding.ITEM, active: true, createdBy: ID.owner },
      { id: A6.tags[1], orgId: ID.org, code: 'BB-AMENITY-02', type: TagType.QR, boundTo: TagBinding.ITEM, active: true, createdBy: ID.owner },
    ],
    skipDuplicates: true,
  });
  await prisma.item.createMany({
    data: [
      { id: A6.items[0], orgId: ID.org, orderId: A6.orders[0], tagId: A6.tags[0], kind: ItemKind.LINEN, status: ItemStatus.RECEIVED, measurements: { pieces: 24 }, createdBy: ID.owner },
      { id: A6.items[1], orgId: ID.org, orderId: A6.orders[0], tagId: A6.tags[1], kind: ItemKind.LINEN, status: ItemStatus.RECEIVED, measurements: { pieces: 18 }, createdBy: ID.owner },
    ],
    skipDuplicates: true,
  });
  await prisma.manifest.create({
    data: {
      id: A6.manifest,
      orgId: ID.org,
      routeStopId: A6.stops[0], // a stop-level (pickup) manifest, like generateForStop
      lines: [
        {
          stopId: A6.stops[0],
          seq: 1,
          kind: RouteStopKind.PICKUP,
          orderId: A6.orders[0],
          account: { id: ID2.accountB, name: 'Demo — Account B (business)' },
          site: { id: A6.condoSite, name: 'Demo — Harbourview Condos (B2B building)', address: '10 CityPlace Dr, Toronto, ON' },
          expectedItems: [
            { itemId: A6.items[0], kind: ItemKind.LINEN, tagCode: 'BB-AMENITY-01', status: ItemStatus.RECEIVED },
            { itemId: A6.items[1], kind: ItemKind.LINEN, tagCode: 'BB-AMENITY-02', status: ItemStatus.RECEIVED },
          ],
          expectedItemCount: 2,
        },
      ],
      createdBy: ID.owner,
    },
  });

  console.log('[seed] Track-A ready: condo standing order (WEEKLY Mon, CONCIERGE); Account B = BATCH_PERIODIC net-30;');
  console.log('       4 DELIVERED condo orders + a COMPLETED route with realistic on-site spans (analytics stops/hour ~1.44, dwell ~16min);');
  console.log('       2 amenity-linen items + a load-sheet manifest on the CONCIERGE pickup (Manifests tab demo).');
}

async function main(): Promise<void> {
  await seedDemoOrder();
  await seedAuthFixtures();
  await seedPricing();
  await seedLogistics();
  await seedTrackADemo();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error('[seed] FAILED:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
