import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type Redis from 'ioredis';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS } from '../src/redis/redis.module';
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
});
