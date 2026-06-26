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
