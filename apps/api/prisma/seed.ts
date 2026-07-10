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
import { PrismaClient, Prisma } from '@prisma/client';
import { seedDrycleanCatalog } from './seed-catalog';
import {
  AccountType,
  BillingMode,
  ClaimStatus,
  ClaimType,
  CostCenterKind,
  CustodyStage,
  GarmentStatus,
  InvoiceStatus,
  ItemKind,
  ItemStatus,
  LinenMovementType,
  LostFoundStatus,
  ManifestKind,
  PaymentMethod,
  PaymentStatus,
  ResidentStatus,
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
  ShiftStatus,
  StandingOrderCadence,
  TagBinding,
  TagType,
  UserStatus,
  VehicleStatus,
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
    // Memorable "type 1234567890" login into the demo org's dashboard (E.164 = +1 1234567890).
    // Pair with the OTP_DEV_BYPASS_CODE shortcut (e.g. 000000) for a no-SMS test login.
    { uid: 'e1000000-0000-4000-8000-000000000010', rid: 'e2000000-0000-4000-8000-000000000010', name: 'Demo Test Owner (simple login)', phone: '+11234567890', email: 'test-owner@bluebee.example', orgId: ID.org, role: RoleType.OWNER, scope: RoleScope.ORG, scopeId: null },
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
  console.log('       Simple test login — OWNER:+11234567890 (type 1234567890); use OTP_DEV_BYPASS_CODE (e.g. 000000) to skip SMS.');
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

// ─────────────────────── Track-B (care homes) — resident personal-clothing demo ───────────────────────
const B1 = {
  careHome: 'b0000000-0000-4000-8000-0000000000a0',
  site: 'b0000000-0000-4000-8000-0000000000a1',
  adminUid: 'e1000000-0000-4000-8000-000000000010',
  adminRid: 'e2000000-0000-4000-8000-000000000010',
  r1: 'b0000000-0000-4000-8000-0000000000b1',
  r2: 'b0000000-0000-4000-8000-0000000000b2',
  lostFound: 'b0000000-0000-4000-8000-0000000000f1',
} as const;

// Five REAL enrolled garments across the §5.2-B lifecycle (no fabricated states): two residents,
// one garment in lost & found. [id, tag, code, resident, status, description].
const B1_GARMENTS = [
  { id: 'b0000000-0000-4000-8000-0000000000c1', tag: 'b0000000-0000-4000-8000-0000000000d1', code: 'RES-204-01', resident: B1.r1, status: GarmentStatus.GARMENT_ENROLLED, desc: 'Blue knit cardigan' },
  { id: 'b0000000-0000-4000-8000-0000000000c2', tag: 'b0000000-0000-4000-8000-0000000000d2', code: 'RES-204-02', resident: B1.r1, status: GarmentStatus.WASH, desc: 'Floral day blouse' },
  { id: 'b0000000-0000-4000-8000-0000000000c3', tag: 'b0000000-0000-4000-8000-0000000000d3', code: 'RES-204-03', resident: B1.r1, status: GarmentStatus.DELIVERED_TO_RESIDENT, desc: 'Grey wool trousers' },
  { id: 'b0000000-0000-4000-8000-0000000000c4', tag: 'b0000000-0000-4000-8000-0000000000d4', code: 'RES-112-01', resident: B1.r2, status: GarmentStatus.GARMENT_ENROLLED, desc: 'Navy fleece sweater' },
  { id: 'b0000000-0000-4000-8000-0000000000c5', tag: 'b0000000-0000-4000-8000-0000000000d5', code: 'RES-LF-01', resident: B1.r2, status: GarmentStatus.LOST_FOUND_POOL, desc: 'Tartan wool scarf (unmatched on return sort)' },
] as const;

// The linear §5.2-B path; the lost-found branch leaves at RETURN_SORT. Used to seed a TRUTHFUL
// append-only custody trail (origin → current) for each garment, not a single hardcoded stage.
const GARMENT_LINEAR = [
  GarmentStatus.GARMENT_ENROLLED,
  GarmentStatus.SOIL_PICKUP,
  GarmentStatus.INTAKE_SORT,
  GarmentStatus.WASH,
  GarmentStatus.RETURN_SORT,
  GarmentStatus.DELIVERED_TO_RESIDENT,
];
function garmentPath(status: GarmentStatus): GarmentStatus[] {
  if (status === GarmentStatus.LOST_FOUND_POOL) return [...GARMENT_LINEAR.slice(0, 5), GarmentStatus.LOST_FOUND_POOL];
  const idx = GARMENT_LINEAR.indexOf(status);
  return idx >= 0 ? GARMENT_LINEAR.slice(0, idx + 1) : [GarmentStatus.GARMENT_ENROLLED];
}

async function seedTrackBDemo(): Promise<void> {
  // Care-home account + site (Org 1).
  await prisma.account.upsert({
    where: { id: B1.careHome },
    update: {},
    create: { id: B1.careHome, orgId: ID.org, type: AccountType.BUSINESS, name: 'Demo — Maple Grove Care Home', createdBy: ID.owner },
  });
  await prisma.site.upsert({
    where: { id: B1.site },
    update: {},
    create: { id: B1.site, orgId: ID.org, accountId: B1.careHome, name: 'Maple Grove — West Wing', address: '88 Elm St, Toronto, ON', createdBy: ID.owner },
  });

  // A care-home ACCOUNT_ADMIN scoped to THIS account — proves "the account's own staff, their site only".
  await prisma.user.upsert({
    where: { id: B1.adminUid },
    update: { phone: '+14165550030' },
    create: { id: B1.adminUid, orgId: ID.org, name: 'Demo Care-Home Admin', phone: '+14165550030', email: 'admin@maplegrove.example', authProviders: ['phone'], status: UserStatus.ACTIVE, createdBy: ID.owner },
  });
  await prisma.userRole.upsert({
    where: { id: B1.adminRid },
    update: {},
    create: { id: B1.adminRid, orgId: ID.org, userId: B1.adminUid, role: RoleType.ACCOUNT_ADMIN, scope: RoleScope.ACCOUNT, scopeId: B1.careHome, createdBy: ID.owner },
  });

  // Residents (PII — real demo names/rooms, clearly labelled "Demo").
  await prisma.resident.upsert({ where: { id: B1.r1 }, update: {}, create: { id: B1.r1, orgId: ID.org, siteId: B1.site, name: 'Demo — Eleanor Whitfield', room: '204', status: ResidentStatus.ACTIVE, createdBy: ID.owner } });
  await prisma.resident.upsert({ where: { id: B1.r2 }, update: {}, create: { id: B1.r2, orgId: ID.org, siteId: B1.site, name: 'Demo — Harold Banks', room: '112', status: ResidentStatus.ACTIVE, createdBy: ID.owner } });

  // Idempotency guard for the heavier garment/lost-found block.
  if (await prisma.item.findUnique({ where: { id: B1_GARMENTS[0].id } })) {
    console.log('[seed] Track-B demo already present — skipping garments (idempotent).');
    return;
  }

  // Resident-bound tags + the enrolled garments (real, at distinct lifecycle stages) + an opening custody event each.
  await prisma.tag.createMany({ data: B1_GARMENTS.map((g) => ({ id: g.tag, orgId: ID.org, code: g.code, type: TagType.QR, boundTo: TagBinding.RESIDENT, active: true, createdBy: ID.owner })), skipDuplicates: true });
  await prisma.item.createMany({ data: B1_GARMENTS.map((g) => ({ id: g.id, orgId: ID.org, residentId: g.resident, tagId: g.tag, kind: ItemKind.GARMENT, garmentStatus: g.status, measurements: { description: g.desc }, createdBy: ID.owner })), skipDuplicates: true });
  await prisma.custodyEvent.createMany({
    data: B1_GARMENTS.flatMap((g) => garmentPath(g.status).map((stage) => ({ orgId: ID.org, itemId: g.id, garmentStage: stage, actorId: ID.owner, createdBy: ID.owner }))),
  });

  // The odd garment is pooled — a real LostFoundItem (candidate = Harold, by room tag).
  const lf = B1_GARMENTS[4];
  await prisma.lostFoundItem.upsert({
    where: { id: B1.lostFound },
    update: {},
    create: { id: B1.lostFound, orgId: ID.org, siteId: B1.site, itemId: lf.id, tagId: lf.tag, candidateResidentId: lf.resident, status: LostFoundStatus.OPEN, notes: 'Unmatched on return sort — candidate by room tag', createdBy: ID.owner },
  });

  console.log('[seed] Track-B ready: care home Maple Grove (West Wing) — ACCOUNT_ADMIN +14165550030;');
  console.log('       2 residents, 5 enrolled garments across the §5.2-B lifecycle (enrolled/wash/delivered), 1 in lost & found.');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Branch 4 — rich, idempotent demo enrichment (additive; NO schema change — Branch 5 owns the
// cost-center migration). Goal: every reskinned premium screen renders FULL and realistic. Honesty
// firewall: every row is plainly labelled "Demo", and CAD amounts derive HST from the org tax rate
// (never hand-typed). Each block is guarded by an existence check (the standing idempotency pattern)
// so it is safe to run repeatedly AND on a fresh DB. Sectioned + commented so a Branch-5 merge of
// this file is trivial.
//
// Two hard constraints learned from the e2e suite (do not violate):
//   • Account B (Harbourview) is pinned by accounts-read.e2e to EXACTLY 1 site + 1 standing order —
//     so the multi-site condo is a NEW business account, not Account B.
//   • The seeded driver fixtures (+14165550006 / +14165550007) are claimed by tracking.e2e via
//     `ensureDriver` (Driver.userId is @unique) — so the live fleet uses NEW dedicated driver users.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const HST_RATE = 0.13; // Ontario HST — the ONE place the rate lives; every demo amount derives from it.
function cad(subtotal: number): { subtotal: string; tax: string; total: string; currency: string } {
  const tax = Math.round(subtotal * HST_RATE * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  return { subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: total.toFixed(2), currency: 'CAD' };
}

// Deterministic uuid builder per section prefix → readable, collision-free, idempotent ids.
const uuidIn = (prefix: string) => (n: number): string => `${prefix}-0000-4000-8000-${n.toString().padStart(12, '0')}`;

async function setSiteGeo(siteId: string, lng: number, lat: number): Promise<void> {
  await prisma.$executeRaw`UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography WHERE id = ${siteId}::uuid`;
}

// Raw, idempotent GpsPing insert — the geo column is PostGIS Unsupported (set via ST_MakePoint), so
// this mirrors GpsHistoryService.appendBatch EXACTLY incl. ON CONFLICT (vehicle_id, recorded_at).
interface SeedPing { id: string; shiftId: string; vehicleId: string; lng: number; lat: number; speed: number; heading: number; recordedAt: Date }
async function insertPings(rows: SeedPing[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map(
    (r) => Prisma.sql`(${r.id}::uuid, ${ID.org}::uuid, ${r.shiftId}::uuid, ${r.vehicleId}::uuid,
      ST_SetSRID(ST_MakePoint(${r.lng}, ${r.lat}), 4326)::geography, ${r.speed}, ${r.heading}, ${r.recordedAt}, now(), now(), ${ID.owner}::uuid)`,
  );
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "GpsPing" ("id","org_id","shift_id","vehicle_id","geo","speed","heading","recorded_at","created_at","updated_at","created_by")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("vehicle_id","recorded_at") DO NOTHING`);
}

// ─────────────────────── Branch 4 §A — condo multi-site B2B (NEW business account) ───────────────────────
// David's world (PRD persona §3.1: designer/property manager — multiple addresses, itemized → one invoice).
// A downtown waterfront condo portfolio: 3 towers (real GTA geo + service windows), BATCH_PERIODIC net-30,
// two standing orders (WEEKLY + BIWEEKLY, concierge handoff), a spread of amenity-linen orders across the
// §5.1 lifecycle, a COMPLETED run with a load-sheet manifest, and ONE periodic batch invoice (HST derived).
// Fills the B2B account console + portal Orders / Manifests tabs.
const cid = uuidIn('d1000000');
const CONDO_TOWERS = [
  { id: cid(11), name: 'Demo — Lakeshore Tower A (Harbourfront)', address: '8 York St, Toronto, ON', lng: -79.3787, lat: 43.642 },
  { id: cid(12), name: 'Demo — Lakeshore Tower B (Harbourfront)', address: '10 Yonge St, Toronto, ON', lng: -79.3772, lat: 43.6404 },
  { id: cid(13), name: 'Demo — Lakeshore Tower C (Harbourfront)', address: '65 Harbour Sq, Toronto, ON', lng: -79.3795, lat: 43.6395 },
];
const CONDO_ACCOUNT = cid(1);
const CONDO_ACCOUNT_NAME = 'Demo — Lakeshore Residences Property Mgmt (condo B2B)';

async function seedCondoMultiSite(): Promise<void> {
  await prisma.account.upsert({
    where: { id: CONDO_ACCOUNT },
    update: {},
    create: { id: CONDO_ACCOUNT, orgId: ID.org, type: AccountType.BUSINESS, name: CONDO_ACCOUNT_NAME, billingMode: BillingMode.BATCH_PERIODIC, billingNetDays: 30, createdBy: ID.owner },
  });

  // The condo property manager (PRD §3.1 "David") — an ACCOUNT_ADMIN confined to THIS account. Drives
  // the B2B self-serve invoice PORTAL demo: login → my invoices (incl. the per-tower split below) →
  // detail → Download PDF → Pay. Account-scoped, so they see ONLY Lakeshore's invoices (cross-account → 404).
  await prisma.user.upsert({
    where: { id: cid(91) },
    update: { phone: '+14165550022', name: 'Demo Lakeshore Property Mgr' },
    create: { id: cid(91), orgId: ID.org, name: 'Demo Lakeshore Property Mgr', phone: '+14165550022', email: 'david@lakeshore-pm.example', authProviders: ['phone'], status: UserStatus.ACTIVE, createdBy: ID.owner },
  });
  await prisma.userRole.upsert({
    where: { id: cid(92) },
    update: {},
    create: { id: cid(92), orgId: ID.org, userId: cid(91), role: RoleType.ACCOUNT_ADMIN, scope: RoleScope.ACCOUNT, scopeId: CONDO_ACCOUNT, createdBy: ID.owner },
  });
  for (const t of CONDO_TOWERS) {
    await prisma.site.upsert({
      where: { id: t.id },
      update: {},
      create: { id: t.id, orgId: ID.org, accountId: CONDO_ACCOUNT, name: t.name, address: t.address, serviceWindows: [{ day: 'MON', start: '06:00', end: '08:00' }, { day: 'THU', start: '06:00', end: '08:00' }], createdBy: ID.owner },
    });
    await setSiteGeo(t.id, t.lng, t.lat);
  }
  await prisma.service.upsert({
    where: { id: cid(2) },
    update: {},
    create: { id: cid(2), orgId: ID.org, vertical: ServiceVertical.LINEN, name: 'Amenity linen (pool/gym towels + robes) — per piece', unit: ServiceUnit.PIECE, baseRate: '1.5000', createdBy: ID.owner },
  });
  await prisma.standingOrder.upsert({
    where: { id: cid(21) },
    update: {},
    create: { id: cid(21), orgId: ID.org, accountId: CONDO_ACCOUNT, siteId: cid(11), serviceId: cid(2), vertical: OrderVertical.LINEN, cadence: StandingOrderCadence.WEEKLY, weekday: 1, pickupWindow: { start: '06:00', end: '08:00' }, concierge: true, active: true, startsOn: new Date('2026-06-01T00:00:00.000Z'), nextRunAt: new Date('2026-06-29T00:00:00.000Z'), createdBy: ID.owner },
  });
  await prisma.standingOrder.upsert({
    where: { id: cid(22) },
    update: {},
    create: { id: cid(22), orgId: ID.org, accountId: CONDO_ACCOUNT, siteId: cid(12), serviceId: cid(2), vertical: OrderVertical.LINEN, cadence: StandingOrderCadence.BIWEEKLY, weekday: 3, pickupWindow: { start: '06:00', end: '08:00' }, concierge: true, active: true, startsOn: new Date('2026-06-03T00:00:00.000Z'), nextRunAt: new Date('2026-07-01T00:00:00.000Z'), createdBy: ID.owner },
  });

  // Idempotency guard for the heavier orders/route/manifest/invoice block.
  if (await prisma.order.findUnique({ where: { id: cid(101) } })) {
    console.log('[seed] Branch4 condo already present — skipping condo orders/route/invoice (idempotent).');
    return;
  }

  const CONDO_ORDERS = [
    { id: cid(101), site: cid(11), status: OrderStatus.DELIVERED, subtotal: 184 },
    { id: cid(102), site: cid(12), status: OrderStatus.DELIVERED, subtotal: 152 },
    { id: cid(103), site: cid(13), status: OrderStatus.DELIVERED, subtotal: 209 },
    { id: cid(104), site: cid(11), status: OrderStatus.PICKED_UP, subtotal: 176 },
    { id: cid(105), site: cid(12), status: OrderStatus.SCHEDULED_PICKUP, subtotal: 168 },
    { id: cid(106), site: cid(13), status: OrderStatus.REQUESTED, subtotal: 195 },
  ];
  await prisma.order.createMany({
    data: CONDO_ORDERS.map((o) => ({ id: o.id, orgId: ID.org, accountId: CONDO_ACCOUNT, siteId: o.site, vertical: OrderVertical.LINEN, type: OrderType.ROUTE_STOP_ORDER, status: o.status, totals: cad(o.subtotal), createdAt: new Date('2026-06-22T06:30:00.000Z'), createdBy: ID.owner })),
    skipDuplicates: true,
  });

  // Real amenity-linen pieces on the 3 delivered orders (so the Manifest snapshot is real, not fabricated).
  const CONDO_PIECES = [42, 30, 51];
  await prisma.tag.createMany({
    data: [0, 1, 2].map((i) => ({ id: cid(111 + i), orgId: ID.org, code: `BB-CONDO-AMEN-${i + 1}`, type: TagType.QR, boundTo: TagBinding.ITEM, active: true, createdBy: ID.owner })),
    skipDuplicates: true,
  });
  await prisma.item.createMany({
    data: [0, 1, 2].map((i) => ({ id: cid(121 + i), orgId: ID.org, orderId: CONDO_ORDERS[i]!.id, tagId: cid(111 + i), kind: ItemKind.LINEN, status: ItemStatus.DELIVERED, measurements: { pieces: CONDO_PIECES[i] }, createdBy: ID.owner })),
    skipDuplicates: true,
  });

  // A COMPLETED amenity-linen run (3 CONCIERGE pickups) with DISTINCT, realistic on-site spans — keeps
  // analytics stops/hour + dwell sane (same rationale as the Track-A seed-fix). No driver/vehicle (the
  // live, vehicle-assigned routes live in §D below).
  await prisma.route.create({
    data: { id: cid(31), orgId: ID.org, date: new Date('2026-06-22T00:00:00.000Z'), status: RouteStatus.COMPLETED, optimized: true, createdAt: new Date('2026-06-22T05:45:00.000Z'), createdBy: ID.owner },
  });
  const CONDO_STOPS = [
    { site: cid(11), order: cid(101), win: ['06:00', '07:00'], arr: '06:12', done: '06:31' },
    { site: cid(12), order: cid(102), win: ['06:30', '07:30'], arr: '06:48', done: '07:05' },
    { site: cid(13), order: cid(103), win: ['07:00', '08:00'], arr: '07:20', done: '07:41' },
  ];
  await prisma.routeStop.createMany({
    data: CONDO_STOPS.map((s, i) => ({ id: cid(201 + i), orgId: ID.org, routeId: cid(31), seq: i + 1, accountId: CONDO_ACCOUNT, siteId: s.site, orderId: s.order, kind: RouteStopKind.PICKUP, stopKind: RouteStopHandoff.CONCIERGE, timeWindow: { start: new Date(`2026-06-22T${s.win[0]}:00Z`).toISOString(), end: new Date(`2026-06-22T${s.win[1]}:00Z`).toISOString() }, status: RouteStopStatus.COMPLETED, arrivedAt: new Date(`2026-06-22T${s.arr}:00Z`), completedAt: new Date(`2026-06-22T${s.done}:00Z`), createdBy: ID.owner })),
    skipDuplicates: true,
  });
  await prisma.manifest.create({
    data: {
      id: cid(301), orgId: ID.org, routeId: cid(31),
      lines: CONDO_STOPS.map((s, i) => ({ stopId: cid(201 + i), seq: i + 1, kind: RouteStopKind.PICKUP, orderId: s.order, account: { id: CONDO_ACCOUNT, name: CONDO_ACCOUNT_NAME }, site: { id: s.site, name: CONDO_TOWERS[i]!.name, address: CONDO_TOWERS[i]!.address }, expectedItems: [{ itemId: cid(121 + i), kind: ItemKind.LINEN, tagCode: `BB-CONDO-AMEN-${i + 1}`, status: ItemStatus.DELIVERED }], expectedItemCount: 1 })),
      createdBy: ID.owner,
    },
  });

  // ONE BATCH_PERIODIC invoice batching the 3 DELIVERED orders (net-30). HST DERIVED from the subtotals.
  const billed = CONDO_ORDERS.filter((o) => o.status === OrderStatus.DELIVERED);
  const m = cad(billed.reduce((a, o) => a + o.subtotal, 0));
  const now = new Date();
  await prisma.invoice.create({
    data: {
      id: cid(401), orgId: ID.org, accountId: CONDO_ACCOUNT, period: '2026-06', number: 'DEMO-CONDO-2026-06',
      lines: billed.map((o) => ({ description: `Amenity linen — ${CONDO_TOWERS.find((t) => t.id === o.site)?.name ?? 'tower'} (period 2026-06)`, quantity: 1, amount: o.subtotal.toFixed(2) })),
      subtotal: m.subtotal, tax: m.tax, total: m.total, currency: 'CAD', status: InvoiceStatus.ISSUED, issuedAt: now, dueAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), createdBy: ID.owner,
    },
  });
  await prisma.invoiceLine.createMany({
    data: billed.map((o, i) => ({ id: cid(411 + i), orgId: ID.org, invoiceId: cid(401), description: `Amenity linen — ${CONDO_TOWERS.find((t) => t.id === o.site)?.name ?? 'tower'}`, quantity: 1, unitAmount: o.subtotal.toFixed(2), amount: o.subtotal.toFixed(2) })),
    skipDuplicates: true,
  });

  console.log(`[seed] Branch4 §A ready: condo "${CONDO_ACCOUNT_NAME}" — 3 towers, 2 standing orders, 6 orders (3 DELIVERED), a COMPLETED run + manifest, 1 BATCH_PERIODIC invoice (net-30, HST ${m.tax}). Portal admin: +14165550022.`);
}

// ─────────────────────── Branch 4 §B — residential specialty (Rita-like homeowners) ───────────────────────
// Two new residential customers (PRD persona §3.1 Rita: homeowner, $55–$640 specialty jobs, wants a firm
// quote + live ETA + before/after photos + simple pay). Orders span the FULL §5.1 lifecycle (booked →
// quoted → approved → in-cleaning → en-route → delivered → paid), with real items/tags, an append-only
// custody trail, intake/before/after photos (url-based, like the existing seed — NOT MinIO), inspections
// incl. an acknowledged pre-existing-damage example + a claim, quotes, and invoices/payments (one PAID with
// HST, one OVERDUE). Fills the customer order history + the console specialty kanban.
const rid = uuidIn('d2000000');
interface ResSpec {
  i: number; account: string; site: string; serviceId: string; status: OrderStatus; itemStatus: ItemStatus; kind: ItemKind;
  tagCode: string; itemDesc: string; measure: number; rate: number; subtotal: number; createdAt: string;
  custody: CustodyStage[]; photos: PhotoKind[];
  inspection?: { codes: string[]; preexisting: boolean; notes: string };
  quote?: QuoteStatus;
  scheduledPickup?: boolean; scheduledDelivery?: boolean;
}

async function seedResidentialSpecialty(): Promise<void> {
  // Accounts + sites (real GTA neighbourhoods) + a RESIDENTIAL_CUSTOMER login each.
  const CUSTOMERS = [
    { acct: rid(1), site: rid(11), name: 'Demo — Priya Nair (residential specialty)', siteName: 'Demo residence — North York', address: '55 Brookbanks Dr, North York, ON', lng: -79.334, lat: 43.756, uid: rid(31), rid: rid(41), phone: '+14165550110', email: 'priya@example.com' },
    { acct: rid(2), site: rid(12), name: 'Demo — Grace Okafor (residential specialty)', siteName: 'Demo residence — Etobicoke', address: '20 Thirty Eighth St, Etobicoke, ON', lng: -79.54, lat: 43.599, uid: rid(32), rid: rid(42), phone: '+14165550111', email: 'grace@example.com' },
  ];
  for (const c of CUSTOMERS) {
    await prisma.account.upsert({ where: { id: c.acct }, update: {}, create: { id: c.acct, orgId: ID.org, type: AccountType.RESIDENTIAL, name: c.name, createdBy: ID.owner } });
    await prisma.site.upsert({ where: { id: c.site }, update: {}, create: { id: c.site, orgId: ID.org, accountId: c.acct, name: c.siteName, address: c.address, serviceWindows: [{ day: 'TUE', start: '09:00', end: '17:00' }], createdBy: ID.owner } });
    await setSiteGeo(c.site, c.lng, c.lat);
    await prisma.user.upsert({ where: { id: c.uid }, update: { phone: c.phone }, create: { id: c.uid, orgId: ID.org, name: c.name, phone: c.phone, email: c.email, authProviders: ['phone'], status: UserStatus.ACTIVE, createdBy: ID.owner } });
    await prisma.userRole.upsert({ where: { id: c.rid }, update: {}, create: { id: c.rid, orgId: ID.org, userId: c.uid, role: RoleType.RESIDENTIAL_CUSTOMER, scope: RoleScope.ACCOUNT, scopeId: c.acct, createdBy: ID.owner } });
  }
  // An upholstery service alongside the existing wool-rug service (ID.service) for variety.
  await prisma.service.upsert({ where: { id: rid(51) }, update: {}, create: { id: rid(51), orgId: ID.org, vertical: ServiceVertical.SPECIALTY, name: 'Upholstery deep-clean (sofa) — per item', unit: ServiceUnit.ITEM, baseRate: '120.0000', createdBy: ID.owner } });

  // Idempotency guard for the heavy per-order block.
  if (await prisma.order.findUnique({ where: { id: rid(101) } })) {
    console.log('[seed] Branch4 residential already present — skipping residential orders (idempotent).');
    return;
  }

  const A = rid(1), AS = rid(11), B = rid(2), BS = rid(12), RUG = ID.service, UPH = rid(51);
  const CUST: ResSpec[] = [
    // Priya (A): booked, quoted, in-cleaning, pre-existing-damage flagged.
    { i: 1, account: A, site: AS, serviceId: RUG, status: OrderStatus.REQUESTED, itemStatus: ItemStatus.RECEIVED, kind: ItemKind.RUG, tagCode: 'BB-RES-A-RUG-1', itemDesc: 'Wool runner 2.5x8', measure: 20, rate: 6.5, subtotal: 130, createdAt: '2026-06-26T15:00:00.000Z', custody: [], photos: [], scheduledPickup: true },
    { i: 2, account: A, site: AS, serviceId: RUG, status: OrderStatus.QUOTED, itemStatus: ItemStatus.INSPECTED, kind: ItemKind.RUG, tagCode: 'BB-RES-A-RUG-2', itemDesc: 'Hand-knotted wool 5x8', measure: 40, rate: 6.5, subtotal: 260, createdAt: '2026-06-24T14:00:00.000Z', custody: [CustodyStage.PICKED_UP, CustodyStage.INTAKE, CustodyStage.INSPECTED], photos: [PhotoKind.INTAKE], inspection: { codes: ['MINOR_FRINGE_WEAR'], preexisting: false, notes: 'Demo — light fringe wear noted at intake.' }, quote: QuoteStatus.SENT },
    { i: 3, account: A, site: AS, serviceId: UPH, status: OrderStatus.IN_CLEANING, itemStatus: ItemStatus.IN_CLEANING, kind: ItemKind.UPHOLSTERY, tagCode: 'BB-RES-A-UPH-3', itemDesc: '3-seat fabric sofa', measure: 1, rate: 120, subtotal: 120, createdAt: '2026-06-23T13:00:00.000Z', custody: [CustodyStage.PICKED_UP, CustodyStage.INTAKE, CustodyStage.INSPECTED, CustodyStage.DUSTING, CustodyStage.WASH], photos: [PhotoKind.INTAKE, PhotoKind.BEFORE], inspection: { codes: ['LIGHT_SOILING'], preexisting: false, notes: 'Demo — light soiling, no pre-existing damage.' }, quote: QuoteStatus.APPROVED },
    { i: 4, account: A, site: AS, serviceId: RUG, status: OrderStatus.DAMAGE_PREEXISTING_FLAGGED, itemStatus: ItemStatus.INSPECTED, kind: ItemKind.RUG, tagCode: 'BB-RES-A-RUG-4', itemDesc: 'Antique silk-blend 4x6', measure: 24, rate: 9, subtotal: 216, createdAt: '2026-06-24T11:00:00.000Z', custody: [CustodyStage.PICKED_UP, CustodyStage.INTAKE, CustodyStage.INSPECTED], photos: [PhotoKind.INTAKE, PhotoKind.CLAIM], inspection: { codes: ['WATER_STAIN', 'PILE_CRUSH'], preexisting: true, notes: 'Demo — pre-existing water staining + pile crush photographed and acknowledged by customer at intake.' }, quote: QuoteStatus.SENT },
    // Grace (B): approved+scheduled, en-route (live), delivered+paid, delivered+overdue.
    { i: 5, account: B, site: BS, serviceId: RUG, status: OrderStatus.QUOTE_APPROVED, itemStatus: ItemStatus.INSPECTED, kind: ItemKind.RUG, tagCode: 'BB-RES-B-RUG-5', itemDesc: 'Persian wool 6x9', measure: 54, rate: 6.5, subtotal: 351, createdAt: '2026-06-25T16:00:00.000Z', custody: [CustodyStage.PICKED_UP, CustodyStage.INTAKE, CustodyStage.INSPECTED], photos: [PhotoKind.INTAKE], inspection: { codes: ['PET_ODOUR'], preexisting: false, notes: 'Demo — pet odour treatment approved.' }, quote: QuoteStatus.APPROVED, scheduledDelivery: true },
    { i: 6, account: B, site: BS, serviceId: RUG, status: OrderStatus.DELIVERY_EN_ROUTE, itemStatus: ItemStatus.READY, kind: ItemKind.RUG, tagCode: 'BB-RES-B-RUG-6', itemDesc: 'Area rug 5x7', measure: 35, rate: 6.5, subtotal: 227.5, createdAt: '2026-06-26T12:00:00.000Z', custody: [CustodyStage.PICKED_UP, CustodyStage.INTAKE, CustodyStage.INSPECTED, CustodyStage.DUSTING, CustodyStage.WASH, CustodyStage.DRY, CustodyStage.FINISH, CustodyStage.QC, CustodyStage.READY, CustodyStage.OUT_FOR_DELIVERY], photos: [PhotoKind.INTAKE, PhotoKind.BEFORE, PhotoKind.AFTER], inspection: { codes: ['LIGHT_SOILING'], preexisting: false, notes: 'Demo — cleaned, QC passed, out for delivery.' }, quote: QuoteStatus.APPROVED, scheduledDelivery: true },
    { i: 7, account: B, site: BS, serviceId: UPH, status: OrderStatus.INVOICED, itemStatus: ItemStatus.DELIVERED, kind: ItemKind.UPHOLSTERY, tagCode: 'BB-RES-B-UPH-7', itemDesc: 'Heirloom wingback chair', measure: 1, rate: 140, subtotal: 140, createdAt: '2026-06-18T10:00:00.000Z', custody: [CustodyStage.PICKED_UP, CustodyStage.INTAKE, CustodyStage.INSPECTED, CustodyStage.DUSTING, CustodyStage.WASH, CustodyStage.DRY, CustodyStage.FINISH, CustodyStage.QC, CustodyStage.READY, CustodyStage.OUT_FOR_DELIVERY, CustodyStage.DELIVERED], photos: [PhotoKind.INTAKE, PhotoKind.BEFORE, PhotoKind.AFTER], inspection: { codes: [], preexisting: false, notes: 'Demo — delivered, paid in full (POD on the delivery stop).' }, quote: QuoteStatus.APPROVED },
    { i: 8, account: B, site: BS, serviceId: RUG, status: OrderStatus.INVOICED, itemStatus: ItemStatus.DELIVERED, kind: ItemKind.RUG, tagCode: 'BB-RES-B-RUG-8', itemDesc: 'Wool kilim 4x6', measure: 24, rate: 6.5, subtotal: 156, createdAt: '2026-05-20T10:00:00.000Z', custody: [CustodyStage.PICKED_UP, CustodyStage.INTAKE, CustodyStage.INSPECTED, CustodyStage.DUSTING, CustodyStage.WASH, CustodyStage.DRY, CustodyStage.FINISH, CustodyStage.QC, CustodyStage.READY, CustodyStage.OUT_FOR_DELIVERY, CustodyStage.DELIVERED], photos: [PhotoKind.INTAKE, PhotoKind.BEFORE, PhotoKind.AFTER, PhotoKind.POD], inspection: { codes: [], preexisting: false, notes: 'Demo — delivered; invoice past due (overdue example).' }, quote: QuoteStatus.APPROVED },
  ];

  for (const o of CUST) {
    const oid = rid(100 + o.i);
    const base = new Date(o.createdAt);
    const m = cad(o.subtotal);
    const at = (h: number) => new Date(base.getTime() + h * 3_600_000);
    await prisma.order.create({
      data: {
        id: oid, orgId: ID.org, accountId: o.account, siteId: o.site, vertical: OrderVertical.SPECIALTY, type: OrderType.JOB, status: o.status, totals: m, createdAt: base, createdBy: ID.owner,
        ...(o.scheduledPickup ? { scheduledPickupWindow: { start: at(24).toISOString(), end: at(27).toISOString() } } : {}),
        ...(o.scheduledDelivery ? { scheduledDeliveryWindow: { start: at(2).toISOString(), end: at(5).toISOString() } } : {}),
      },
    });
    await prisma.tag.create({ data: { id: rid(200 + o.i), orgId: ID.org, code: o.tagCode, type: TagType.QR, boundTo: TagBinding.ITEM, active: true, createdBy: ID.owner } });
    await prisma.item.create({ data: { id: rid(300 + o.i), orgId: ID.org, orderId: oid, tagId: rid(200 + o.i), kind: o.kind, status: o.itemStatus, measurements: { description: o.itemDesc }, createdBy: ID.owner } });
    await prisma.orderLine.create({ data: { id: rid(400 + o.i), orgId: ID.org, orderId: oid, serviceId: o.serviceId, itemId: rid(300 + o.i), qty: 1, measure: o.measure, rate: o.rate.toFixed(4), amount: o.subtotal.toFixed(2), createdBy: ID.owner } });
    if (o.custody.length) {
      await prisma.custodyEvent.createMany({ data: o.custody.map((stage, k) => ({ orgId: ID.org, itemId: rid(300 + o.i), stage, actorId: ID.owner, deviceId: 'demo-seed', occurredAt: at(k + 1), createdBy: ID.owner })) });
    }
    await prisma.photo.createMany({ data: o.photos.map((kind, k) => ({ id: rid(700 + o.i * 10 + k), orgId: ID.org, itemId: rid(300 + o.i), orderId: oid, kind, url: `https://demo.local/${kind.toLowerCase()}/${o.tagCode.toLowerCase()}-${k}.jpg`, takenAt: at(k + 1), createdBy: ID.owner })), skipDuplicates: true });
    if (o.inspection) {
      await prisma.inspection.create({ data: { id: rid(500 + o.i), orgId: ID.org, itemId: rid(300 + o.i), conditionCodes: o.inspection.codes, notes: o.inspection.notes, preexistingDamage: o.inspection.preexisting, ackBy: ID.owner, ackAt: at(2), createdBy: ID.owner } });
    }
    if (o.quote) {
      const approved = o.quote === QuoteStatus.APPROVED;
      await prisma.quote.create({ data: { id: rid(600 + o.i), orgId: ID.org, orderId: oid, lines: [{ description: o.itemDesc, measure: o.measure, unit: o.serviceId === UPH ? 'ITEM' : 'SQFT', rate: o.rate, amount: o.subtotal }], subtotal: m.subtotal, tax: m.tax, total: m.total, status: o.quote, expiresAt: at(24 * 14), ...(approved ? { approvedBy: ID.owner, approvedAt: at(3) } : {}), createdBy: ID.owner } });
    }
  }

  // The pre-existing-damage order (i=4) gets a real OPEN damage Claim (PRD §5.1 high-value liability path).
  await prisma.claim.create({ data: { id: rid(1101), orgId: ID.org, orderId: rid(104), itemId: rid(304), type: ClaimType.DAMAGE, amount: '150.00', status: ClaimStatus.OPEN, createdBy: ID.owner } });

  // Invoices/payments: i=7 DELIVERED → PAID (with HST + a SUCCEEDED card payment); i=8 → ISSUED but OVERDUE.
  const paid = cad(140);
  await prisma.invoice.create({ data: { id: rid(807), orgId: ID.org, accountId: rid(2), orderId: rid(107), number: 'DEMO-RES-0007', lines: [{ description: 'Heirloom wingback chair — upholstery deep-clean', quantity: 1, amount: '140.00' }], subtotal: paid.subtotal, tax: paid.tax, total: paid.total, currency: 'CAD', status: InvoiceStatus.PAID, issuedAt: new Date('2026-06-19T10:00:00.000Z'), paidAt: new Date('2026-06-19T18:30:00.000Z'), dueAt: new Date('2026-07-19T10:00:00.000Z'), createdBy: ID.owner } });
  await prisma.invoiceLine.create({ data: { id: rid(1007), orgId: ID.org, invoiceId: rid(807), description: 'Heirloom wingback chair — upholstery deep-clean', quantity: 1, unitAmount: '140.00', amount: '140.00' } });
  await prisma.payment.create({ data: { id: rid(907), orgId: ID.org, invoiceId: rid(807), orderId: rid(107), accountId: rid(2), method: PaymentMethod.CARD, amount: paid.total, currency: 'CAD', status: PaymentStatus.SUCCEEDED, capturedAmount: paid.total, capturedAt: new Date('2026-06-19T18:30:00.000Z'), createdBy: ID.owner } });

  const overdue = cad(156);
  await prisma.invoice.create({ data: { id: rid(808), orgId: ID.org, accountId: rid(2), orderId: rid(108), number: 'DEMO-RES-0008', lines: [{ description: 'Wool kilim 4x6 — hand-wash', quantity: 1, amount: '156.00' }], subtotal: overdue.subtotal, tax: overdue.tax, total: overdue.total, currency: 'CAD', status: InvoiceStatus.OVERDUE, issuedAt: new Date('2026-05-21T10:00:00.000Z'), dueAt: new Date('2026-06-04T10:00:00.000Z'), createdBy: ID.owner } });
  await prisma.invoiceLine.create({ data: { id: rid(1008), orgId: ID.org, invoiceId: rid(808), description: 'Wool kilim 4x6 — hand-wash', quantity: 1, unitAmount: '156.00', amount: '156.00' } });

  console.log('[seed] Branch4 §B ready: 2 residential customers (Priya, Grace) + 8 specialty orders spanning the §5.1 lifecycle, with custody/photos/inspections, 1 PAID invoice (HST), 1 OVERDUE, 1 damage claim.');
}

// ─────────────────────── Branch 4 §C — care-home East Wing (enrich Maple Grove) ───────────────────────
// Sandra's world (PRD persona §3.1: care-home laundry manager — 120 residents; her nightmare is lost
// personal clothing). A NEW wing under the existing Maple Grove account (B1.careHome) so the existing West
// Wing counts the residents e2e pins stay untouched. New residents across rooms, garments at EVERY §5.2-B
// garmentStatus stage with a faithful append-only CustodyEvent trail, and 3 lost & found items (one
// RECONCILED). Fills the resident-clothing view (four buckets + lost & found).
const eid = uuidIn('d4000000');
const EAST_LINEAR = [GarmentStatus.GARMENT_ENROLLED, GarmentStatus.SOIL_PICKUP, GarmentStatus.INTAKE_SORT, GarmentStatus.WASH, GarmentStatus.RETURN_SORT, GarmentStatus.DELIVERED_TO_RESIDENT];
function eastGarmentPath(status: GarmentStatus): GarmentStatus[] {
  if (status === GarmentStatus.LOST_FOUND_POOL) return [...EAST_LINEAR.slice(0, 5), GarmentStatus.LOST_FOUND_POOL];
  if (status === GarmentStatus.RECONCILE) return [...EAST_LINEAR.slice(0, 5), GarmentStatus.LOST_FOUND_POOL, GarmentStatus.RECONCILE];
  const idx = EAST_LINEAR.indexOf(status);
  return idx >= 0 ? EAST_LINEAR.slice(0, idx + 1) : [GarmentStatus.GARMENT_ENROLLED];
}

async function seedCareHomeEastWing(): Promise<void> {
  await prisma.site.upsert({ where: { id: eid(1) }, update: {}, create: { id: eid(1), orgId: ID.org, accountId: B1.careHome, name: 'Maple Grove — East Wing', address: '88 Elm St, Toronto, ON', createdBy: ID.owner } });

  const RES = [
    { id: eid(11), name: 'Demo — Vera Lindqvist', room: 'E-101' },
    { id: eid(12), name: 'Demo — Frank Osei', room: 'E-102' },
    { id: eid(13), name: 'Demo — Doris Albright', room: 'E-103' },
    { id: eid(14), name: 'Demo — Otto Reyes', room: 'E-104' },
  ];
  for (const r of RES) {
    await prisma.resident.upsert({ where: { id: r.id }, update: {}, create: { id: r.id, orgId: ID.org, siteId: eid(1), name: r.name, room: r.room, status: ResidentStatus.ACTIVE, createdBy: ID.owner } });
  }

  // Idempotency guard for the heavy garment/custody/lost-found block.
  if (await prisma.item.findUnique({ where: { id: eid(101) } })) {
    console.log('[seed] Branch4 care-home East Wing already present — skipping garments (idempotent).');
    return;
  }

  // 9 garments: one at EVERY §5.2-B stage (8 stages) + a 2nd LOST_FOUND_POOL for a 3rd lost&found row.
  const GARM = [
    { n: 1, resident: eid(11), status: GarmentStatus.GARMENT_ENROLLED, desc: 'Lavender cardigan', code: 'RES-E101-01' },
    { n: 2, resident: eid(11), status: GarmentStatus.SOIL_PICKUP, desc: 'Cotton nightgown', code: 'RES-E101-02' },
    { n: 3, resident: eid(12), status: GarmentStatus.INTAKE_SORT, desc: 'Plaid flannel shirt', code: 'RES-E102-01' },
    { n: 4, resident: eid(12), status: GarmentStatus.WASH, desc: 'Khaki trousers', code: 'RES-E102-02' },
    { n: 5, resident: eid(13), status: GarmentStatus.RETURN_SORT, desc: 'Teal house dress', code: 'RES-E103-01' },
    { n: 6, resident: eid(13), status: GarmentStatus.DELIVERED_TO_RESIDENT, desc: 'Beige knit vest', code: 'RES-E103-02' },
    { n: 7, resident: eid(14), status: GarmentStatus.LOST_FOUND_POOL, desc: 'Maroon wool socks (unmatched on return sort)', code: 'RES-E104-LF1' },
    { n: 8, resident: eid(14), status: GarmentStatus.RECONCILE, desc: 'Striped polo (reconciled to resident)', code: 'RES-E104-RC1' },
    { n: 9, resident: eid(14), status: GarmentStatus.LOST_FOUND_POOL, desc: 'Grey cardigan (no name tag — pooled)', code: 'RES-E104-LF2' },
  ];
  await prisma.tag.createMany({ data: GARM.map((g) => ({ id: eid(200 + g.n), orgId: ID.org, code: g.code, type: TagType.QR, boundTo: TagBinding.RESIDENT, active: true, createdBy: ID.owner })), skipDuplicates: true });
  await prisma.item.createMany({ data: GARM.map((g) => ({ id: eid(100 + g.n), orgId: ID.org, residentId: g.resident, tagId: eid(200 + g.n), kind: ItemKind.GARMENT, garmentStatus: g.status, measurements: { description: g.desc }, createdBy: ID.owner })), skipDuplicates: true });
  await prisma.custodyEvent.createMany({ data: GARM.flatMap((g) => eastGarmentPath(g.status).map((stage) => ({ orgId: ID.org, itemId: eid(100 + g.n), garmentStage: stage, actorId: ID.owner, createdBy: ID.owner }))) });

  // 3 lost & found rows: g7 OPEN (candidate Otto by room tag), g8 RECONCILED (already assigned to Otto), g9 OPEN (no candidate).
  await prisma.lostFoundItem.upsert({ where: { id: eid(301) }, update: {}, create: { id: eid(301), orgId: ID.org, siteId: eid(1), itemId: eid(107), tagId: eid(207), candidateResidentId: eid(14), status: LostFoundStatus.OPEN, notes: 'Unmatched on return sort — candidate by room tag', createdBy: ID.owner } });
  await prisma.lostFoundItem.upsert({ where: { id: eid(302) }, update: {}, create: { id: eid(302), orgId: ID.org, siteId: eid(1), itemId: eid(108), tagId: eid(208), candidateResidentId: eid(14), status: LostFoundStatus.RECONCILED, reconciledAt: new Date('2026-06-24T15:00:00.000Z'), notes: 'Reconciled to resident on review of laundry photo', createdBy: ID.owner } });
  await prisma.lostFoundItem.upsert({ where: { id: eid(303) }, update: {}, create: { id: eid(303), orgId: ID.org, siteId: eid(1), itemId: eid(109), tagId: eid(209), status: LostFoundStatus.OPEN, notes: 'No name tag — awaiting identification', createdBy: ID.owner } });

  console.log('[seed] Branch4 §C ready: Maple Grove East Wing — 4 residents, 9 garments across EVERY §5.2-B stage (append-only custody), 3 lost & found (1 reconciled).');
}

// ─────────────────────── Branch 4 §C-linen — Maple Grove facility linen (par loop) ───────────────────────
// The OTHER care-home stream (PRD §2.2 facility linen = the rental/par model; §5.2 SOIL_PICKUP …
// PACK_TO_PAR; §B3.1/§B3.2). Real par levels per wing/cost-centre × linen SKU, an append-only on-hand
// ledger (LinenMovement) with a reconciling cache (LinenStock: on_hand == Σ qty), one recorded soiled-cart
// pickup at a SOIL_PICKUP stop, and a generated pack-to-par load sheet (a Manifest, kind PACK_TO_PAR). The
// seeded care-home ACCOUNT_ADMIN (+14165550030) sees ONLY Maple Grove's par/pickups (inverse-scope).
const fl = uuidIn('b2000000');
const LINEN_SKUS = [
  { id: fl(1), name: 'Bed sheets (flat)', rate: '0.8500' },
  { id: fl(2), name: 'Bath towels', rate: '0.6000' },
  { id: fl(3), name: 'Patient gowns', rate: '0.9000' },
  { id: fl(4), name: 'Blankets (thermal)', rate: '1.2000' },
] as const;
const CC_WEST = fl(50); // West Wing cost-centre (Sandra's "cost-center reporting")
const CC_EAST = fl(51); // East Wing cost-centre

async function seedMapleGroveFacilityLinen(): Promise<void> {
  // Linen SKUs reuse Service (vertical LINEN, unit PIECE) — the rental catalogue.
  for (const s of LINEN_SKUS) {
    await prisma.service.upsert({ where: { id: s.id }, update: {}, create: { id: s.id, orgId: ID.org, vertical: ServiceVertical.LINEN, name: s.name, unit: ServiceUnit.PIECE, baseRate: s.rate, createdBy: ID.owner } });
  }
  // A cost-centre per wing (under the care-home account, scoped to the wing's site).
  await prisma.costCenter.upsert({ where: { id: CC_WEST }, update: {}, create: { id: CC_WEST, orgId: ID.org, accountId: B1.careHome, siteId: B1.site, code: 'MG-WEST', name: 'Maple Grove — West Wing', kind: CostCenterKind.WING, active: true, createdBy: ID.owner } });
  await prisma.costCenter.upsert({ where: { id: CC_EAST }, update: {}, create: { id: CC_EAST, orgId: ID.org, accountId: B1.careHome, siteId: eid(1), code: 'MG-EAST', name: 'Maple Grove — East Wing', kind: CostCenterKind.WING, active: true, createdBy: ID.owner } });

  // Par targets per (site, cost-centre?, sku). West Wing site-level + a wing-scoped sheet par; East Wing.
  const PARS = [
    { n: 100, site: B1.site, cc: null, sku: fl(1), target: 120 },
    { n: 101, site: B1.site, cc: null, sku: fl(2), target: 200 },
    { n: 102, site: B1.site, cc: null, sku: fl(3), target: 60 },
    { n: 103, site: B1.site, cc: null, sku: fl(4), target: 40 },
    { n: 104, site: B1.site, cc: CC_WEST, sku: fl(1), target: 50 }, // a wing-scoped sheet par
    { n: 105, site: eid(1), cc: null, sku: fl(1), target: 80 },
    { n: 106, site: eid(1), cc: null, sku: fl(2), target: 120 },
  ];
  for (const p of PARS) {
    await prisma.parLevel.upsert({ where: { id: fl(p.n) }, update: { targetQty: p.target }, create: { id: fl(p.n), orgId: ID.org, accountId: B1.careHome, siteId: p.site, costCenterId: p.cc, serviceId: p.sku, targetQty: p.target, createdBy: ID.owner } });
  }

  // The append-only ledger + on-hand cache + the recorded pickup + the load sheet are guarded so re-runs
  // never duplicate the immutable movements (the Track-B append-only rule).
  if (await prisma.soilPickup.findUnique({ where: { id: fl(300) } })) {
    console.log('[seed] Maple Grove facility linen already present — skipping ledger/pickup/load-sheet (idempotent).');
    return;
  }

  // Initial clean deliveries (+) then the soiled-cart pickup (−). on_hand == Σ qty for each cell.
  //   cell: [site, cc, sku, delivered, pickedUp] → on_hand = delivered − pickedUp
  const CELLS = [
    { n: 200, site: B1.site, cc: null, sku: fl(1), delivered: 100, picked: 18 }, // West sheets → 82
    { n: 201, site: B1.site, cc: null, sku: fl(2), delivered: 160, picked: 40 }, // West towels → 120
    { n: 202, site: B1.site, cc: null, sku: fl(3), delivered: 55, picked: 0 }, // West gowns → 55
    { n: 203, site: B1.site, cc: null, sku: fl(4), delivered: 38, picked: 0 }, // West blankets → 38
    { n: 204, site: B1.site, cc: CC_WEST, sku: fl(1), delivered: 30, picked: 0 }, // West-wing sheets → 30
    { n: 205, site: eid(1), cc: null, sku: fl(1), delivered: 70, picked: 0 }, // East sheets → 70
    { n: 206, site: eid(1), cc: null, sku: fl(2), delivered: 100, picked: 0 }, // East towels → 100
  ];

  // A SOIL_PICKUP route stop at West Wing (a PICKUP-kind stop) the pickup is recorded against.
  await prisma.route.upsert({ where: { id: fl(310) }, update: {}, create: { id: fl(310), orgId: ID.org, date: new Date('2026-06-26T00:00:00.000Z'), status: RouteStatus.COMPLETED, createdBy: ID.owner } });
  await prisma.routeStop.upsert({
    where: { id: fl(311) },
    update: {},
    create: { id: fl(311), orgId: ID.org, routeId: fl(310), seq: 1, accountId: B1.careHome, siteId: B1.site, kind: RouteStopKind.PICKUP, status: RouteStopStatus.COMPLETED, arrivedAt: new Date('2026-06-26T08:15:00.000Z'), completedAt: new Date('2026-06-26T08:40:00.000Z'), createdBy: ID.owner },
  });

  // The recorded soiled-cart pickup (West Wing): the confirmation the account sees ("4 carts at 08:30").
  const pickupLines = CELLS.filter((c) => c.site === B1.site && c.cc === null && c.picked > 0).map((c) => ({ serviceId: c.sku, qty: c.picked }));
  await prisma.soilPickup.create({
    data: { id: fl(300), orgId: ID.org, accountId: B1.careHome, siteId: B1.site, costCenterId: null, routeStopId: fl(311), cartCount: 4, bagCount: 9, weightKg: new Prisma.Decimal('57.40'), soiled: true, lines: pickupLines as unknown as Prisma.InputJsonValue, actorId: ID.owner, occurredAt: new Date('2026-06-26T08:30:00.000Z'), createdBy: ID.owner },
  });
  // The append-only custody checkpoint (cart custody: itemId null, garmentStage SOIL_PICKUP).
  await prisma.custodyEvent.create({ data: { orgId: ID.org, itemId: null, garmentStage: GarmentStatus.SOIL_PICKUP, actorId: ID.owner, occurredAt: new Date('2026-06-26T08:30:00.000Z'), createdBy: ID.owner } });

  // The ledger (append-only) + the reconciling on-hand cache.
  let mv = 400;
  for (const c of CELLS) {
    await prisma.linenMovement.create({ data: { id: fl(mv++), orgId: ID.org, accountId: B1.careHome, siteId: c.site, costCenterId: c.cc, serviceId: c.sku, type: LinenMovementType.DELIVERY, qty: c.delivered, sourceType: 'DELIVERY', actorId: ID.owner, occurredAt: new Date('2026-06-25T07:00:00.000Z'), createdBy: ID.owner } });
    if (c.picked > 0) {
      await prisma.linenMovement.create({ data: { id: fl(mv++), orgId: ID.org, accountId: B1.careHome, siteId: c.site, costCenterId: c.cc, serviceId: c.sku, type: LinenMovementType.SOIL_PICKUP, qty: -c.picked, sourceType: 'SOIL_PICKUP', sourceId: fl(300), actorId: ID.owner, occurredAt: new Date('2026-06-26T08:30:00.000Z'), createdBy: ID.owner } });
    }
    await prisma.linenStock.create({ data: { id: fl(150 + (c.n - 200)), orgId: ID.org, accountId: B1.careHome, siteId: c.site, costCenterId: c.cc, serviceId: c.sku, onHand: c.delivered - c.picked, createdBy: ID.owner } });
  }

  // The generated pack-to-par load sheet (a Manifest, kind PACK_TO_PAR) for West Wing — gap = max(0, par −
  // on-hand) per SKU (incl. the wing-scoped sheet par), exactly as the §B3.2 load sheet the ops + account view.
  const skuName = new Map(LINEN_SKUS.map((s) => [s.id, s.name] as const));
  const westPars = PARS.filter((p) => p.site === B1.site);
  const westStock = new Map(CELLS.filter((c) => c.site === B1.site).map((c) => [`${c.cc ?? ''}:${c.sku}`, c.delivered - c.picked] as const));
  const sheetLines = westPars.map((p) => {
    const onHand = westStock.get(`${p.cc ?? ''}:${p.sku}`) ?? 0;
    return { serviceId: p.sku, sku: skuName.get(p.sku) ?? p.sku, unit: ServiceUnit.PIECE, costCenterId: p.cc, par: p.target, onHand, gap: Math.max(0, p.target - onHand) };
  });
  await prisma.manifest.create({ data: { id: fl(320), orgId: ID.org, kind: ManifestKind.PACK_TO_PAR, siteId: B1.site, costCenterId: null, lines: sheetLines as unknown as Prisma.InputJsonValue, generatedAt: new Date('2026-06-26T09:00:00.000Z'), createdBy: ID.owner } });

  console.log('[seed] Maple Grove facility linen ready: 4 LINEN SKUs, par per wing/cost-centre, on-hand ledger (on_hand == Σ movements), 1 soiled-cart pickup (4 carts / 58 pcs), 1 pack-to-par load sheet.');
}

// ─────────────────────── Branch 4 §D — live fleet (vehicles/drivers/shifts/routes/GpsPings) ───────────────────────
// Makes GET /v1/fleet/live + the live map real: 3 vehicles + NEW dedicated drivers (the seeded driver
// fixtures are owned by tracking.e2e) on ACTIVE shifts, an IN_PROGRESS delivery route (one stop EN_ROUTE
// with a live ETA, one COMPLETED with a POD, one PENDING), a second PUBLISHED route, and a modest run of
// GpsPings (latest-ping → fleet/live's Timescale fallback, so vehicles position WITHOUT priming Redis —
// which sidesteps the host-redis-shadows-docker gotcha entirely). Stamped "now"-relative so a fresh seed
// shows current movement; the whole block is guarded so re-runs don't duplicate pings.
const fid = uuidIn('d3000000');

async function seedLiveFleet(): Promise<void> {
  const DRIVERS = [
    { uid: fid(1), rid: fid(11), drv: fid(21), veh: fid(31), shift: fid(41), name: 'Demo — Andre Cole (driver)', phone: '+14165550101', email: 'andre@bluebee.example', label: 'Cube Van 14', plate: 'BB-14CUBE' },
    { uid: fid(2), rid: fid(12), drv: fid(22), veh: fid(32), shift: fid(42), name: 'Demo — Bianca Ruiz (driver)', phone: '+14165550102', email: 'bianca@bluebee.example', label: 'Sprinter 22', plate: 'BB-22SPRT' },
    { uid: fid(3), rid: fid(13), drv: fid(23), veh: fid(33), shift: fid(43), name: 'Demo — Caleb Singh (driver)', phone: '+14165550103', email: 'caleb@bluebee.example', label: 'Cargo 31', plate: 'BB-31CRGO' },
  ];
  const startedAt = new Date(Date.now() - 90 * 60 * 1000); // shifts began ~90 min ago.
  for (const d of DRIVERS) {
    await prisma.user.upsert({ where: { id: d.uid }, update: { phone: d.phone }, create: { id: d.uid, orgId: ID.org, name: d.name, phone: d.phone, email: d.email, authProviders: ['phone'], status: UserStatus.ACTIVE, createdBy: ID.owner } });
    await prisma.userRole.upsert({ where: { id: d.rid }, update: {}, create: { id: d.rid, orgId: ID.org, userId: d.uid, role: RoleType.DRIVER, scope: RoleScope.ORG, createdBy: ID.owner } });
    await prisma.vehicle.upsert({ where: { id: d.veh }, update: {}, create: { id: d.veh, orgId: ID.org, label: d.label, plate: d.plate, capacity: 24, status: VehicleStatus.ACTIVE, createdBy: ID.owner } });
    await prisma.driver.upsert({ where: { id: d.drv }, update: {}, create: { id: d.drv, orgId: ID.org, userId: d.uid, defaultVehicleId: d.veh, createdBy: ID.owner } });
    await prisma.shift.upsert({ where: { id: d.shift }, update: {}, create: { id: d.shift, orgId: ID.org, driverId: d.drv, vehicleId: d.veh, status: ShiftStatus.ACTIVE, startedAt, createdBy: ID.owner } });
  }

  // [Inc-23 QC] Ensure the "Demo Driver" (+14165550006) has a Driver row. It is referenced by many e2e specs
  // (e.g. the care-home linen loop), some of which previously depended on tracking.e2e running FIRST to
  // create it (a pre-existing inter-spec ordering gap — see the fixtures note above). Seeding it makes those
  // specs order-independent; tracking.e2e's `ensureDriver()` (findUnique-by-userId, then create) tolerates
  // this pre-existing row. Minimal (userId only; no default vehicle) — enough for the driver-identity lookups.
  await prisma.driver.upsert({
    where: { userId: 'e1000000-0000-4000-8000-000000000005' },
    update: {},
    create: { orgId: ID.org, userId: 'e1000000-0000-4000-8000-000000000005', createdBy: ID.owner },
  });

  // Idempotency guard for the route/stop/POD/ping block (route createMany has no upsert).
  if (await prisma.route.findUnique({ where: { id: fid(51) } })) {
    console.log('[seed] Branch4 live fleet already present — skipping routes/pings (idempotent, no duplicate pings).');
    return;
  }

  const now = new Date();
  const ago = (mins: number): Date => new Date(now.getTime() - mins * 60000);
  const ahead = (mins: number): Date => new Date(now.getTime() + mins * 60000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Route 1 — IN_PROGRESS delivery run for vehicle 1: stop1 DELIVERED (+POD), stop2 EN_ROUTE (live ETA),
  // stop3 PENDING. Stops reference real residential delivery orders + a condo tower so the map is wired up.
  await prisma.route.create({ data: { id: fid(51), orgId: ID.org, date: today, driverId: fid(21), vehicleId: fid(31), status: RouteStatus.IN_PROGRESS, optimized: true, createdAt: startedAt, createdBy: ID.owner } });
  await prisma.routeStop.create({ data: { id: fid(61), orgId: ID.org, routeId: fid(51), seq: 1, accountId: rid(2), siteId: rid(12), orderId: rid(107), kind: RouteStopKind.DELIVERY, stopKind: RouteStopHandoff.DIRECT, status: RouteStopStatus.COMPLETED, arrivedAt: ago(40), completedAt: ago(28), createdBy: ID.owner } });
  await prisma.routeStop.create({ data: { id: fid(62), orgId: ID.org, routeId: fid(51), seq: 2, accountId: rid(2), siteId: rid(12), orderId: rid(106), kind: RouteStopKind.DELIVERY, stopKind: RouteStopHandoff.DIRECT, status: RouteStopStatus.EN_ROUTE, timeWindow: { start: ago(5).toISOString(), end: ahead(25).toISOString() }, eta: ahead(10), etaLow: ahead(7), etaHigh: ahead(14), etaComputedAt: now, createdBy: ID.owner } });
  await prisma.routeStop.create({ data: { id: fid(63), orgId: ID.org, routeId: fid(51), seq: 3, accountId: CONDO_ACCOUNT, siteId: cid(11), orderId: cid(104), kind: RouteStopKind.DELIVERY, stopKind: RouteStopHandoff.CONCIERGE, status: RouteStopStatus.PENDING, createdBy: ID.owner } });

  // A real POD on the completed delivery stop (driver POD-capture flow) + a POD photo.
  await prisma.proofOfDelivery.create({ data: { id: fid(81), orgId: ID.org, routeStopId: fid(61), signatureUrl: 'https://demo.local/pod/res-0007-signature.png', capturedBy: fid(1), capturedAt: ago(28), createdBy: ID.owner } });
  await prisma.photo.create({ data: { id: fid(82), orgId: ID.org, orderId: rid(107), podId: fid(81), kind: PhotoKind.POD, url: 'https://demo.local/pod/res-0007-doorstep.jpg', takenAt: ago(28), createdBy: ID.owner } });

  // Route 2 — PUBLISHED concierge pickup run for vehicle 2 (a second moving vehicle on the map).
  await prisma.route.create({ data: { id: fid(52), orgId: ID.org, date: today, driverId: fid(22), vehicleId: fid(32), status: RouteStatus.PUBLISHED, optimized: true, createdAt: startedAt, createdBy: ID.owner } });
  await prisma.routeStop.create({ data: { id: fid(71), orgId: ID.org, routeId: fid(52), seq: 1, accountId: CONDO_ACCOUNT, siteId: cid(12), orderId: cid(105), kind: RouteStopKind.PICKUP, stopKind: RouteStopHandoff.CONCIERGE, status: RouteStopStatus.EN_ROUTE, timeWindow: { start: ago(10).toISOString(), end: ahead(50).toISOString() }, eta: ahead(18), etaLow: ahead(14), etaHigh: ahead(24), etaComputedAt: now, createdBy: ID.owner } });
  await prisma.routeStop.create({ data: { id: fid(72), orgId: ID.org, routeId: fid(52), seq: 2, accountId: CONDO_ACCOUNT, siteId: cid(13), orderId: cid(106), kind: RouteStopKind.PICKUP, stopKind: RouteStopHandoff.CONCIERGE, status: RouteStopStatus.PENDING, createdBy: ID.owner } });

  // GpsPings — a modest moving run for vehicles 1 & 2 (heading toward their EN_ROUTE stops) + a parked
  // last-known for vehicle 3. Inserted via raw ON-CONFLICT SQL (idempotent on vehicle_id, recorded_at).
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const pings: SeedPing[] = [];
  // Vehicle 1: from downtown toward Etobicoke (rid(12) site at -79.54, 43.599) — 10 breadcrumbs.
  const v1from = { lng: -79.42, lat: 43.64 }, v1to = { lng: -79.54, lat: 43.599 };
  for (let k = 0; k < 10; k++) {
    const t = k / 9;
    pings.push({ id: fid(1001 + k), shiftId: fid(41), vehicleId: fid(31), lng: lerp(v1from.lng, v1to.lng, t), lat: lerp(v1from.lat, v1to.lat, t), speed: 11 + (k % 4), heading: 250, recordedAt: new Date(now.getTime() - (9 - k) * 150_000) });
  }
  // Vehicle 2: toward the condo towers (-79.3787, 43.642) — 7 breadcrumbs.
  const v2from = { lng: -79.36, lat: 43.66 }, v2to = { lng: -79.3787, lat: 43.642 };
  for (let k = 0; k < 7; k++) {
    const t = k / 6;
    pings.push({ id: fid(1101 + k), shiftId: fid(42), vehicleId: fid(32), lng: lerp(v2from.lng, v2to.lng, t), lat: lerp(v2from.lat, v2to.lat, t), speed: 9 + (k % 3), heading: 200, recordedAt: new Date(now.getTime() - (6 - k) * 150_000) });
  }
  // Vehicle 3: parked at the depot (one recent fix so it still appears on the map).
  pings.push({ id: fid(1201), shiftId: fid(43), vehicleId: fid(33), lng: -79.3832, lat: 43.6629, speed: 0, heading: 0, recordedAt: new Date(now.getTime() - 4 * 60000) });
  await insertPings(pings);

  console.log(`[seed] Branch4 §D ready: 3 vehicles + 3 drivers on ACTIVE shifts; route1 IN_PROGRESS (EN_ROUTE stop w/ live ETA + a COMPLETED POD), route2 PUBLISHED; ${pings.length} GpsPings → fleet/live shows moving vehicles.`);
}

// ─────────────────────── Integration reconcile — cost centres on the demo condo (Phase-2 split billing) ───────────────────────
// The cost-centre backend (Branch 5) shipped with NO demo rows and the rich seed predates it. This small,
// idempotent block attaches 3 cost centres (Tower A / Tower B / Amenity) to the seeded condo account,
// attributes its 3 DELIVERED orders + the batch invoice's lines + the 2 standing orders, and writes a
// reconciling costCenterBreakdown — so the B2B split-invoice view demos with REAL data. Additive; no schema
// change. Each bucket's HST derives from its subtotal (13%); the buckets sum EXACTLY to the invoice
// (545.00 / 70.85 / 615.85), byte-identical to what the batch-invoice engine's buildCostCenterBreakdown emits.
async function seedCostCenters(): Promise<void> {
  const CC = [
    { id: cid(51), code: 'TWR-A', name: 'Tower A', kind: CostCenterKind.WING, site: cid(11), order: cid(101), line: cid(411), subtotal: 184 },
    { id: cid(52), code: 'TWR-B', name: 'Tower B', kind: CostCenterKind.WING, site: cid(12), order: cid(102), line: cid(412), subtotal: 152 },
    { id: cid(53), code: 'AMEN', name: 'Amenity (gym/pool)', kind: CostCenterKind.AMENITY, site: cid(13), order: cid(103), line: cid(413), subtotal: 209 },
  ];
  // The condo orders/invoice/lines exist only after seedCondoMultiSite's guarded block ran — guard on that.
  if (!(await prisma.order.findUnique({ where: { id: cid(101) } }))) {
    console.log('[seed] Integration cost-centres skipped — condo demo orders absent.');
    return;
  }
  for (const c of CC) {
    await prisma.costCenter.upsert({
      where: { id: c.id },
      update: {},
      create: { id: c.id, orgId: ID.org, accountId: CONDO_ACCOUNT, siteId: c.site, code: c.code, name: c.name, kind: c.kind, active: true, createdBy: ID.owner },
    });
    await prisma.order.update({ where: { id: c.order }, data: { costCenterId: c.id } }); // idempotent (same id on re-run)
    await prisma.invoiceLine.update({ where: { id: c.line }, data: { costCenterId: c.id } });
  }
  // Propagate to the two condo standing orders (so generated orders inherit the split automatically).
  await prisma.standingOrder.update({ where: { id: cid(21) }, data: { costCenterId: cid(51) } });
  await prisma.standingOrder.update({ where: { id: cid(22) }, data: { costCenterId: cid(52) } });

  // Reconciling breakdown on the seeded batch invoice (buckets sorted by code asc, like the engine).
  const hst = (s: number): number => Math.round(s * 0.13 * 100) / 100;
  const breakdown = [...CC]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((c) => ({ costCenterId: c.id, code: c.code, name: c.name, subtotal: c.subtotal.toFixed(2), tax: hst(c.subtotal).toFixed(2), total: (Math.round((c.subtotal + hst(c.subtotal)) * 100) / 100).toFixed(2) }));
  // Fail loud if the per-bucket split (per-bucket HST) ever diverges from the invoice totals (aggregate
  // HST) — they reconcile today (whole-dollar subtotals); this guard catches a future fractional desync.
  const inv401 = await prisma.invoice.findUniqueOrThrow({ where: { id: cid(401) }, select: { subtotal: true, tax: true, total: true } });
  const toCents = (s: string): number => Math.round(parseFloat(s) * 100);
  const sumOf = (k: 'subtotal' | 'tax' | 'total'): number => breakdown.reduce((a, b) => a + toCents(b[k]), 0);
  if (sumOf('subtotal') !== toCents(inv401.subtotal.toString()) || sumOf('tax') !== toCents(inv401.tax.toString()) || sumOf('total') !== toCents(inv401.total.toString())) {
    throw new Error('[seed] cost-centre breakdown does not reconcile to the invoice totals (subtotal/tax/total)');
  }
  await prisma.invoice.update({ where: { id: cid(401) }, data: { costCenterBreakdown: breakdown } });

  console.log(`[seed] Integration cost-centres ready: 3 on condo account (Tower A/B + Amenity), 3 orders + invoice lines attributed, 2 standing orders propagated, batch invoice split ${breakdown.map((b) => b.code + '=' + b.total).join(' ')}.`);
}

// ─────────────────────── seeded-counts summary (DoD evidence the screens will be full) ───────────────────────
async function printSummary(): Promise<void> {
  const [accounts, sites, residents, garments, vehicles, drivers, shifts, routes, stops, pings, invoices, payments, standingOrders, lostFound, photos, costCenters] = await Promise.all([
    prisma.account.count(), prisma.site.count(), prisma.resident.count(), prisma.item.count({ where: { kind: ItemKind.GARMENT } }),
    prisma.vehicle.count(), prisma.driver.count(), prisma.shift.count(), prisma.route.count(), prisma.routeStop.count(), prisma.gpsPing.count(),
    prisma.invoice.count(), prisma.payment.count(), prisma.standingOrder.count(), prisma.lostFoundItem.count(), prisma.photo.count(), prisma.costCenter.count(),
  ]);
  const byStatus = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } });
  console.log('\n[seed] ───────────────── seeded demo counts (Branch 4 evidence) ─────────────────');
  console.log(`[seed]  accounts=${accounts} sites=${sites} residents=${residents} garments=${garments}`);
  console.log(`[seed]  vehicles=${vehicles} drivers=${drivers} shifts=${shifts} routes=${routes} routeStops=${stops} gpsPings=${pings}`);
  console.log(`[seed]  invoices=${invoices} payments=${payments} standingOrders=${standingOrders} lostFound=${lostFound} photos=${photos} costCenters=${costCenters}`);
  console.log('[seed]  orders by status:');
  for (const r of byStatus.sort((a, b) => a.status.localeCompare(b.status))) console.log(`[seed]    ${r.status.padEnd(28)} ${r._count._all}`);
  console.log('[seed] ──────────────────────────────────────────────────────────────────────────\n');
}

// ─────────────────────── Branch — Inc-15 corporate pricing (members pay individually) ───────────────────────
// A corporate condo tower: members order + PAY INDIVIDUALLY (RESIDENTIAL account, PER_ORDER) but are PRICED
// on the tower's rate card. One building with a real GTA geo + 300m match boundary (the condo path), a
// per-pound (LB) + per-item (ITEM) rate card (cheaper than retail), a stable demo join code (the TTC path),
// and an IN-BUILDING resident with a booked order priced on the corporate card while paying individually
// (Order.pricingAccountId = corp, Order.accountId = the resident). Makes the corporate console + building
// match end-to-end clickable.
const corp = uuidIn('c0000000');
const CORP_ACCOUNT = corp(1);
const CORP_BUILDING = corp(11);
const CORP_BUILDING_LNG = -79.3801; // ~200 Bay St, Toronto (WGS84 lng/lat)
const CORP_BUILDING_LAT = 43.6489;
const SVC_WASHFOLD = corp(2); // per-pound wash & fold
const SVC_DRYCLEAN = corp(3); // per-item dry clean
const CORP_JOIN_CODE = 'MAPLELOFT';

async function seedCorporatePricing(): Promise<void> {
  // Corporate account (BUSINESS, PER_ORDER, corporate=true) + a stable demo join code.
  await prisma.account.upsert({
    where: { id: CORP_ACCOUNT },
    update: { corporate: true, billingMode: BillingMode.PER_ORDER, joinCode: CORP_JOIN_CODE },
    create: { id: CORP_ACCOUNT, orgId: ID.org, type: AccountType.BUSINESS, name: 'Demo — Maple District Towers (corporate)', billingMode: BillingMode.PER_ORDER, corporate: true, joinCode: CORP_JOIN_CODE, createdBy: ID.owner },
  });
  // The building — a Site with a geo point + a 300m match boundary (the condo path).
  await prisma.site.upsert({
    where: { id: CORP_BUILDING },
    update: { matchRadiusM: 300 },
    create: { id: CORP_BUILDING, orgId: ID.org, accountId: CORP_ACCOUNT, name: 'Demo — Maple District Tower 1', address: '200 Bay St, Toronto, ON', matchRadiusM: 300, serviceWindows: [{ day: 'WED', start: '08:00', end: '20:00' }], createdBy: ID.owner },
  });
  await setSiteGeo(CORP_BUILDING, CORP_BUILDING_LNG, CORP_BUILDING_LAT);
  // Catalog — a per-pound wash&fold + a per-item dry-clean service.
  await prisma.service.upsert({ where: { id: SVC_WASHFOLD }, update: {}, create: { id: SVC_WASHFOLD, orgId: ID.org, vertical: ServiceVertical.WASHFOLD, name: 'Wash & fold — per pound', unit: ServiceUnit.LB, baseRate: '2.5000', createdBy: ID.owner } });
  await prisma.service.upsert({ where: { id: SVC_DRYCLEAN }, update: {}, create: { id: SVC_DRYCLEAN, orgId: ID.org, vertical: ServiceVertical.SPECIALTY, name: 'Dry clean — per item', unit: ServiceUnit.ITEM, baseRate: '12.0000', createdBy: ID.owner } });
  // Org-default (retail) rates, so an OUTSIDE resident gets a clean default price.
  await prisma.priceListItem.upsert({ where: { priceListId_serviceId: { priceListId: ID.priceListDefault, serviceId: SVC_WASHFOLD } }, update: {}, create: { orgId: ID.org, priceListId: ID.priceListDefault, serviceId: SVC_WASHFOLD, rate: '2.5000', createdBy: ID.owner } });
  await prisma.priceListItem.upsert({ where: { priceListId_serviceId: { priceListId: ID.priceListDefault, serviceId: SVC_DRYCLEAN } }, update: {}, create: { orgId: ID.org, priceListId: ID.priceListDefault, serviceId: SVC_DRYCLEAN, rate: '12.0000', createdBy: ID.owner } });
  // The corporate rate card (account-bound PriceList) — cheaper than retail (per-pound + per-item).
  const corpPriceList = corp(40);
  await prisma.priceList.upsert({ where: { id: corpPriceList }, update: {}, create: { id: corpPriceList, orgId: ID.org, name: 'Maple District Towers rate card', accountId: CORP_ACCOUNT, active: true, createdBy: ID.owner } });
  await prisma.priceListItem.upsert({ where: { priceListId_serviceId: { priceListId: corpPriceList, serviceId: SVC_WASHFOLD } }, update: { rate: '1.8000' }, create: { id: corp(41), orgId: ID.org, priceListId: corpPriceList, serviceId: SVC_WASHFOLD, rate: '1.8000', createdBy: ID.owner } });
  await prisma.priceListItem.upsert({ where: { priceListId_serviceId: { priceListId: corpPriceList, serviceId: SVC_DRYCLEAN } }, update: { rate: '9.0000' }, create: { id: corp(42), orgId: ID.org, priceListId: corpPriceList, serviceId: SVC_DRYCLEAN, rate: '9.0000', createdBy: ID.owner } });

  // An IN-BUILDING resident — pays individually (RESIDENTIAL account, PER_ORDER) but priced corporate.
  const resAcct = corp(50), resSite = corp(51), resUser = corp(60), resRole = corp(61);
  await prisma.account.upsert({ where: { id: resAcct }, update: {}, create: { id: resAcct, orgId: ID.org, type: AccountType.RESIDENTIAL, name: 'Demo — Tom Becker (Maple District resident)', createdBy: ID.owner } });
  await prisma.site.upsert({ where: { id: resSite }, update: {}, create: { id: resSite, orgId: ID.org, accountId: resAcct, name: 'Demo — Maple District unit 1408', address: '200 Bay St, Unit 1408, Toronto, ON', createdBy: ID.owner } });
  await setSiteGeo(resSite, CORP_BUILDING_LNG + 0.0002, CORP_BUILDING_LAT + 0.0001); // ~25 m from the tower centroid → inside the 300 m boundary
  await prisma.user.upsert({ where: { id: resUser }, update: { phone: '+14165550120' }, create: { id: resUser, orgId: ID.org, name: 'Demo — Tom Becker', phone: '+14165550120', email: 'tom@example.com', authProviders: ['phone'], status: UserStatus.ACTIVE, createdBy: ID.owner } });
  await prisma.userRole.upsert({ where: { id: resRole }, update: {}, create: { id: resRole, orgId: ID.org, userId: resUser, role: RoleType.RESIDENTIAL_CUSTOMER, scope: RoleScope.ACCOUNT, scopeId: resAcct, createdBy: ID.owner } });

  // One booked order: priced on the CORPORATE card (pricingAccountId), paid by the RESIDENT (accountId).
  const order = corp(70);
  if (!(await prisma.order.findUnique({ where: { id: order } }))) {
    const m = cad(36); // 20 lb @ $1.80 (corporate) = $36.00 — vs $50.00 at the $2.50 retail rate.
    await prisma.order.create({ data: { id: order, orgId: ID.org, accountId: resAcct, pricingAccountId: CORP_ACCOUNT, siteId: resSite, vertical: OrderVertical.WASHFOLD, type: OrderType.JOB, status: OrderStatus.DELIVERED, totals: m, createdAt: new Date('2026-06-27T15:00:00.000Z'), createdBy: ID.owner } });
    await prisma.tag.create({ data: { id: corp(71), orgId: ID.org, code: 'BB-CORP-WF-1', type: TagType.QR, boundTo: TagBinding.ITEM, active: true, createdBy: ID.owner } });
    await prisma.item.create({ data: { id: corp(72), orgId: ID.org, orderId: order, tagId: corp(71), kind: ItemKind.GARMENT, status: ItemStatus.DELIVERED, measurements: { weightLb: 20 }, createdBy: ID.owner } });
    await prisma.orderLine.create({ data: { id: corp(73), orgId: ID.org, orderId: order, serviceId: SVC_WASHFOLD, itemId: corp(72), qty: 1, measure: 20, rate: '1.8000', amount: '36.00', createdBy: ID.owner } });
  }

  console.log('[seed] Inc-15 corporate pricing: 1 corporate account + building (300 m) + LB/ITEM rate card + join code MAPLELOFT + 1 in-building resident (corporate-priced order).');
}

// [Inc-19] Sample service zones for the geo-blocking editor. Seeded INACTIVE (drafts) ON PURPOSE: active zones
// would gate the shared demo org's existing bookings + the e2e suite (a booking outside every active zone is
// blocked). The founder reviews, redraws, and ACTIVATES them in the console to turn on block-at-booking. Real
// drawn polygons (closed rings). Idempotent: fixed ids, upsert scalars + raw ST_GeomFromGeoJSON for the area
// (the polygon column is Prisma `Unsupported`). The active-zone gate itself is proven end-to-end by the e2e.
const ZONE_DOWNTOWN = 'e9000000-0000-4000-8000-000000000001';
const ZONE_NORTH = 'e9000000-0000-4000-8000-000000000002';
async function seedServiceZones(): Promise<void> {
  const zones = [
    { id: ZONE_DOWNTOWN, name: 'Sample — Downtown Toronto (redraw me)', sortOrder: 0, ring: [[-79.40, 43.64], [-79.36, 43.64], [-79.36, 43.66], [-79.40, 43.66], [-79.40, 43.64]] },
    { id: ZONE_NORTH, name: 'Sample — North York (redraw me)', sortOrder: 1, ring: [[-79.44, 43.74], [-79.38, 43.74], [-79.38, 43.78], [-79.44, 43.78], [-79.44, 43.74]] },
  ];
  for (const z of zones) {
    await prisma.serviceZone.upsert({
      where: { id: z.id },
      update: { active: false, sortOrder: z.sortOrder, name: z.name },
      create: { id: z.id, orgId: ID.org, name: z.name, active: false, sortOrder: z.sortOrder, createdBy: ID.owner },
    });
    const geojson = JSON.stringify({ type: 'Polygon', coordinates: [z.ring] });
    await prisma.$executeRaw`UPDATE "ServiceZone" SET area = ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography WHERE id = ${z.id}::uuid AND org_id = ${ID.org}::uuid`;
  }
  console.log('[seed] Inc-19 geo-blocking: 2 SAMPLE service zones (INACTIVE drafts — activate/redraw in the console to turn on block-at-booking).');
}

async function main(): Promise<void> {
  await seedDemoOrder();
  await seedAuthFixtures();
  await seedPricing();
  await seedLogistics();
  await seedTrackADemo();
  await seedTrackBDemo();
  // ── Branch 4 — rich demo enrichment (order matters: fleet references condo + residential sites/orders) ──
  await seedCondoMultiSite();
  await seedCostCenters(); // integration reconcile — split-billing demo data on the condo account
  await seedResidentialSpecialty();
  await seedCorporatePricing();
  await seedServiceZones();
  // [Inc-25] Target the DEMO org EXPLICITLY (never inferred) and opt IN to the dev-only sample garment items.
  // Prod runs `npm run db:seed:catalog` instead — structure only, org resolved. See seed-catalog-structure.ts.
  await seedDrycleanCatalog(prisma, { orgId: ID.org, ownerId: ID.owner, sampleItems: true });
  await seedCareHomeEastWing();
  await seedMapleGroveFacilityLinen();
  await seedLiveFleet();
  await printSummary();
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
