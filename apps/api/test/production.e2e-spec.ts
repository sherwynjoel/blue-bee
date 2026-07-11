import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

// ── Seeded ids (must match prisma/seed.ts; mirrors orders.e2e-spec.ts) ──
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const SERVICE = '66666666-6666-4666-8666-666666666666';
const ORDER_O2 = 'e0000000-0000-4000-8000-0000000000c1'; // Org-2 order (cross-org target)

const PHONES = {
  owner: '+14165550001',
  dispatcher: '+14165550002',
  csr: '+14165550003',
  plant: '+14165550004', // PLANT_OP
  finance: '+14165550005',
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
};

/**
 * Inc-30 — production advance, proven end-to-end against the real (seeded) Postgres. This is the §5.1
 * back-half that shipped as dead enum: no service ever moved an order past QUOTE_APPROVED. Here the plant
 * drives QUOTE_APPROVED → IN_CLEANING → QC → READY (+ the REWASH branch), each a real atomic, audited
 * OrderStateMachine transition. We assert the Order.status in the DB, a matching AuditLog row, the illegal
 * jumps (409), the RBAC matrix (403), cross-org (404), and the concurrent-advance race (one 200 / one 409).
 */
describe('Production advance e2e — Increment 30 (/v1/orders/:id/{start-cleaning,send-to-qc,qc,rewash} · §5.1)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const userId: Record<string, string> = {};

  const futureWindow = () => ({
    start: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    end: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  });

  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

  const bookItem = (over: Record<string, unknown> = {}) => ({ kind: 'RUG', serviceId: SERVICE, estimatedMeasure: 40, ...over });
  function book(who: string, accountId = ACCOUNT_A) {
    return post('/v1/orders', who, { accountId, pickupWindow: futureWindow(), items: [bookItem()] });
  }

  /** Drive an order book → QUOTED as staff (mirrors orders.e2e-spec.ts). */
  async function driveToQuoted(orderId: string) {
    await post(`/v1/orders/${orderId}/schedule-pickup`, 'owner', { pickupWindow: futureWindow() }).expect(200);
    await post(`/v1/orders/${orderId}/received-at-plant`, 'owner', {}).expect(200);
    const order = (await get(`/v1/orders/${orderId}`, 'owner').expect(200)).body;
    for (const item of order.items) {
      await post(`/v1/orders/${orderId}/items/${item.id}/inspection`, 'plant', {
        conditionCodes: ['MINOR_FRINGE_WEAR'],
        measurements: { sqft: 40 },
      }).expect(201);
    }
    await post(`/v1/orders/${orderId}/quote`, 'csr', {}).expect(201);
  }

  /** Drive an order all the way to QUOTE_APPROVED (the state production advance starts from). */
  async function driveToApproved(orderId: string) {
    await driveToQuoted(orderId);
    await post(`/v1/orders/${orderId}/quote:approve`, 'owner', {}).expect(200);
  }

  /** Book a fresh order and drive it to QUOTE_APPROVED. Returns its id. */
  async function approvedOrder(): Promise<string> {
    const id = (await book('owner').expect(201)).body.id;
    await driveToApproved(id);
    return id;
  }

  const dbStatus = async (orderId: string): Promise<string> =>
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

  /** Assert an audited STATUS_TRANSITION row exists for the order landing in `toStatus`. */
  async function expectAudit(orderId: string, toStatus: string): Promise<void> {
    const audit = await prisma.auditLog.findFirst({
      where: {
        entity: 'Order',
        entityId: orderId,
        action: 'STATUS_TRANSITION',
        after: { path: ['status'], equals: toStatus },
      },
    });
    expect(audit).toBeTruthy();
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
      userId[name] = user.id;
    }
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  // ───────────────────────── happy path — QUOTE_APPROVED → IN_CLEANING → QC → READY ─────────────────────────

  it('drives QUOTE_APPROVED → IN_CLEANING → QC → READY, each a real audited transition (DB + AuditLog)', async () => {
    const id = await approvedOrder();

    const c = await post(`/v1/orders/${id}/start-cleaning`, 'plant', {}).expect(200);
    expect(c.body.status).toBe('IN_CLEANING');
    expect(await dbStatus(id)).toBe('IN_CLEANING');
    await expectAudit(id, 'IN_CLEANING');

    const q = await post(`/v1/orders/${id}/send-to-qc`, 'plant', {}).expect(200);
    expect(q.body.status).toBe('QC');
    expect(await dbStatus(id)).toBe('QC');
    await expectAudit(id, 'QC');

    const r = await post(`/v1/orders/${id}/qc`, 'plant', { result: 'pass' }).expect(200);
    expect(r.body.status).toBe('READY');
    expect(await dbStatus(id)).toBe('READY');
    await expectAudit(id, 'READY');
  });

  // ───────────────────────── rewash branch (QC failures are real) ─────────────────────────

  it('QC fail → REWASH → restart cleaning → IN_CLEANING (the rewash branch, with an audited reason)', async () => {
    const id = await approvedOrder();
    await post(`/v1/orders/${id}/start-cleaning`, 'plant', {}).expect(200);
    await post(`/v1/orders/${id}/send-to-qc`, 'plant', {}).expect(200);

    // a QC failure without a reason is rejected (accountability — no silent bounce)
    await post(`/v1/orders/${id}/qc`, 'plant', { result: 'fail' }).expect(400);

    const fail = await post(`/v1/orders/${id}/qc`, 'plant', { result: 'fail', reason: 'fringe still soiled' }).expect(200);
    expect(fail.body.status).toBe('REWASH');
    expect(await dbStatus(id)).toBe('REWASH');
    await expectAudit(id, 'REWASH');

    const restart = await post(`/v1/orders/${id}/start-cleaning`, 'plant', {}).expect(200);
    expect(restart.body.status).toBe('IN_CLEANING');
    expect(await dbStatus(id)).toBe('IN_CLEANING');
  });

  it('rewash pulled mid-cleaning: IN_CLEANING → REWASH → restart (a reason is required)', async () => {
    const id = await approvedOrder();
    await post(`/v1/orders/${id}/start-cleaning`, 'plant', {}).expect(200);

    await post(`/v1/orders/${id}/rewash`, 'plant', {}).expect(400); // reason required
    const rw = await post(`/v1/orders/${id}/rewash`, 'plant', { reason: 'spot re-treat' }).expect(200);
    expect(rw.body.status).toBe('REWASH');
    await expectAudit(id, 'REWASH');
    await post(`/v1/orders/${id}/start-cleaning`, 'plant', {}).expect(200); // restart is legal
  });

  // ───────────────────────── illegal transitions (state machine guards) ─────────────────────────

  it('rejects illegal production jumps with 409 (the machine enforces §5.1, not the client)', async () => {
    // start-cleaning before the quote is approved (order is at QUOTED)
    const quoted = (await book('owner').expect(201)).body.id;
    await driveToQuoted(quoted);
    const bad = await post(`/v1/orders/${quoted}/start-cleaning`, 'plant', {}).expect(409);
    expect(bad.headers['content-type']).toContain('application/problem+json');
    expect(bad.body.title).toBe('illegal_transition');
    expect(await dbStatus(quoted)).toBe('QUOTED'); // untouched

    // qc before the order is at QC (it is only IN_CLEANING) → illegal
    const id = await approvedOrder();
    await post(`/v1/orders/${id}/start-cleaning`, 'plant', {}).expect(200);
    await post(`/v1/orders/${id}/qc`, 'plant', { result: 'pass' }).expect(409);
    // send-to-qc before cleaning has started → illegal
    const fresh = await approvedOrder();
    await post(`/v1/orders/${fresh}/send-to-qc`, 'plant', {}).expect(409);
  });

  // ───────────────────────── RBAC (§17.3) + cross-org scoping ─────────────────────────

  it('RBAC: only OWNER/CSR/PLANT_OP may drive production; cross-org order → 404', async () => {
    const id = await approvedOrder();
    await post(`/v1/orders/${id}/start-cleaning`, 'plant', {}).expect(200);
    await post(`/v1/orders/${id}/send-to-qc`, 'plant', {}).expect(200);

    // FINANCE (org-wide read, not a production role) → 403 forbidden_role
    const f = await post(`/v1/orders/${id}/qc`, 'finance', { result: 'pass' }).expect(403);
    expect(f.body.title).toBe('forbidden_role');
    // DISPATCHER and the RESIDENTIAL_CUSTOMER cannot drive plant work either
    await post(`/v1/orders/${id}/qc`, 'dispatcher', { result: 'pass' }).expect(403);
    await post(`/v1/orders/${id}/qc`, 'rita', { result: 'pass' }).expect(403);
    // ...and the CSR (a legitimate production role) still succeeds
    const ok = await post(`/v1/orders/${id}/qc`, 'csr', { result: 'pass' }).expect(200);
    expect(ok.body.status).toBe('READY');

    // Cross-org: an Org-1 CSR advancing an Org-2 order → 404 (no existence leak)
    const x = await post(`/v1/orders/${ORDER_O2}/start-cleaning`, 'csr', {}).expect(404);
    expect(x.body.title).toBe('order_not_found');
  });

  // ───────────────────────── concurrent advance race (atomic conditional update) ─────────────────────────

  it('concurrent start-cleaning on one approved order: exactly one 200, one 409', async () => {
    const id = await approvedOrder();
    const results = await Promise.all([
      post(`/v1/orders/${id}/start-cleaning`, 'plant', {}),
      post(`/v1/orders/${id}/start-cleaning`, 'plant', {}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await dbStatus(id)).toBe('IN_CLEANING');
  });
});
