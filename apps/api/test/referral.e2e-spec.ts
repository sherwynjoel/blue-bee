import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { isReferralCodeShape } from '@blue-bee/shared';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';
import { ReferralService } from '../src/referral/referral.service';

/**
 * Referral e2e (Increment 34) — invite + code + attribution + console visibility. Reward is DEFERRED, so
 * nothing here grants or promises anything; this proves the ENGINE against the real Postgres:
 *
 *   • Code is minted on first read, STABLE thereafter, well-formed (the unambiguous alphabet), and UNIQUE
 *     per user. `shareUrl` is null with no configured deep-link base (never a fabricated domain).
 *   • Attribution (the reusable capture the Inc-35 signup path will call) records `referredByUserId` ONCE
 *     and is immutable (a second attempt is a no-op), writing exactly one immutable REFERRAL_ATTRIBUTED
 *     audit; and it NEVER errors on the not-attributable cases — unknown code, self-referral, malformed —
 *     it simply records nothing (so a real signup would still succeed).
 *   • The customer reads are row-scoped to self: a referrer sees who joined via THEIR code; a joiner sees
 *     none; each caller only ever gets their OWN code.
 *   • The console customer-360 surfaces the attribution (referred-by + referrals-made), read-only.
 *
 * The live signup endpoint that will pass an inbound code is Inc-35 (auth expansion); here the capture
 * service is exercised directly against the real DB — no stub. Cleanup mirrors account.e2e: the attributed
 * joiner becomes an audit actor and can't be hard-deleted, so it is neutralized; the others are removed.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';

const ACCT = 'ac340000-0000-4000-8000-0000000000a1';
const R = 'ac340000-0000-4000-8000-0000000000f1'; // referrer
const N1 = 'ac340000-0000-4000-8000-0000000000c1'; // joins via R's code (gets attributed)
const N2 = 'ac340000-0000-4000-8000-0000000000c2'; // used for self / unknown / malformed (never attributed)
const ROLE_R = 'ac340000-0000-4000-8000-0000000000e1';
const ROLE_N1 = 'ac340000-0000-4000-8000-0000000000e2';
const ROLE_N2 = 'ac340000-0000-4000-8000-0000000000e3';

const R_NAME = 'Inc34 Referrer';
const OWNER_PHONE = '+14165550001';

describe('Referral e2e — codes, attribution, row-scope, console (Inc-34)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let referrals: ReferralService;
  const token: Record<string, string> = {};

  const get = (path: string, who?: string) => {
    const req = request(app.getHttpServer()).get(path);
    if (who) req.set('Authorization', `Bearer ${token[who]}`);
    return req;
  };

  async function makeCustomer(id: string, roleId: string, name: string, phone: string): Promise<void> {
    // Created WITHOUT a referral_code so the endpoint/service mints it (proves the mint path).
    await prisma.user.upsert({
      where: { id },
      update: { orgId: ORG1, name, phone, status: 'ACTIVE', referralCode: null, referredByUserId: null },
      create: { id, orgId: ORG1, name, phone, status: 'ACTIVE', authProviders: ['otp'] },
    });
    await prisma.userRole.upsert({
      where: { id: roleId },
      update: {},
      create: { id: roleId, orgId: ORG1, userId: id, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: ACCT },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    referrals = app.get(ReferralService, { strict: false });
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);

    await prisma.userRole.deleteMany({ where: { userId: { in: [R, N1, N2] } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [R, N1, N2] } } });
    await prisma.user.updateMany({ where: { referredByUserId: { in: [R, N1, N2] } }, data: { referredByUserId: null } });
    await prisma.account.upsert({
      where: { id: ACCT },
      update: {},
      create: { id: ACCT, orgId: ORG1, type: 'RESIDENTIAL', name: 'Inc34 referral e2e account' },
    });
    await makeCustomer(R, ROLE_R, R_NAME, '+14165558811');
    await makeCustomer(N1, ROLE_N1, 'Inc34 Joiner One', '+14165558812');
    await makeCustomer(N2, ROLE_N2, 'Inc34 Joiner Two', '+14165558813');

    const sign = async (userId: string): Promise<string> => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const roles = await principals.loadGrants(userId);
      return tokens.signAccess(user, roles, await principals.deriveScope(roles));
    };
    token.R = await sign(R);
    token.N1 = await sign(N1);
    token.N2 = await sign(N2);
    const owner = await prisma.user.findFirstOrThrow({ where: { phone: OWNER_PHONE } });
    const ownerRoles = await principals.loadGrants(owner.id);
    token.owner = tokens.signAccess(owner, ownerRoles, await principals.deriveScope(ownerRoles));
  }, 60000);

  afterAll(async () => {
    await prisma.userRole.deleteMany({ where: { userId: { in: [R, N1, N2] } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [R, N1, N2] } } });
    await prisma.user.updateMany({ where: { referredByUserId: { in: [R, N1, N2] } }, data: { referredByUserId: null } });
    // R + N2 never acted → hard-delete. N1 is an audit actor (REFERRAL_ATTRIBUTED) → neutralize in place.
    await prisma.user.deleteMany({ where: { id: { in: [R, N2] } } });
    await prisma.user
      .update({ where: { id: N1 }, data: { status: 'SUSPENDED', email: null, phone: null, referralCode: null, referredByUserId: null, name: 'Inc34 referral e2e (retired)' } })
      .catch(() => undefined);
    await prisma.account.deleteMany({ where: { id: ACCT } });
    await prisma.$disconnect();
    await app.close();
  });

  it('requires auth — GET /v1/account/referral without a token → 401', async () => {
    await get('/v1/account/referral').expect(401);
  });

  it('mints a stable, well-formed, unique code (and null shareUrl with no base configured)', async () => {
    const a = await get('/v1/account/referral', 'R').expect(200);
    const b = await get('/v1/account/referral', 'R').expect(200);
    expect(a.body.code).toBe(b.body.code); // stable across reads
    expect(isReferralCodeShape(a.body.code)).toBe(true); // unambiguous alphabet, right length
    expect(a.body.shareUrl).toBeNull(); // no configured deep-link base → no fabricated domain

    const n1 = await get('/v1/account/referral', 'N1').expect(200);
    expect(n1.body.code).not.toBe(a.body.code); // unique per user
  });

  it('captures attribution ONCE (immutable) and NEVER errors on self / unknown / malformed', async () => {
    const rCode = await referrals.ensureCode(R, ORG1);
    // Audit rows are append-only (immortal across runs), so assert on the DELTA, not an absolute count.
    const auditWhere = { entity: 'User', entityId: N1, action: 'REFERRAL_ATTRIBUTED' } as const;
    const auditsBefore = await prisma.auditLog.count({ where: auditWhere });

    // Valid inbound code → attribution recorded + exactly one new audit row, attributed to the joiner.
    const first = await referrals.attributeReferral(N1, ORG1, rCode);
    expect(first).toEqual({ attributed: true, referrerId: R });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: N1 } })).referredByUserId).toBe(R);
    expect(await prisma.auditLog.count({ where: auditWhere })).toBe(auditsBefore + 1);
    const latest = await prisma.auditLog.findFirst({ where: auditWhere, orderBy: { at: 'desc' } });
    expect(latest!.actorId).toBe(N1);

    // Immutable — a second attempt is a no-op, and NO further audit row is written.
    const second = await referrals.attributeReferral(N1, ORG1, rCode);
    expect(second.attributed).toBe(false);
    expect(await prisma.auditLog.count({ where: auditWhere })).toBe(auditsBefore + 1);

    // Unknown (well-formed but unused) code → no attribution, no throw.
    expect((await referrals.attributeReferral(N2, ORG1, 'ZZZZ9999')).attributed).toBe(false);
    // Self-referral (own code) → no attribution.
    const n2Code = await referrals.ensureCode(N2, ORG1);
    expect((await referrals.attributeReferral(N2, ORG1, n2Code)).attributed).toBe(false);
    // Malformed / empty → no attribution.
    expect((await referrals.attributeReferral(N2, ORG1, 'nope')).attributed).toBe(false);
    expect((await referrals.attributeReferral(N2, ORG1, null)).attributed).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: N2 } })).referredByUserId).toBeNull();
  });

  it('is row-scoped: the referrer sees the joiner; the joiner sees none; codes never cross', async () => {
    const rRefs = await get('/v1/account/referrals', 'R').expect(200);
    expect(rRefs.body.count).toBeGreaterThanOrEqual(1);
    expect(rRefs.body.joiners.some((j: { userId: string }) => j.userId === N1)).toBe(true);

    const n1Refs = await get('/v1/account/referrals', 'N1').expect(200);
    expect(n1Refs.body.count).toBe(0); // N1 referred no one

    const rCode = (await get('/v1/account/referral', 'R').expect(200)).body.code;
    const n1Code = (await get('/v1/account/referral', 'N1').expect(200)).body.code;
    expect(rCode).not.toBe(n1Code); // each caller only ever gets their OWN code
  });

  it('surfaces attribution in the console customer-360 (referred-by + referrals-made), read-only', async () => {
    const n1View = await get(`/v1/admin/customers/${N1}`, 'owner').expect(200);
    expect(n1View.body.referral.referredBy).toMatchObject({ userId: R, name: R_NAME });
    expect(typeof n1View.body.referral.code).toBe('string');

    const rView = await get(`/v1/admin/customers/${R}`, 'owner').expect(200);
    expect(rView.body.referral.referralsMadeCount).toBeGreaterThanOrEqual(1);
    expect(rView.body.referral.referredBy).toBeNull(); // R was referred by no one
  });
});
