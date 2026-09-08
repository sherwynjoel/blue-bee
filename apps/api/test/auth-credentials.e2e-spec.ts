import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type Redis from 'ioredis';
import { createTestApp } from './app.factory';
import { REDIS } from '../src/redis/redis.module';
import { OAUTH_VERIFIER, type OAuthVerifier } from '../src/auth/oauth/oauth-verifier';

/**
 * Login-expansion e2e (Increment 35) — email+password + Apple/Google ALONGSIDE phone-OTP, all resolving to
 * ONE account, against the real Postgres + Redis. Proves per method:
 *   • Email register (mints the account, hashes the password, issues the SAME session as OTP) → login →
 *     verify-email → password-reset; wrong-password LOCKOUT; the `000000` OTP bypass does NOT work here.
 *   • OAuth: the provider ID token is verified SERVER-SIDE (a fake verifier is injected — same seam as the
 *     geocoder — so link/dedupe is testable offline); create-on-first-sign-in, dedupe-by-verified-email,
 *     and the pre-hijack clear (an unverified password is wiped when a provider later proves the email).
 *   • Cross-method resolution: password + Google + Apple on one verified email → one account, all linked.
 *   • Registration is the referral capture point: a valid code attributes once; unknown/none never fail
 *     the signup.
 *
 * The email transport is `console` in test, so verify/reset tokens are echoed as `devToken` (like the OTP
 * `devCode`) — never in production. Users created here become audit actors (AUTH_REGISTER) and so can't be
 * hard-deleted; cleanup frees their emails + removes roles/accounts and neutralizes the rows.
 */
const ORG1 = '11111111-1111-4111-8111-111111111111';
const DOMAIN = '@inc35.example'; // letters-only TLD (zod .email() rejects digit TLDs like `.e2e`)
const REFERRER = 'ac350000-0000-4000-8000-0000000000f1';
const REFERRER_ROLE = 'ac350000-0000-4000-8000-0000000000e1';
const REFERRER_ACCT = 'ac350000-0000-4000-8000-0000000000a1';
const REFERRER_CODE = 'REFKMNP2'; // valid unambiguous-alphabet code (no 0/O/1/I/L)

// Fake provider token format the injected verifier understands: "sub|email|v" (verified) or "sub|email|u".
const tok = (sub: string, email: string, verified = true): string => `${sub}|${email}|${verified ? 'v' : 'u'}`;

const fakeVerifier: OAuthVerifier = {
  async verify(_provider, idToken) {
    const [subject, email, flag] = idToken.split('|');
    return { subject: subject ?? 'sub', email: email || null, emailVerified: flag === 'v' };
  },
};

describe('Auth login-expansion e2e — email+password + Apple/Google (Inc-35)', () => {
  let app: INestApplication;
  let redis: Redis;
  const prisma = new PrismaClient();

  /** Clear the Redis login rate-limit/lockout keys for an email (survives prior runs' 15-min lockouts). */
  const clearLoginLimits = (email: string) => redis.del(`cred:login:fail:${email}`, `cred:login:lock:${email}`);

  const post = (path: string, body: unknown, bearer?: string) => {
    const r = request(app.getHttpServer()).post(path);
    if (bearer) r.set('Authorization', `Bearer ${bearer}`);
    return r.send(body as object);
  };
  const del = (path: string, bearer: string) => request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${bearer}`);
  const get = (path: string, bearer: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${bearer}`);

  async function cleanupTestUsers(): Promise<void> {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    if (ids.length) {
      const roles = await prisma.userRole.findMany({ where: { userId: { in: ids } }, select: { scopeId: true } });
      const acctIds = roles.map((r) => r.scopeId).filter((x): x is string => !!x);
      await prisma.authToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.account.deleteMany({ where: { id: { in: acctIds } } });
      // Audit actors (AUTH_REGISTER) → can't hard-delete; neutralize + FREE the email for re-runs.
      await prisma.user.updateMany({ where: { id: { in: ids } }, data: { email: null, phone: null, passwordHash: null, referralCode: null, status: 'SUSPENDED', authProviders: { set: [] } } });
    }
  }

  beforeAll(async () => {
    app = await createTestApp([{ token: OAUTH_VERIFIER, useValue: fakeVerifier }]);
    redis = app.get(REDIS);
    await cleanupTestUsers();
    // A referrer with a known code (for the register-with-referral capture test).
    await prisma.userRole.deleteMany({ where: { userId: REFERRER } });
    await prisma.account.upsert({ where: { id: REFERRER_ACCT }, update: {}, create: { id: REFERRER_ACCT, orgId: ORG1, type: 'RESIDENTIAL', name: 'Inc35 referrer account' } });
    await prisma.user.upsert({
      where: { id: REFERRER },
      update: { referralCode: REFERRER_CODE, status: 'ACTIVE' },
      create: { id: REFERRER, orgId: ORG1, name: 'Inc35 Referrer', phone: '+14165558911', authProviders: ['otp'], status: 'ACTIVE', referralCode: REFERRER_CODE },
    });
    await prisma.userRole.create({ data: { id: REFERRER_ROLE, orgId: ORG1, userId: REFERRER, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: REFERRER_ACCT } });
  }, 60000);

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.userRole.deleteMany({ where: { userId: REFERRER } });
    await prisma.user.deleteMany({ where: { id: REFERRER } });
    await prisma.account.deleteMany({ where: { id: REFERRER_ACCT } });
    await prisma.$disconnect();
    await app.close();
  });

  // ─────────────────────────── email + password ───────────────────────────

  it('registers a customer (mints account + role, hashes password, issues a session)', async () => {
    const email = `reg${DOMAIN}`;
    const res = await post('/v1/auth/register', { email, password: 'sup3r-secret-pw', name: 'Reg Tester' }).expect(201);
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();
    expect(res.body).toMatchObject({ emailVerified: false, provider: 'password', created: true });

    const user = await prisma.user.findFirstOrThrow({ where: { orgId: ORG1, email } });
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toContain('sup3r-secret-pw'); // hashed, never plaintext
    expect(user.authProviders).toEqual(['password']);
    const roles = await prisma.userRole.findMany({ where: { userId: user.id } });
    expect(roles).toHaveLength(1);
    expect(roles[0].role).toBe('RESIDENTIAL_CUSTOMER');
    expect(await prisma.account.count({ where: { id: roles[0].scopeId ?? '' } })).toBe(1);
  });

  it('register from a trusted browser origin sets the httpOnly cookie and OMITS the raw refresh token from tokens', async () => {
    // The web console gets its refresh token via the httpOnly cookie only — never in the JS-readable body
    // (transit-copy XSS hardening). Native register (no Origin, tested above) keeps tokens.refreshToken.
    const email = `browserreg${DOMAIN}`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('Origin', 'https://web-production-ba508.up.railway.app') // in CORS_ALLOWED_ORIGINS (test/setup-env.ts)
      .send({ email, password: 'browser-signup-pw', name: 'Browser Reg' })
      .expect(201);
    expect(res.body.tokens.accessToken).toBeTruthy(); // client still gets the access token
    expect(res.body.tokens.refreshToken).toBeUndefined(); // omitted for the browser
    expect(res.body).toMatchObject({ emailVerified: false, provider: 'password', created: true });
    const setCookie = res.headers['set-cookie'];
    expect(Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie)).toMatch(/bb_refresh=/);
  });

  it('rejects a duplicate email registration → 409 email_taken', async () => {
    const email = `reg${DOMAIN}`;
    const res = await post('/v1/auth/register', { email, password: 'another-password', name: 'Dup' }).expect(409);
    expect(res.body.title).toBe('email_taken');
  });

  it('logs in with the right password, rejects the wrong one (incl. the 000000 OTP bypass), and LOCKS OUT', async () => {
    const email = `login${DOMAIN}`;
    await post('/v1/auth/register', { email, password: 'correct-horse-battery', name: 'Login Tester' }).expect(201);
    await clearLoginLimits(email); // start from a clean rate-limit slate (a prior run may have locked it)

    await post('/v1/auth/login', { email, password: 'correct-horse-battery' }).expect(200);
    // The OTP dev bypass must NOT authenticate the password method.
    const bypass = await post('/v1/auth/login', { email, password: '000000' }).expect(401);
    expect(bypass.body.title).toBe('invalid_credentials');

    // Hammer wrong passwords until the lockout trips (config default: 10 failures → account_locked).
    let locked = false;
    for (let i = 0; i < 12; i += 1) {
      const r = await post('/v1/auth/login', { email, password: `wrong-${i}` });
      if (r.body.title === 'account_locked') {
        locked = true;
        break;
      }
    }
    expect(locked).toBe(true);
    // Even the CORRECT password is refused while locked.
    const stillLocked = await post('/v1/auth/login', { email, password: 'correct-horse-battery' }).expect(401);
    expect(stillLocked.body.title).toBe('account_locked');
  });

  it('verifies the email with the single-use token, reflected in the security view', async () => {
    const email = `verify${DOMAIN}`;
    const reg = await post('/v1/auth/register', { email, password: 'verify-me-please', name: 'Verify Tester' }).expect(201);
    const token = reg.body.devToken as string;
    expect(token).toBeTruthy();
    const access = reg.body.tokens.accessToken as string;

    expect((await get('/v1/auth/methods', access).expect(200)).body.emailVerified).toBe(false);
    await post('/v1/auth/email/verify', { token }).expect(200);
    expect((await get('/v1/auth/methods', access).expect(200)).body.emailVerified).toBe(true);
    // The token is single-use.
    await post('/v1/auth/email/verify', { token }).expect(401);
  });

  it('resets the password (enumeration-resistant request; new password works, old fails)', async () => {
    const email = `reset${DOMAIN}`;
    await post('/v1/auth/register', { email, password: 'old-password-123', name: 'Reset Tester' }).expect(201);

    // Unknown email still returns 200 (no enumeration) with no token.
    const unknown = await post('/v1/auth/password/reset', { email: `nobody${DOMAIN}` }).expect(200);
    expect(unknown.body.devToken).toBeUndefined();

    const reqRes = await post('/v1/auth/password/reset', { email }).expect(200);
    const token = reqRes.body.devToken as string;
    expect(token).toBeTruthy();
    await post('/v1/auth/password/reset/confirm', { token, password: 'brand-new-password-9' }).expect(200);

    await post('/v1/auth/login', { email, password: 'old-password-123' }).expect(401); // old no longer works
    await post('/v1/auth/login', { email, password: 'brand-new-password-9' }).expect(200); // new works
  });

  // ─────────────────────────── OAuth (Apple + Google) ───────────────────────────

  it('creates an account on first Google sign-in (verified email → account minted, email verified)', async () => {
    const email = `gnew${DOMAIN}`;
    const res = await post('/v1/auth/oauth', { provider: 'google', idToken: tok('g-sub-1', email) }).expect(200);
    expect(res.body).toMatchObject({ emailVerified: true, provider: 'google', created: true });
    const user = await prisma.user.findFirstOrThrow({ where: { orgId: ORG1, email } });
    expect(user.authProviders).toEqual(['google']);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.passwordHash).toBeNull();
  });

  it('rejects an OAuth token whose email the provider did not verify → provider_email_unverified', async () => {
    const res = await post('/v1/auth/oauth', { provider: 'google', idToken: tok('g-sub-x', `unv${DOMAIN}`, false) }).expect(401);
    expect(res.body.title).toBe('provider_email_unverified');
    expect(await prisma.user.count({ where: { email: `unv${DOMAIN}` } })).toBe(0); // nothing created
  });

  it('pre-hijack safe: an UNVERIFIED password account is taken over by the real email owner via OAuth (password cleared)', async () => {
    const email = `hijack${DOMAIN}`;
    await post('/v1/auth/register', { email, password: 'attacker-set-pw-1', name: 'Victim' }).expect(201); // email left UNVERIFIED
    const before = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(before.passwordHash).toBeTruthy();

    // The real owner proves the email via Google → links google, verifies the email, and CLEARS the
    // attacker's unverified password.
    const res = await post('/v1/auth/oauth', { provider: 'google', idToken: tok('g-owner', email) }).expect(200);
    expect(res.body).toMatchObject({ created: false, provider: 'google', emailVerified: true });
    const after = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(after.id).toBe(before.id); // same account (deduped by email)
    expect(after.passwordHash).toBeNull(); // attacker's password neutralized
    expect(after.authProviders.sort()).toEqual(['google', 'password'].sort());
    // The attacker's password no longer logs in.
    await post('/v1/auth/login', { email, password: 'attacker-set-pw-1' }).expect(401);
  });

  it('cross-method resolution: password + Google + Apple on one VERIFIED email → one account, all linked', async () => {
    const email = `cross${DOMAIN}`;
    const reg = await post('/v1/auth/register', { email, password: 'cross-method-pw', name: 'Cross' }).expect(201);
    await post('/v1/auth/email/verify', { token: reg.body.devToken }).expect(200); // verify FIRST → password kept

    const g = await post('/v1/auth/oauth', { provider: 'google', idToken: tok('g-cross', email) }).expect(200);
    expect(g.body.created).toBe(false);
    const a = await post('/v1/auth/oauth', { provider: 'apple', idToken: tok('a-cross', email) }).expect(200);
    expect(a.body.created).toBe(false);

    const users = await prisma.user.findMany({ where: { orgId: ORG1, email } });
    expect(users).toHaveLength(1); // one account
    expect(users[0].authProviders.sort()).toEqual(['apple', 'google', 'password'].sort());
    expect(users[0].passwordHash).toBeTruthy(); // verified-first → password NOT cleared
    await post('/v1/auth/login', { email, password: 'cross-method-pw' }).expect(200); // password still works
  });

  // ─────────────────────────── registration = referral capture ───────────────────────────

  it('registration captures a valid referral once; unknown/none never fail the signup', async () => {
    const referred = `referred${DOMAIN}`;
    await post('/v1/auth/register', { email: referred, password: 'referred-signup-pw', name: 'Referred', referralCode: REFERRER_CODE }).expect(201);
    const ru = await prisma.user.findFirstOrThrow({ where: { orgId: ORG1, email: referred } });
    expect(ru.referredByUserId).toBe(REFERRER); // attributed to the referrer

    // Unknown code → signup still succeeds, no attribution.
    const unk = `unkref${DOMAIN}`;
    await post('/v1/auth/register', { email: unk, password: 'unknown-ref-pw', name: 'UnkRef', referralCode: 'ZZZZ9999' }).expect(201);
    expect((await prisma.user.findFirstOrThrow({ where: { orgId: ORG1, email: unk } })).referredByUserId).toBeNull();

    // No code → succeeds.
    const none = `noref${DOMAIN}`;
    await post('/v1/auth/register', { email: none, password: 'no-ref-pw-here', name: 'NoRef' }).expect(201);
    expect((await prisma.user.findFirstOrThrow({ where: { orgId: ORG1, email: none } })).referredByUserId).toBeNull();
  });

  // ─────────────────────────── account security (link/unlink) ───────────────────────────

  it('manages linked methods: set a password, list methods, and refuse to unlink the last one', async () => {
    const email = `security${DOMAIN}`;
    const g = await post('/v1/auth/oauth', { provider: 'google', idToken: tok('g-sec', email) }).expect(200);
    const access = g.body.tokens.accessToken as string;

    let methods = (await get('/v1/auth/methods', access).expect(200)).body;
    expect(methods.methods).toEqual(['google']);
    expect(methods.hasPassword).toBe(false);

    // Set a password (links the 'password' method) — no currentPassword needed (none set).
    methods = (await post('/v1/auth/password', { newPassword: 'a-freshly-set-password' }, access).expect(200)).body;
    expect(methods.hasPassword).toBe(true);
    expect(methods.methods.sort()).toEqual(['google', 'password'].sort());
    await post('/v1/auth/login', { email, password: 'a-freshly-set-password' }).expect(200);

    // Unlink google (still have password) → ok.
    methods = (await del('/v1/auth/methods/google', access).expect(200)).body;
    expect(methods.methods).toEqual(['password']);
    // Unlinking the LAST method is refused.
    const last = await del('/v1/auth/methods/password', access).expect(409);
    expect(last.body.title).toBe('last_method');
  });
});
