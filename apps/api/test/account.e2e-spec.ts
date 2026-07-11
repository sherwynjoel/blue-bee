import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Account self-deletion e2e (launch-scaffolding) — proves the store-rejection-blocker endpoint
 * `DELETE /v1/account` is REAL, not a fake button. It proves:
 *   • Auth required — no bearer token → 401 (global JwtAuthGuard).
 *   • Self-only — A's token with a body targeting user B → 403, and B is left fully intact.
 *   • Real erasure — A's PII children are purged (refresh tokens, device tokens, devices,
 *     notifications, notification prefs, roles), the Driver license (PII) is scrubbed, and the User
 *     row is anonymized in place (name → "Deleted user", email/phone → null, authProviders → [],
 *     status → SUSPENDED). before/after evidence is asserted against the live DB.
 *   • Audited — an immutable ACCOUNT_DELETED AuditLog is written, attributed to the user, with NO PII
 *     in its payload.
 *   • Audit-trail preserved — the user is anonymized, NOT hard-deleted, so a pre-existing audit row
 *     that references A as actor keeps its actorId (a hard delete would have hit the append-only
 *     trigger via the ON DELETE SET NULL FK). This is the whole reason the policy anonymizes.
 *
 * Cleanup note: once A self-deletes it becomes an audit actor (the ACCOUNT_DELETED row + the
 * pre-existing fixture row), so A can NEVER be hard-deleted (SET-NULL on append-only AuditLog aborts).
 * We therefore reset A via upsert in beforeAll and leave it anonymized in afterAll. B is never an audit
 * actor, so it is hard-deleted normally.
 */

const ORG1 = '11111111-1111-4111-8111-111111111111'; // seeded demo org (same as admin.e2e)
const USER_A = 'a1000000-0000-4000-8000-000000000a01'; // self-deleting fixture user
const USER_B = 'a1000000-0000-4000-8000-000000000b02'; // 403 target (never deleted by the endpoint)
const PRIOR_AUDIT_ENTITY = 'a1000000-0000-4000-8000-00000000ad01'; // entityId of A's pre-existing audit row

const A_EMAIL = 'account-a@bluebee.example';
const A_PHONE = '+14165557701';
const A_NAME = 'Account A Person';
const A_LICENSE = 'DL-SECRET-A-12345';
const B_EMAIL = 'account-b@bluebee.example';
const B_PHONE = '+14165557702';

describe('Account self-deletion e2e — DELETE /v1/account (launch-scaffolding)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let tokenA = '';

  const del = (who?: string, body: unknown = {}) => {
    const req = request(app.getHttpServer()).delete('/v1/account');
    if (who) req.set('Authorization', `Bearer ${who}`);
    return req.send(body as object);
  };

  /** Delete every recreatable child row for A and B (none are append-only). */
  async function purgeChildren(): Promise<void> {
    const users = [USER_A, USER_B];
    await prisma.refreshToken.deleteMany({ where: { userId: { in: users } } });
    await prisma.deviceToken.deleteMany({ where: { userId: { in: users } } });
    await prisma.device.deleteMany({ where: { userId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: users } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
    await prisma.message.deleteMany({ where: { fromUserId: { in: users } } });
    await prisma.driver.deleteMany({ where: { userId: { in: users } } });
  }

  async function makeFixtureUser(id: string, name: string, email: string, phone: string): Promise<void> {
    const data = { orgId: ORG1, name, email, phone, status: 'ACTIVE' as const, authProviders: ['otp'] };
    await prisma.user.upsert({ where: { id }, update: data, create: { id, ...data } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);

    await purgeChildren();
    await makeFixtureUser(USER_A, A_NAME, A_EMAIL, A_PHONE);
    await makeFixtureUser(USER_B, 'Account B Person', B_EMAIL, B_PHONE);

    // A's PII children + a driver (license PII) + a sent message + a refresh-token session.
    await prisma.userRole.create({ data: { orgId: ORG1, userId: USER_A, role: 'RESIDENTIAL_CUSTOMER' } });
    await prisma.refreshToken.create({
      data: {
        orgId: ORG1,
        userId: USER_A,
        familyId: 'a1000000-0000-4000-8000-00000000fa01',
        tokenHash: `acct-a-refresh-${USER_A}`,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    });
    await prisma.deviceToken.create({
      data: { orgId: ORG1, userId: USER_A, platform: 'IOS', token: `ExponentPushToken[ACCT_A_${USER_A}]` },
    });
    await prisma.device.create({ data: { orgId: ORG1, userId: USER_A, platform: 'IOS', pushToken: 'acct-a-device' } });
    await prisma.notification.create({
      data: {
        orgId: ORG1,
        userId: USER_A,
        eventType: 'TEST',
        channel: 'PUSH',
        status: 'PENDING',
        dedupeKey: `acct-a-fixture-${USER_A}`,
      },
    });
    await prisma.notificationPreference.create({ data: { orgId: ORG1, userId: USER_A } });
    await prisma.driver.create({ data: { orgId: ORG1, userId: USER_A, license: A_LICENSE } });
    await prisma.message.create({
      data: {
        orgId: ORG1,
        threadId: 'a1000000-0000-4000-8000-00000000c001',
        fromUserId: USER_A,
        body: 'Operational message from A (retained as a business record).',
        channel: 'IN_APP',
      },
    });
    // A pre-existing immutable audit row that names A as ACTOR — this is exactly what makes a hard
    // delete impossible, and what the anonymize policy preserves.
    await prisma.auditLog.create({
      data: {
        orgId: ORG1,
        actorId: USER_A,
        entity: 'Order',
        entityId: PRIOR_AUDIT_ENTITY,
        action: 'FIXTURE_PRIOR_ACTION',
        createdBy: USER_A,
      },
    });

    const aUser = await prisma.user.findUniqueOrThrow({ where: { id: USER_A } });
    const aRoles = await principals.loadGrants(USER_A);
    const aScope = await principals.deriveScope(aRoles);
    tokenA = tokens.signAccess(aUser, aRoles, aScope);
  }, 60000);

  afterAll(async () => {
    await purgeChildren();
    // B is never an audit actor → safe to hard-delete. A is an audit actor → leave it anonymized.
    await prisma.user.deleteMany({ where: { id: USER_B } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /v1/health is 200 — the app boots with AccountModule wired in', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('requires auth — no bearer token → 401', async () => {
    await del(undefined).expect(401);
  });

  it('is self-only — A targeting B → 403, and B is left fully intact', async () => {
    await del(tokenA, { userId: USER_B }).expect(403);

    const b = await prisma.user.findUniqueOrThrow({ where: { id: USER_B } });
    expect(b.email).toBe(B_EMAIL);
    expect(b.phone).toBe(B_PHONE);
    expect(b.status).toBe('ACTIVE');

    // A must also still be intact (the failed cross-user attempt wrote nothing).
    const a = await prisma.user.findUniqueOrThrow({ where: { id: USER_A } });
    expect(a.email).toBe(A_EMAIL);
    expect(a.status).toBe('ACTIVE');
  });

  it('deletes self — purges PII children, scrubs driver license, anonymizes the user row, audited', async () => {
    const res = await del(tokenA, {}).expect(200);

    // Response is a non-PII evidence summary.
    expect(res.body).toMatchObject({ status: 'deleted', userId: USER_A, anonymized: true, driversScrubbed: 1 });
    expect(res.body.removed.refreshTokens).toBeGreaterThanOrEqual(1);
    expect(res.body.removed.deviceTokens).toBeGreaterThanOrEqual(1);
    expect(res.body.removed.devices).toBeGreaterThanOrEqual(1);
    expect(res.body.removed.notifications).toBeGreaterThanOrEqual(1);
    expect(res.body.removed.notificationPreferences).toBeGreaterThanOrEqual(1);
    expect(res.body.removed.roles).toBeGreaterThanOrEqual(1);

    // The user row is anonymized IN PLACE (still exists — proves anonymize, not hard-delete).
    const a = await prisma.user.findUniqueOrThrow({ where: { id: USER_A } });
    expect(a.name).toBe('Deleted user');
    expect(a.email).toBeNull();
    expect(a.phone).toBeNull();
    expect(a.authProviders).toEqual([]);
    expect(a.status).toBe('SUSPENDED');

    // PII children are gone.
    expect(await prisma.refreshToken.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.deviceToken.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.device.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.notificationPreference.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: USER_A } })).toBe(0);

    // Driver row retained (business record) but its license PII is scrubbed.
    const driver = await prisma.driver.findFirstOrThrow({ where: { userId: USER_A } });
    expect(driver.license).toBeNull();

    // An immutable ACCOUNT_DELETED audit entry exists, attributed to the user, with NO PII.
    const deletedAudit = await prisma.auditLog.findFirst({
      where: { entity: 'User', entityId: USER_A, action: 'ACCOUNT_DELETED' },
      orderBy: { at: 'desc' },
    });
    expect(deletedAudit).not.toBeNull();
    expect(deletedAudit!.actorId).toBe(USER_A);
    const auditJson = JSON.stringify({ before: deletedAudit!.before, after: deletedAudit!.after });
    expect(auditJson).not.toContain(A_EMAIL);
    expect(auditJson).not.toContain(A_PHONE);
    expect(auditJson).not.toContain(A_NAME);
    expect(auditJson).not.toContain(A_LICENSE);

    // The pre-existing audit row STILL references A (preserved — a hard delete would have nulled/aborted it).
    const prior = await prisma.auditLog.findMany({ where: { entityId: PRIOR_AUDIT_ENTITY } });
    expect(prior.length).toBeGreaterThanOrEqual(1);
    expect(prior.every((row) => row.actorId === USER_A)).toBe(true);
  });
});

/**
 * Account profile edit e2e — PATCH /v1/account/profile (Inc-33). Proves the ONE new backend piece of the
 * nav-shell increment is REAL, self-only, org-scoped, and connected to the console:
 *   • Auth required — no bearer token → 401.
 *   • Self-only — C's token with a body targeting user D → 403 (forbidden_self_only); nothing is written.
 *   • Org-scope (defense-in-depth) — a token whose `org_id` claim ≠ the user's real org → 404
 *     (account_not_found): the endpoint never edits a row outside the caller's tenant.
 *   • Validation — a malformed email → 400 (validation_failed), no write.
 *   • Email uniqueness — C setting an email already held by D in the same org → 409 (email_taken); the
 *     `@@unique([orgId, email])` guarantee, surfaced as a friendly conflict, not a 500.
 *   • Real update — C edits name + email; the response + the live DB row carry the new values, email is
 *     normalized (trimmed + lower-cased), and a single immutable PROFILE_UPDATED AuditLog attributes the
 *     change to C with before/after.
 *   • Connected — reading C's console customer-360 (`GET /v1/admin/customers/:id`, OWNER) returns the
 *     SAME updated name/email (Inc-27 reads the very row this endpoint wrote — one source of truth).
 *   • Clear — C can remove the email (→ null), proving the nullable path + that multiple null emails are
 *     fine under the composite unique index.
 *
 * Cleanup: once C is edited it becomes an audit actor (PROFILE_UPDATED), so — exactly like USER_A above —
 * it can never be hard-deleted (the append-only AuditLog + ON DELETE SET NULL FK abort it). afterAll
 * therefore NEUTRALIZES C (drop role, suspend, null its contact fields) so it is re-runnable and never
 * lingers as a live customer; D (never an audit actor) is hard-deleted.
 */
describe('Account profile edit e2e — PATCH /v1/account/profile (Inc-33)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  const ORG2 = 'e0000000-0000-4000-8000-000000000002'; // a DIFFERENT org (need not exist) — org-scope probe
  const USER_C = 'ac330000-0000-4000-8000-0000000000c1'; // the self-editing customer
  const USER_D = 'ac330000-0000-4000-8000-0000000000d2'; // holds the email C will collide with
  const ACCT_C = 'ac330000-0000-4000-8000-0000000000a1'; // C's residential account (so the 360 read resolves)
  const ROLE_C = 'ac330000-0000-4000-8000-0000000000e1';
  const ROLE_D = 'ac330000-0000-4000-8000-0000000000e2';

  const C_NAME = 'Inc33 C Original';
  const C_EMAIL = 'inc33-c@bluebee.example';
  const C_PHONE = '+14165558801';
  const D_EMAIL = 'inc33-d@bluebee.example';
  const D_PHONE = '+14165558802';
  const NEW_NAME = 'Inc33 C Renamed';
  const NEW_EMAIL_MIXED = 'Inc33.C.New@BlueBee.Example';
  const NEW_EMAIL_NORM = 'inc33.c.new@bluebee.example';
  const OWNER_PHONE = '+14165550001'; // seeded ORG1 owner (reads the console customer-360)

  let tokenC = '';
  let tokenCWrongOrg = '';
  let ownerToken = '';

  const patch = (who: string | undefined, body: unknown) => {
    const req = request(app.getHttpServer()).patch('/v1/account/profile');
    if (who) req.set('Authorization', `Bearer ${who}`);
    return req.send(body as object);
  };

  async function upsertUser(id: string, name: string, email: string, phone: string): Promise<void> {
    const data = { orgId: ORG1, name, email, phone, status: 'ACTIVE' as const, authProviders: ['otp'] };
    await prisma.user.upsert({ where: { id }, update: data, create: { id, ...data } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);

    // Clean any residue from a prior run, then seed C, D + C's account & customer roles.
    await prisma.userRole.deleteMany({ where: { userId: { in: [USER_C, USER_D] } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [USER_C, USER_D] } } });
    await prisma.account.upsert({
      where: { id: ACCT_C },
      update: {},
      create: { id: ACCT_C, orgId: ORG1, type: 'RESIDENTIAL', name: 'Inc33 profile e2e account' },
    });
    await upsertUser(USER_C, C_NAME, C_EMAIL, C_PHONE);
    await upsertUser(USER_D, 'Inc33 D Person', D_EMAIL, D_PHONE);
    await prisma.userRole.create({ data: { id: ROLE_C, orgId: ORG1, userId: USER_C, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: ACCT_C } });
    await prisma.userRole.create({ data: { id: ROLE_D, orgId: ORG1, userId: USER_D, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: ACCT_C } });

    const cUser = await prisma.user.findUniqueOrThrow({ where: { id: USER_C } });
    const cRoles = await principals.loadGrants(USER_C);
    const cScope = await principals.deriveScope(cRoles);
    tokenC = tokens.signAccess(cUser, cRoles, cScope);
    // Same subject, but the token claims a DIFFERENT org — the service must not find C's row there → 404.
    tokenCWrongOrg = tokens.signAccess({ ...cUser, orgId: ORG2 }, cRoles, cScope);

    const owner = await prisma.user.findFirstOrThrow({ where: { phone: OWNER_PHONE } });
    const ownerRoles = await principals.loadGrants(owner.id);
    ownerToken = tokens.signAccess(owner, ownerRoles, await principals.deriveScope(ownerRoles));
  }, 60000);

  afterAll(async () => {
    await prisma.userRole.deleteMany({ where: { userId: { in: [USER_C, USER_D] } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [USER_C, USER_D] } } });
    // D never acted → hard-delete. C is an audit actor (PROFILE_UPDATED) → neutralize in place.
    await prisma.user.deleteMany({ where: { id: USER_D } });
    await prisma.user
      .update({ where: { id: USER_C }, data: { status: 'SUSPENDED', email: null, phone: null, name: 'Inc33 profile e2e (retired)' } })
      .catch(() => undefined);
    await prisma.account.deleteMany({ where: { id: ACCT_C } });
    await prisma.$disconnect();
    await app.close();
  });

  it('requires auth — no bearer token → 401', async () => {
    await patch(undefined, { name: 'Nope' }).expect(401);
  });

  it('is self-only — C targeting D → 403, and neither C nor D is touched', async () => {
    await patch(tokenC, { userId: USER_D, name: 'Hijacked', email: 'attacker@bluebee.example' }).expect(403);

    const c = await prisma.user.findUniqueOrThrow({ where: { id: USER_C } });
    const d = await prisma.user.findUniqueOrThrow({ where: { id: USER_D } });
    expect(c.name).toBe(C_NAME);
    expect(c.email).toBe(C_EMAIL);
    expect(d.name).toBe('Inc33 D Person');
    expect(d.email).toBe(D_EMAIL);
  });

  it('is org-scoped — a token claiming another org → 404, C untouched', async () => {
    const res = await patch(tokenCWrongOrg, { name: 'From Nowhere' }).expect(404);
    expect(res.body.title).toBe('account_not_found');
    const c = await prisma.user.findUniqueOrThrow({ where: { id: USER_C } });
    expect(c.name).toBe(C_NAME);
  });

  it('validates the email — a malformed address → 400, nothing written', async () => {
    await patch(tokenC, { email: 'not-an-email' }).expect(400);
    const c = await prisma.user.findUniqueOrThrow({ where: { id: USER_C } });
    expect(c.email).toBe(C_EMAIL);
  });

  it('enforces per-org email uniqueness — C taking D’s email → 409 email_taken, C untouched', async () => {
    const res = await patch(tokenC, { email: D_EMAIL }).expect(409);
    expect(res.body.title).toBe('email_taken');
    const c = await prisma.user.findUniqueOrThrow({ where: { id: USER_C } });
    expect(c.email).toBe(C_EMAIL);
  });

  it('updates name + email — normalized, persisted, and audited (PROFILE_UPDATED)', async () => {
    const res = await patch(tokenC, { name: `  ${NEW_NAME}  `, email: NEW_EMAIL_MIXED }).expect(200);

    // Response is the profile view with the SERVER-normalized values (name trimmed, email lower-cased).
    expect(res.body).toMatchObject({ id: USER_C, name: NEW_NAME, email: NEW_EMAIL_NORM, phone: C_PHONE });

    // Live DB row reflects it.
    const c = await prisma.user.findUniqueOrThrow({ where: { id: USER_C } });
    expect(c.name).toBe(NEW_NAME);
    expect(c.email).toBe(NEW_EMAIL_NORM);
    expect(c.phone).toBe(C_PHONE); // phone untouched (login identity)

    // Exactly one immutable audit entry, attributed to C, carrying before/after.
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'User', entityId: USER_C, action: 'PROFILE_UPDATED' },
      orderBy: { at: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(USER_C);
    expect(audit!.before).toMatchObject({ name: C_NAME, email: C_EMAIL });
    expect(audit!.after).toMatchObject({ name: NEW_NAME, email: NEW_EMAIL_NORM });
  });

  it('connects to the console customer-360 — OWNER read reflects the new name/email (Inc-27)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/admin/customers/${USER_C}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body.customer.name).toBe(NEW_NAME);
    expect(res.body.customer.email).toBe(NEW_EMAIL_NORM);
  });

  it('clears the email — an empty value sets it to null (removable, nullable-unique safe)', async () => {
    const res = await patch(tokenC, { email: '' }).expect(200);
    expect(res.body.email).toBeNull();
    const c = await prisma.user.findUniqueOrThrow({ where: { id: USER_C } });
    expect(c.email).toBeNull();
    expect(c.name).toBe(NEW_NAME); // name unchanged by an email-only patch
  });
});
