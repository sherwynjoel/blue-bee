/**
 * Blue Bee / Royal — customer-demo enrichment seed.
 *
 * Adds a fuller spread of orders to the EXISTING seeded residential customer (Rita, account 4444…) so a
 * demo tester logging into the customer app sees real functionality across states: an upcoming pickup,
 * plus delivered orders they can rate — on top of the main seed's QUOTED order (approve → pay flow).
 *
 * Separate from the main seed on purpose:
 *   • Idempotent + additive — safe to run against the ALREADY-seeded live env (it upserts nothing it
 *     doesn't own and skips entirely once its own orders exist). It NEVER creates/mutates the org, Rita,
 *     her account/site, or the catalog — those must already exist (run `npm run db:seed` first).
 *   • Honesty firewall (CLAUDE.md): every amount is a real per-sqft line total, nothing fabricated. No
 *     ratings/claims are invented — delivered orders are left UNRATED so the tester performs the rating.
 *
 * Orders are created directly at their target status (the same pattern the main seed uses for the
 * DELIVERED route-stop orders) — the §5.1 state machine is enforced at the API transition layer, not on
 * insert — and carry no custody/append-only rows, so re-running never trips the append-only triggers.
 *
 * Run:  npm run db:seed:demo      (from apps/api, after npm run db:seed)
 */
import { PrismaClient } from '@prisma/client';
import { OrderStatus, OrderType, OrderVertical } from '@blue-bee/shared';

const prisma = new PrismaClient();

// Existing demo-tenant anchors created by the main seed (prisma/seed.ts ID map) — reused, never recreated.
const ORG = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '44444444-4444-4444-8444-444444444444'; // Rita — residential specialty customer
const SITE = '55555555-5555-4555-8555-555555555555'; // Demo residence
const SERVICE = '66666666-6666-4666-8666-666666666666'; // Area rug hand-wash (wool), SQFT @ $6.50
const RATE = '6.5000';

// Fixed UUIDs for the enrichment rows (distinct from the main seed) so this stays idempotent.
const DEMO = {
  orderScheduled: 'de000000-0000-4000-8000-000000000001',
  lineScheduled: 'de000000-0000-4000-8000-000000000002',
  orderDelivered1: 'de000000-0000-4000-8000-000000000011',
  lineDelivered1: 'de000000-0000-4000-8000-000000000012',
  orderDelivered2: 'de000000-0000-4000-8000-000000000021',
  lineDelivered2: 'de000000-0000-4000-8000-000000000022',
} as const;

type DemoOrder = {
  orderId: string;
  lineId: string;
  status: OrderStatus;
  measure: number;
  subtotal: string;
  tax: string;
  total: string;
  pickup?: { start: string; end: string };
  createdAt?: Date;
};

async function makeOrder(o: DemoOrder): Promise<void> {
  await prisma.order.create({
    data: {
      id: o.orderId,
      orgId: ORG,
      accountId: ACCOUNT,
      siteId: SITE,
      vertical: OrderVertical.SPECIALTY,
      type: OrderType.JOB,
      status: o.status,
      ...(o.pickup ? { scheduledPickupWindow: o.pickup } : {}),
      totals: { subtotal: o.subtotal, tax: o.tax, total: o.total, currency: 'CAD' },
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      createdBy: OWNER,
    },
  });
  await prisma.orderLine.create({
    data: {
      id: o.lineId,
      orgId: ORG,
      orderId: o.orderId,
      serviceId: SERVICE,
      qty: 1,
      measure: o.measure,
      rate: RATE,
      amount: o.subtotal,
      createdBy: OWNER,
    },
  });
}

async function main(): Promise<void> {
  // Guard 1 — the main demo tenant must exist; this seed only enriches it, never creates it.
  const org = await prisma.organization.findUnique({ where: { id: ORG } });
  if (!org) {
    console.log('[seed:demo] Main demo tenant not found — run `npm run db:seed` first. Skipping.');
    return;
  }
  // Guard 2 — idempotent: once the enrichment orders exist, do nothing (safe to re-run on the live env).
  const already = await prisma.order.findUnique({ where: { id: DEMO.orderScheduled } });
  if (already) {
    console.log('[seed:demo] Rita demo orders already present — skipping (idempotent).');
    return;
  }

  const now = new Date();
  const days = (n: number): Date => new Date(now.getTime() + n * 86_400_000);
  const hours = (d: Date, n: number): Date => new Date(d.getTime() + n * 3_600_000);

  // 20 sqft × $6.50 = $130.00 (+13% HST) — an UPCOMING pickup, two days out (morning window).
  const pickupDay = days(2);
  await makeOrder({
    orderId: DEMO.orderScheduled,
    lineId: DEMO.lineScheduled,
    status: OrderStatus.SCHEDULED_PICKUP,
    measure: 20,
    subtotal: '130.00',
    tax: '16.90',
    total: '146.90',
    pickup: { start: hours(pickupDay, 9).toISOString(), end: hours(pickupDay, 12).toISOString() },
  });

  // Two DELIVERED orders (left UNRATED so the tester can exercise the rating flow).
  await makeOrder({
    orderId: DEMO.orderDelivered1,
    lineId: DEMO.lineDelivered1,
    status: OrderStatus.DELIVERED,
    measure: 24,
    subtotal: '156.00',
    tax: '20.28',
    total: '176.28',
    createdAt: days(-9),
  });
  await makeOrder({
    orderId: DEMO.orderDelivered2,
    lineId: DEMO.lineDelivered2,
    status: OrderStatus.DELIVERED,
    measure: 32,
    subtotal: '208.00',
    tax: '27.04',
    total: '235.04',
    createdAt: days(-4),
  });

  console.log(`[seed:demo] Added Rita demo orders on account ${ACCOUNT}: 1 SCHEDULED_PICKUP + 2 DELIVERED.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
