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
  ServiceUnit,
  ServiceVertical,
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

async function main(): Promise<void> {
  await seedDemoOrder();
  await seedAuthFixtures();
  await seedPricing();
  await seedLogistics();
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
