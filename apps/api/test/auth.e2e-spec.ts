import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type Redis from 'ioredis';
import type { Response } from 'express';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS } from '../src/redis/redis.module';
import { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie } from '../src/auth/refresh-cookie';
import { createTestApp, decodeJwt } from './app.factory';

const OWNER_PHONE = '+14165550001';
const CSR_PHONE = '+14165550003';
const RITA_PHONE = '+14165550010';
const LOCK_PHONE = '+14165550005'; // finance — used for lockout test in isolation
const EXPIRE_PHONE = '+14165550006'; // driver — used for expiry test in isolation

describe('Auth + RBAC (e2e, real DB + Redis)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let redis: Redis;
  let jwtService: JwtService;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    jwtService = app.get(JwtService, { strict: false });
    // Clean OTP rate/cooldown state so the suite is deterministic across repeated runs.
    const keys = await redis.keys('otp:*');
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await app.close();
  });

  const clearOtpKeys = async (phone: string): Promise<void> => {
    await redis.del(`otp:cooldown:${phone}`, `otp:rate:phone:${phone}`);
  };

  const requestOtp = async (phone: string) => {
    await clearOtpKeys(phone);
    const res = await request(http).post('/v1/auth/otp').send({ phone });
    return res;
  };

  const login = async (phone: string): Promise<{ accessToken: string; refreshToken: string }> => {
    const otp = await requestOtp(phone);
    expect(otp.status).toBe(200);
    const code = otp.body.devCode as string;
    const verify = await request(http).post('/v1/auth/verify').send({ phone, code });
    expect(verify.status).toBe(200);
    return { accessToken: verify.body.accessToken, refreshToken: verify.body.refreshToken };
  };

  // ── DoD #1 — OTP request → verify → tokens; decoded JWT claims ──
  it('issues an OTP and verifies it into a token pair with org/role/scope claims', async () => {
    const otp = await requestOtp(OWNER_PHONE);
    expect(otp.status).toBe(200);
    expect(otp.body).toHaveProperty('challengeId');
    expect(otp.body).toHaveProperty('devCode'); // console transport echoes the code
    expect(otp.body.resendInSeconds).toBeGreaterThan(0);

    const verify = await request(http).post('/v1/auth/verify').send({ phone: OWNER_PHONE, code: otp.body.devCode });
    expect(verify.status).toBe(200);
    expect(verify.body.tokenType).toBe('Bearer');
    expect(verify.body.expiresIn).toBeGreaterThan(0);

    const claims = decodeJwt(verify.body.accessToken);
    expect(claims.typ).toBe('access');
    expect(typeof claims.org_id).toBe('string');
    expect((claims.roles as Array<{ role: string }>).map((r) => r.role)).toContain('OWNER');
    expect(claims.scope).toHaveProperty('accountIds');
  });

  // ── DoD #1 — invalid OTP rejected ──
  it('rejects an invalid OTP code (401)', async () => {
    await requestOtp(CSR_PHONE);
    const res = await request(http).post('/v1/auth/verify').send({ phone: CSR_PHONE, code: '000000' });
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.title).toBe('otp_invalid');
  });

  // ── DoD #1 — rate-limit (resend cooldown) fires ──
  it('rate-limits repeated OTP requests for the same phone (429)', async () => {
    await clearOtpKeys(OWNER_PHONE);
    const first = await request(http).post('/v1/auth/otp').send({ phone: OWNER_PHONE });
    expect(first.status).toBe(200);
    const second = await request(http).post('/v1/auth/otp').send({ phone: OWNER_PHONE });
    expect(second.status).toBe(429);
    expect(second.body.title).toBe('otp_rate_limited');
  });

  // ── DoD #1 — attempt lockout on the Nth wrong code ──
  it('locks the challenge after max wrong attempts', async () => {
    const otp = await requestOtp(LOCK_PHONE);
    expect(otp.status).toBe(200);
    let lastTitle = '';
    for (let i = 0; i < 5; i++) {
      const r = await request(http).post('/v1/auth/verify').send({ phone: LOCK_PHONE, code: '111111' });
      lastTitle = r.body.title;
    }
    expect(lastTitle).toBe('otp_locked');
    // Even the correct code is now rejected (challenge locked).
    const right = await request(http).post('/v1/auth/verify').send({ phone: LOCK_PHONE, code: otp.body.devCode });
    expect(right.status).toBe(401);
  });

  // ── DoD #1 — expired OTP rejected ──
  it('rejects an expired OTP', async () => {
    const otp = await requestOtp(EXPIRE_PHONE);
    await prisma.otpChallenge.updateMany({
      where: { phone: EXPIRE_PHONE, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(http).post('/v1/auth/verify').send({ phone: EXPIRE_PHONE, code: otp.body.devCode });
    expect(res.status).toBe(401);
    expect(res.body.title).toBe('otp_expired');
  });

  // ── DoD #2 — protected route authN ──
  it('protects /v1/me: 200 with a valid token, 401 without / with garbage / expired', async () => {
    const { accessToken } = await login(OWNER_PHONE);
    const ok = await request(http).get('/v1/me').set('Authorization', `Bearer ${accessToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user.roles.map((r: { role: string }) => r.role)).toContain('OWNER');
    expect(ok.body.org).toHaveProperty('name');

    expect((await request(http).get('/v1/me')).status).toBe(401);
    expect((await request(http).get('/v1/me').set('Authorization', 'Bearer garbage.token.here')).status).toBe(401);

    const expired = jwtService.sign(
      { sub: 'x', typ: 'access' },
      { secret: process.env.JWT_ACCESS_SECRET as string, expiresIn: -1 },
    );
    const expRes = await request(http).get('/v1/me').set('Authorization', `Bearer ${expired}`);
    expect(expRes.status).toBe(401);
    expect(expRes.body.title).toBe('token_expired');
  });

  // ── DoD #4 — vertical RBAC (§17.3 admin row: OWNER) ──
  it('gates /v1/admin/users: 200 for OWNER, 403 for CSR', async () => {
    const owner = await login(OWNER_PHONE);
    const ownerRes = await request(http).get('/v1/admin/users').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.count).toBeGreaterThan(0);

    const csr = await login(CSR_PHONE);
    const csrRes = await request(http).get('/v1/admin/users').set('Authorization', `Bearer ${csr.accessToken}`);
    expect(csrRes.status).toBe(403);
    expect(csrRes.body.title).toBe('forbidden_role');
  });

  // ── DoD #3 — refresh rotation + reuse detection + family revocation ──
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { refreshToken: original } = await login(RITA_PHONE);

    const rotated = await request(http).post('/v1/auth/refresh').send({ refreshToken: original });
    expect(rotated.status).toBe(200);
    const next = rotated.body.refreshToken as string;
    expect(next).not.toBe(original);

    // Reuse the ORIGINAL (already-rotated) token ⇒ reuse detected, family revoked.
    const reuse = await request(http).post('/v1/auth/refresh').send({ refreshToken: original });
    expect(reuse.status).toBe(401);
    expect(reuse.body.title).toBe('refresh_reuse_detected');

    // The rotated-to token is now revoked too (family killed).
    const afterKill = await request(http).post('/v1/auth/refresh').send({ refreshToken: next });
    expect(afterKill.status).toBe(401);
  });

  // ── DoD #3 — logout revokes ──
  it('revokes the family on logout', async () => {
    const { accessToken, refreshToken } = await login(RITA_PHONE);
    const out = await request(http)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });
    expect(out.status).toBe(200);
    expect(out.body.revoked).toBeGreaterThanOrEqual(1);

    const afterLogout = await request(http).post('/v1/auth/refresh').send({ refreshToken });
    expect(afterLogout.status).toBe(401);
  });

  // ── DoD #6 — OpenAPI exposes the auth endpoints; errors are problem+json ──
  it('publishes the auth endpoints in the OpenAPI doc', async () => {
    const res = await request(http).get('/v1/docs-json');
    expect(res.status).toBe(200);
    const paths = Object.keys(res.body.paths);
    expect(paths).toEqual(
      expect.arrayContaining(['/v1/auth/otp', '/v1/auth/verify', '/v1/auth/refresh', '/v1/auth/logout', '/v1/me']),
    );
  });

  // ── httpOnly refresh cookie (web console hardening — Task 5) ──
  // The web console keeps its refresh token in an httpOnly cookie (never in JS) so an XSS payload can't
  // exfiltrate it. A trusted browser origin therefore also NEVER receives the raw refresh token in the
  // JS-readable response body (the transit copy) — only the cookie carries it. Native clients authenticate
  // by the body token (never by the cookie), so they keep receiving it in the body, unchanged. Every
  // token-issuing route ALSO sets the cookie; refresh/logout accept the token from cookie OR body.
  // WEB_ORIGIN must be in CORS_ALLOWED_ORIGINS for the test env (set in test/setup-env.ts) so the Origin
  // allow-list has a positive case; a genuinely-foreign origin proves the CSRF check has teeth.
  describe('httpOnly refresh cookie (web console hardening)', () => {
    const WEB_ORIGIN = 'https://web-production-ba508.up.railway.app';
    const COOKIE_PHONE = OWNER_PHONE;

    // Fetch a fresh OTP code for the seeded phone (mirrors the file's `login` helper's first half).
    const freshCode = async (phone: string): Promise<string> => {
      const otp = await requestOtp(phone);
      expect(otp.status).toBe(200);
      return otp.body.devCode as string;
    };

    it('verify from a trusted browser origin sets the httpOnly cookie AND omits the raw token from the body', async () => {
      const code = await freshCode(COOKIE_PHONE);
      const res = await request(http)
        .post('/v1/auth/verify')
        .set('Origin', WEB_ORIGIN)
        .send({ phone: COOKIE_PHONE, code });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy(); // still returned — the client needs it for API calls
      expect(res.body.refreshToken).toBeUndefined(); // NOT in the JS-readable body; only the cookie has it

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
      expect(cookieStr).toMatch(/bb_refresh=/);
      expect(cookieStr).toMatch(/HttpOnly/i); // JS can never read it (the whole point)
      expect(cookieStr).toMatch(/Path=\/v1\/auth/i); // scoped to auth routes only
      // Test env is NODE_ENV=development ⇒ SameSite=Lax + non-Secure so cookie-refresh is testable over
      // plain HTTP. The production posture (SameSite=None; Secure) is asserted by the helper unit test below.
      expect(cookieStr).toMatch(/SameSite=Lax/i);
    });

    it('verify from a native client (no Origin) STILL returns the refresh token in the body (native compat)', async () => {
      const code = await freshCode(COOKIE_PHONE);
      const res = await request(http).post('/v1/auth/verify').send({ phone: COOKIE_PHONE, code });
      expect(res.status).toBe(200);
      expect(res.body.refreshToken).toBeTruthy(); // native apps' ONLY copy — unchanged behavior
    });

    it('refresh works via the cookie ALONE and OMITS the rotated token from the body (the web path)', async () => {
      const agent = request.agent(http); // supertest agent = automatic cookie jar
      const code = await freshCode(COOKIE_PHONE);
      const verifyRes = await agent
        .post('/v1/auth/verify')
        .set('Origin', WEB_ORIGIN)
        .send({ phone: COOKIE_PHONE, code })
        .expect(200);

      const refreshRes = await agent.post('/v1/auth/refresh').set('Origin', WEB_ORIGIN).send({}).expect(200); // EMPTY body
      expect(refreshRes.body.accessToken).toBeTruthy();
      expect(refreshRes.body.accessToken).not.toBe(verifyRes.body.accessToken); // genuinely rotated
      expect(refreshRes.body.refreshToken).toBeUndefined(); // cookie-sourced ⇒ never leaks the rotated token
      // The cookie itself IS rotated (a fresh bb_refresh is set on the response).
      const setCookie = refreshRes.headers['set-cookie'];
      expect(Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie)).toMatch(/bb_refresh=/);
    });

    it('refresh via the BODY alone (native) STILL returns the rotated refresh token in the body (unchanged)', async () => {
      const code = await freshCode(COOKIE_PHONE);
      const verifyRes = await request(http).post('/v1/auth/verify').send({ phone: COOKIE_PHONE, code }).expect(200);
      const original = verifyRes.body.refreshToken as string;
      expect(original).toBeTruthy();
      const refreshRes = await request(http).post('/v1/auth/refresh').send({ refreshToken: original }).expect(200);
      expect(refreshRes.body.accessToken).toBeTruthy();
      expect(refreshRes.body.refreshToken).toBeTruthy(); // native keeps getting the rotated token in the body
      expect(refreshRes.body.refreshToken).not.toBe(original); // genuinely rotated
    });

    it('a refresh from an untrusted Origin is rejected (CSRF defense)', async () => {
      const agent = request.agent(http);
      const code = await freshCode(COOKIE_PHONE);
      await agent.post('/v1/auth/verify').set('Origin', WEB_ORIGIN).send({ phone: COOKIE_PHONE, code }).expect(200);
      const res = await agent.post('/v1/auth/refresh').set('Origin', 'https://evil.example').send({}).expect(403);
      expect(res.body.title).toBe('untrusted_origin');
    });

    it('logout clears the cookie', async () => {
      const agent = request.agent(http);
      const code = await freshCode(COOKIE_PHONE);
      const verifyRes = await agent
        .post('/v1/auth/verify')
        .set('Origin', WEB_ORIGIN)
        .send({ phone: COOKIE_PHONE, code })
        .expect(200);
      const logoutRes = await agent
        .post('/v1/auth/logout')
        .set('Origin', WEB_ORIGIN)
        .set('Authorization', `Bearer ${verifyRes.body.accessToken}`)
        .send({})
        .expect(200);
      const setCookie = logoutRes.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
      expect(cookieStr).toMatch(/bb_refresh=;/); // cleared (empty value + past expiry)
    });
  });
});

/**
 * Unit coverage for the cookie attributes themselves — asserted directly against the helper (no booted app)
 * so the PRODUCTION posture is verified even though the e2e suite runs under NODE_ENV=development. This is
 * the evidence that the token is httpOnly (never JS-readable) and, in prod, Secure + SameSite=None + path-scoped.
 */
describe('refresh-cookie helper attributes (production vs dev posture)', () => {
  const captureCookieCalls = () => {
    const calls: Array<{ op: 'cookie' | 'clear'; name: string; value?: string; opts: Record<string, unknown> }> = [];
    const res = {
      cookie(name: string, value: string, opts: Record<string, unknown>) {
        calls.push({ op: 'cookie', name, value, opts });
        return this;
      },
      clearCookie(name: string, opts: Record<string, unknown>) {
        calls.push({ op: 'clear', name, opts });
        return this;
      },
    } as unknown as Response;
    return { res, calls };
  };

  const withNodeEnv = (value: string, fn: () => void) => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = value;
    try {
      fn();
    } finally {
      process.env.NODE_ENV = prev;
    }
  };

  it('production: httpOnly + Secure + SameSite=None, scoped to /v1/auth, maxAge from TTL', () => {
    withNodeEnv('production', () => {
      const { res, calls } = captureCookieCalls();
      setRefreshCookie(res, 'the-raw-refresh-token', 3600);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ op: 'cookie', name: REFRESH_COOKIE_NAME, value: 'the-raw-refresh-token' });
      expect(calls[0].opts).toEqual({
        httpOnly: true, // JavaScript can NEVER read this cookie — the core XSS mitigation
        secure: true, // mandated by the spec whenever SameSite=None is used
        sameSite: 'none', // API + web console are cross-SITE Railway subdomains
        path: '/v1/auth', // never sent to non-auth routes
        maxAge: 3600 * 1000,
      });
    });
  });

  it('development: httpOnly stays ON, but SameSite=Lax + non-Secure so it works over plain HTTP', () => {
    withNodeEnv('development', () => {
      const { res, calls } = captureCookieCalls();
      setRefreshCookie(res, 'tok', 60);
      expect(calls[0].opts).toMatchObject({ httpOnly: true, secure: false, sameSite: 'lax', path: '/v1/auth' });
    });
  });

  it('clear uses matching attributes (path/secure/sameSite) so the browser actually expires it', () => {
    withNodeEnv('production', () => {
      const { res, calls } = captureCookieCalls();
      clearRefreshCookie(res);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ op: 'clear', name: REFRESH_COOKIE_NAME });
      expect(calls[0].opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none', path: '/v1/auth' });
    });
  });
});
