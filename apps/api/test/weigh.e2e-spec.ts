import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Weigh e2e — Increment 22 (driver/plant weight → append-only capture → hybrid pricing gate). Proves:
 *   • FIXED PER_KG (Wash & Fold): weigh → append-only capture, authoritative weight set, quote auto-priced
 *     at the published rate (measure × rate) and AUTO-APPROVED → QUOTE_APPROVED (no customer tap).
 *   • FROM_MEASURED specialty in a MIXED order (wash + rug): weigh the wash → the FIXED line is priced but
 *     the quote is SENT (awaits customer approval); the customer then approves in the existing quote card.
 *   • Idempotency: same Idempotency-Key → one capture; a NEW key → a NEW (re-weigh) capture, old retained,
 *     authoritative = the most recent.
 *   • Append-only: the DB trigger blocks UPDATE/DELETE of a WeightCapture (a correction is a new capture).
 *
 * HONESTY FIREWALL: the per-kg / per-sqft rates here are CLEARLY-LABELLED TEST fixtures created by this
 * spec ONLY (never the seed). They are parented under the seeded Dry Cleaning card + given non-ITEM units,
 * so they never surface on the customer Home menu, the console service-menu, or the dry-clean picker.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const DRY_CLEANING = '5e000000-0000-4000-8000-000000000003'; // seeded Dry Cleaning card — TEST fixtures hide under it

// TEST fixtures (deterministic ids; upserted in beforeAll). $/kg and $/sqft are TEST rates, not seed data.
const CAT_WF = 'e2e00000-0000-4000-8000-000000000f01';
const SVC_WF = 'e2e00000-0000-4000-8000-000000000f02'; // FIXED, unit KG, 3.50/kg
const CAT_RUG = 'e2e00000-0000-4000-8000-000000000f03';
const SVC_RUG = 'e2e00000-0000-4000-8000-000000000f04'; // FROM_MEASURED, unit SQFT, 6.00/sqft
// [Inc-24] per-POUND wash&fold — the load is still weighed in KG; pricing converts kg → lb.
const CAT_WF_LB = 'e2e00000-0000-4000-8000-000000000f05';
const SVC_WF_LB = 'e2e00000-0000-4000-8000-000000000f06'; // FIXED, unit LB, 1.50/lb
const WF_RATE = '3.5000';
const RUG_RATE = '6.0000';
const WF_LB_RATE = '1.5000';

const PHONES = {
  owner: '+14165550001', // OWNER
  plant: '+14165550004', // PLANT_OP (weigher)
  csr: '+14165550003', // CSR (intake/inspection)
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A (quote approver)
};

describe('Weigh e2e — Increment 22 (weight → hybrid pricing)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  const futureWindow = () => ({
    start: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    end: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  });
  const post = (path: string, who: string, body: unknown = {}, key?: string) => {
    let req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`);
    if (key) req = req.set('Idempotency-Key', key);
    return req.send(body as object);
  };
  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

  /** Book a specialty order, drive it to INTAKE_INSPECTED, inspecting each item with the given measurements. */
  /**
   * Book → schedule → receive → inspect each item with its intended measurements, returning the item ids in
   * the order they were REQUESTED (so `itemIds[0]` is the first item passed in).
   *
   * [Inc-29] This maps `order.items[i]` to `items[i]` BY INDEX again — and that is now correct, not luck.
   *
   * The history: in Inc-28 this mapping (on the comment "Book preserves item order") started applying the
   * rug's `{ sqft: 40 }` to the wash-and-fold garment, because `Item` had no ordinal and the `items` include
   * had no `orderBy`, so an inspection could move a row and the order came back rug-first. It was rewritten
   * to map by `kind` as a stopgap, and the missing order was flagged. Inc-29 fixed the root cause:
   * `Item.sortOrder` + `ITEM_ORDER_BY`, so `GET /v1/orders/:id` returns items in the submitted order on
   * every read. The index mapping is restored deliberately, so that **this spec passing is itself a proof of
   * the guarantee** — an inspection here mutates an item (which moves its heap tuple), yet a later index read
   * still binds the right measurement to the right line. Its dedicated proof is `item-ordering.e2e-spec.ts`.
   */
  async function bookToInspected(items: Array<{ kind: string; serviceId: string; measurements: Record<string, unknown> }>): Promise<{ orderId: string; itemIds: string[] }> {
    const booked = (await post('/v1/orders', 'owner', { accountId: ACCOUNT_A, pickupWindow: futureWindow(), items: items.map((i) => ({ kind: i.kind, serviceId: i.serviceId, estimatedMeasure: 1 })) }).expect(201)).body;
    const orderId: string = booked.id;
    await post(`/v1/orders/${orderId}/schedule-pickup`, 'owner', { pickupWindow: futureWindow() }).expect(200);
    await post(`/v1/orders/${orderId}/received-at-plant`, 'owner', {}).expect(200);
    const order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    // The submitted order is the returned order (Inc-29). Assert it here rather than assume it.
    expect((order.items as Array<{ kind: string }>).map((it) => it.kind)).toEqual(items.map((i) => i.kind));

    const itemIds: string[] = order.items.map((it: { id: string }) => it.id);
    for (let i = 0; i < order.items.length; i += 1) {
      await post(`/v1/orders/${orderId}/items/${itemIds[i]}/inspection`, 'csr', { conditionCodes: [], measurements: items[i].measurements }).expect(201);
    }
    return { orderId, itemIds };
  }

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

    // TEST fixtures — hidden under Dry Cleaning (child categories), non-ITEM units so they never surface.
    await prisma.serviceCategory.upsert({
      where: { id: CAT_WF },
      update: { pricingModel: 'FIXED', unit: 'PER_KG', parentId: DRY_CLEANING, active: false },
      create: { id: CAT_WF, orgId: ORG1, name: 'TEST — Wash & Fold (e2e)', pricingModel: 'FIXED', unit: 'PER_KG', parentId: DRY_CLEANING, active: false, createdBy: OWNER },
    });
    await prisma.service.upsert({
      where: { id: SVC_WF },
      update: { baseRate: WF_RATE, unit: 'KG', categoryId: CAT_WF, active: true },
      create: { id: SVC_WF, orgId: ORG1, vertical: 'WASHFOLD', unit: 'KG', name: 'TEST Wash & Fold rate (e2e)', baseRate: WF_RATE, categoryId: CAT_WF, active: true, createdBy: OWNER },
    });
    await prisma.serviceCategory.upsert({
      where: { id: CAT_RUG },
      update: { pricingModel: 'FROM_MEASURED', unit: 'PER_MEASURE', parentId: DRY_CLEANING, active: false },
      create: { id: CAT_RUG, orgId: ORG1, name: 'TEST — Rug (e2e)', pricingModel: 'FROM_MEASURED', unit: 'PER_MEASURE', parentId: DRY_CLEANING, active: false, createdBy: OWNER },
    });
    await prisma.service.upsert({
      where: { id: SVC_RUG },
      update: { baseRate: RUG_RATE, unit: 'SQFT', categoryId: CAT_RUG, active: true },
      create: { id: SVC_RUG, orgId: ORG1, vertical: 'SPECIALTY', unit: 'SQFT', name: 'TEST Rug rate (e2e)', baseRate: RUG_RATE, categoryId: CAT_RUG, active: true, createdBy: OWNER },
    });
    // [Inc-24] per-pound TEST fixture (same hiding rules: child of Dry Cleaning, inactive, non-ITEM unit).
    await prisma.serviceCategory.upsert({
      where: { id: CAT_WF_LB },
      update: { pricingModel: 'FIXED', unit: 'PER_LB', parentId: DRY_CLEANING, active: false },
      create: { id: CAT_WF_LB, orgId: ORG1, name: 'TEST — Wash & Fold per-lb (e2e)', pricingModel: 'FIXED', unit: 'PER_LB', parentId: DRY_CLEANING, active: false, createdBy: OWNER },
    });
    await prisma.service.upsert({
      where: { id: SVC_WF_LB },
      update: { baseRate: WF_LB_RATE, unit: 'LB', categoryId: CAT_WF_LB, active: true },
      create: { id: SVC_WF_LB, orgId: ORG1, vertical: 'WASHFOLD', unit: 'LB', name: 'TEST Wash & Fold per-lb rate (e2e)', baseRate: WF_LB_RATE, categoryId: CAT_WF_LB, active: true, createdBy: OWNER },
    });
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('FIXED PER_KG (Wash & Fold): weigh → append-only capture, authoritative weight, auto-priced + AUTO-APPROVED', async () => {
    const { orderId } = await bookToInspected([{ kind: 'GARMENT', serviceId: SVC_WF, measurements: { pieces: 1 } }]);

    const res = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 6, weighPoint: 'PLANT', source: 'plant' }, `weigh-${orderId}`).expect(201)).body;

    // append-only capture + authoritative weight
    expect(res.capture.weightKg).toBe('6.00');
    expect(res.capture.weighPoint).toBe('PLANT');
    expect(res.authoritativeWeightKg).toBe('6.00');
    // hybrid gate: all-FIXED → auto-priced at the published rate and AUTO-APPROVED
    expect(res.pricing.status).toBe('auto_approved');
    expect(res.pricing.awaitsCustomerApproval).toBe(false);
    expect(res.pricing.orderStatus).toBe('QUOTE_APPROVED');

    // order really moved to QUOTE_APPROVED via the real state machine; a quote was APPROVED with the audit note
    const order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTE_APPROVED');
    // the priced subtotal = weight × published rate (6kg × $3.50 = $21.00); pricing.total = the quote total incl HST
    expect(order.totals.subtotal).toBe('21.00');
    expect(res.pricing.total).toBe(order.totals.total);
    const audit = await prisma.auditLog.findFirst({ where: { orgId: ORG1, entityId: orderId, action: 'STATUS_TRANSITION' }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(audit?.after)).toContain('auto-priced at published rate');

    // GET …/weight returns the authoritative weight + the append-only history
    const weight = (await get(`/v1/orders/${orderId}/weight`, 'plant').expect(200)).body;
    expect(weight.authoritativeWeightKg).toBe('6.00');
    expect(weight.captures).toHaveLength(1);
  });

  it('[Inc-24] FIXED PER_LB: the load is weighed in KG but priced per POUND — 6.00 kg → 13.2277… lb × $1.50/lb = $19.84', async () => {
    const { orderId } = await bookToInspected([{ kind: 'GARMENT', serviceId: SVC_WF_LB, measurements: { pieces: 1 } }]);

    const res = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 6, weighPoint: 'PLANT', source: 'plant' }, `weigh-lb-${orderId}`).expect(201)).body;

    // the CAPTURE stays canonical kilograms — the conversion happens only at pricing time
    expect(res.capture.weightKg).toBe('6.00');
    expect(res.authoritativeWeightKg).toBe('6.00');
    expect(res.pricing.status).toBe('auto_approved');
    expect(res.pricing.orderStatus).toBe('QUOTE_APPROVED');

    // 6 kg × 2.2046226218 = 13.2277357308 lb; × $1.50/lb = $19.8416… → $19.84 (NOT 6 × 1.50 = $9.00)
    const order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTE_APPROVED');
    expect(order.totals.subtotal).toBe('19.84');

    // a re-weigh re-prices per pound too: 9.00 kg → 19.8416… lb × $1.50 = $29.7624 → $29.76
    await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 9, weighPoint: 'PLANT', source: 'plant' }, `weigh-lb-2-${orderId}`).expect(201);
    const reweighed = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(reweighed.totals.subtotal).toBe('29.76');

    const weight = (await get(`/v1/orders/${orderId}/weight`, 'plant').expect(200)).body;
    expect(weight.authoritativeWeightKg).toBe('9.00');
    expect(weight.captures).toHaveLength(2); // append-only: both kg captures retained
  });

  it('MIXED order (wash + rug): weigh the wash → FROM_MEASURED specialty makes the quote SENT (awaits customer), then the customer approves', async () => {
    const { orderId, itemIds } = await bookToInspected([
      { kind: 'GARMENT', serviceId: SVC_WF, measurements: { pieces: 1 } }, // wash — weight comes from the weigh
      { kind: 'RUG', serviceId: SVC_RUG, measurements: { sqft: 40 } }, // rug — measured at intake
    ]);

    const res = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 4, weighPoint: 'PLANT', itemId: itemIds[0] }, `weigh-${orderId}`).expect(201)).body;

    // the FIXED wash line is priced (4 × 3.50 = 14) and the rug (40 × 6 = 240) — subtotal 254 — but the
    // quote is SENT because a FROM_MEASURED specialty line requires customer approval.
    expect(res.pricing.status).toBe('quote_sent');
    expect(res.pricing.awaitsCustomerApproval).toBe(true);
    expect(res.pricing.orderStatus).toBe('QUOTED');

    // order is QUOTED with a SENT quote → the customer approves in the existing quote card → QUOTE_APPROVED
    let order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTED');
    expect(order.totals.subtotal).toBe('254.00'); // wash 4×$3.50=$14 + rug 40×$6=$240
    await post(`/v1/orders/${orderId}/quote:approve`, 'rita', { note: 'looks good' }).expect(200);
    order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTE_APPROVED');
  });

  it('[P5] re-quote after approval — a plant re-weigh of an APPROVED wash RE-PRICES + auto-re-approves (audited "re-priced on plant re-weigh")', async () => {
    const { orderId } = await bookToInspected([{ kind: 'GARMENT', serviceId: SVC_WF, measurements: { pieces: 1 } }]);
    // initial weigh → auto-priced + approved (6kg × $3.50 = $21.00)
    await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 6, weighPoint: 'PICKUP' }, `p5f-a-${orderId}`).expect(201);
    let order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTE_APPROVED');
    expect(order.totals.subtotal).toBe('21.00');

    // plant re-weighs HEAVIER → re-open (QUOTE_APPROVED → QUOTED) → re-price → auto-re-approve. No customer tap.
    const res = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 8, weighPoint: 'PLANT' }, `p5f-b-${orderId}`).expect(201)).body;
    expect(res.pricing.status).toBe('auto_approved');
    expect(res.pricing.orderStatus).toBe('QUOTE_APPROVED');
    order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTE_APPROVED');
    expect(order.totals.subtotal).toBe('28.00'); // 8kg × $3.50 — re-priced on the new authoritative weight

    const audit = await prisma.auditLog.findFirst({ where: { orgId: ORG1, entityId: orderId, action: 'STATUS_TRANSITION' }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(audit?.after)).toContain('re-priced on plant re-weigh');
    const weight = (await get(`/v1/orders/${orderId}/weight`, 'plant').expect(200)).body;
    expect(weight.authoritativeWeightKg).toBe('8.00');
    expect(weight.captures).toHaveLength(2); // both retained (append-only)
  });

  it('[P5] re-quote after approval — re-weighing a MIXED (specialty) order RE-OPENS the quote (→ QUOTED) for customer re-approval', async () => {
    const { orderId, itemIds } = await bookToInspected([
      { kind: 'GARMENT', serviceId: SVC_WF, measurements: { pieces: 1 } },
      { kind: 'RUG', serviceId: SVC_RUG, measurements: { sqft: 40 } },
    ]);
    // weigh wash 4kg → SENT (specialty) → customer approves → QUOTE_APPROVED
    await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 4, weighPoint: 'PLANT', itemId: itemIds[0] }, `p5m-a-${orderId}`).expect(201);
    await post(`/v1/orders/${orderId}/quote:approve`, 'rita', {}).expect(200);
    let order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTE_APPROVED');

    // plant re-weighs the wash heavier → because a FROM_MEASURED line is present, RE-OPEN for re-approval.
    const res = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 6, weighPoint: 'PLANT', itemId: itemIds[0] }, `p5m-b-${orderId}`).expect(201)).body;
    expect(res.pricing.status).toBe('quote_sent');
    expect(res.pricing.awaitsCustomerApproval).toBe(true);
    order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTED'); // re-opened
    expect(order.totals.subtotal).toBe('261.00'); // wash 6×$3.50=$21 + rug 40×$6=$240

    // the customer re-approves the new quote → QUOTE_APPROVED
    await post(`/v1/orders/${orderId}/quote:approve`, 'rita', {}).expect(200);
    order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTE_APPROVED');
  });

  it('[P6] FULL CHAIN: book from a card → weigh → auto-price at the catalog rate → visible on BOTH surfaces → re-weigh → re-price', async () => {
    // Phase 0 — an order booked from the Wash & Fold card references its backing Service (→ FIXED pricingModel).
    const { orderId } = await bookToInspected([{ kind: 'GARMENT', serviceId: SVC_WF, measurements: { pieces: 1 } }]);
    const lines = await prisma.orderLine.findMany({ where: { orderId }, select: { serviceId: true } });
    expect(lines[0]?.serviceId).toBe(SVC_WF); // the line carries the card's backing service

    // Weigh → auto-priced at the PUBLISHED CATALOG RATE ($3.50/kg × 6kg = $21.00) and approved (no fabricated price).
    const w = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 6, weighPoint: 'PICKUP' }, `fc-a-${orderId}`).expect(201)).body;
    expect(w.pricing.status).toBe('auto_approved');
    let order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.status).toBe('QUOTE_APPROVED');
    expect(order.totals.subtotal).toBe('21.00'); // traces to the founder-set catalog rate $3.50

    // VISIBLE ON BOTH SURFACES (REST source of truth): staff (dashboard) AND the owning customer read the weight.
    expect((await get(`/v1/orders/${orderId}/weight`, 'owner').expect(200)).body.authoritativeWeightKg).toBe('6.00'); // dashboard
    expect((await get(`/v1/orders/${orderId}/weight`, 'rita').expect(200)).body.authoritativeWeightKg).toBe('6.00'); // customer

    // Phase 5 — a plant re-weigh RE-PRICES the approved order; both surfaces see the new authoritative weight.
    const w2 = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 9, weighPoint: 'PLANT' }, `fc-b-${orderId}`).expect(201)).body;
    expect(w2.pricing.status).toBe('auto_approved');
    order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    expect(order.totals.subtotal).toBe('31.50'); // 9kg × $3.50 — re-priced
    expect((await get(`/v1/orders/${orderId}/weight`, 'owner').expect(200)).body.authoritativeWeightKg).toBe('9.00');
    expect((await get(`/v1/orders/${orderId}/weight`, 'rita').expect(200)).body.authoritativeWeightKg).toBe('9.00');
  });

  it('idempotency + re-weigh: same key → one capture; a NEW key → a NEW capture, old retained, authoritative = latest', async () => {
    const { orderId } = await bookToInspected([{ kind: 'GARMENT', serviceId: SVC_WF, measurements: { pieces: 1 } }]);
    const key = `weigh-idem-${orderId}`;

    const a = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 5, weighPoint: 'PICKUP' }, key).expect(201)).body;
    const b = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 5, weighPoint: 'PICKUP' }, key).expect(201)).body; // replay
    expect(b.capture.id).toBe(a.capture.id); // idempotent — same capture, no duplicate

    // A re-weigh with a NEW key writes a NEW append-only capture (order already QUOTE_APPROVED → not re-priced).
    const c = (await post(`/v1/orders/${orderId}/weigh`, 'plant', { weightKg: 7, weighPoint: 'PLANT' }, `${key}-plant`).expect(201)).body;
    expect(c.capture.id).not.toBe(a.capture.id);
    expect(c.authoritativeWeightKg).toBe('7.00');

    const weight = (await get(`/v1/orders/${orderId}/weight`, 'plant').expect(200)).body;
    expect(weight.captures).toHaveLength(2); // both retained (append-only)
    expect(weight.authoritativeWeightKg).toBe('7.00'); // most recent
    expect(weight.authoritativeWeighPoint).toBe('PLANT');
  });

  it('append-only: the DB trigger blocks UPDATE and DELETE of a WeightCapture', async () => {
    const cap = await prisma.weightCapture.findFirstOrThrow({ where: { orgId: ORG1 }, orderBy: { capturedAt: 'desc' } });
    await expect(prisma.weightCapture.update({ where: { id: cap.id }, data: { weightKg: '999.00' } })).rejects.toThrow();
    await expect(prisma.weightCapture.delete({ where: { id: cap.id } })).rejects.toThrow();
  });
});
