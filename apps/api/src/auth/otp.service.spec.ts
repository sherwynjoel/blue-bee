import type Redis from 'ioredis';
import type { User } from '@prisma/client';
import type { AuthConfig } from '../config/auth.config';
import { PrismaService } from '../prisma/prisma.service';
import type { SmsTransport } from './sms/sms.module';
import { OtpService } from './otp.service';

// Minimal, hand-built collaborators — the dev-bypass branch only touches user.findFirst + redis.del.
const DEMO_USER = { id: 'u-1', orgId: 'org-1', phone: '+11234567890', status: 'ACTIVE' } as unknown as User;

function makeService(devBypassCodes: string[], user: User | null = DEMO_USER) {
  const findFirst = jest.fn().mockResolvedValue(user);
  const del = jest.fn().mockResolvedValue(1);
  const prisma = {
    user: { findFirst },
    // Present so the non-bypass path (challenge lookup) resolves to "no challenge" → invalid.
    otpChallenge: { findFirst: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;
  const redis = { del } as unknown as Redis;
  const sms = { send: jest.fn() } as unknown as SmsTransport;
  const config = {
    otp: { pepper: 'x'.repeat(40), devBypassCodes },
    sms: { transport: 'console' },
  } as unknown as AuthConfig;
  return { svc: new OtpService(prisma, redis, sms, config), findFirst, del };
}

describe('OtpService — dev-bypass OTP (staging/demo)', () => {
  it('accepts a configured bypass code for a seeded phone without a challenge', async () => {
    const { svc, findFirst, del } = makeService(['000000', '0000']);
    const r = await svc.verifyOtp('+11234567890', '000000');
    expect(r).toEqual({ ok: true, user: DEMO_USER });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ phone: '+11234567890', status: 'ACTIVE' }) }),
    );
    expect(del).toHaveBeenCalledWith('otp:cooldown:+11234567890'); // clears cooldown for repeat logins
  });

  it('also accepts the short 0000 form when configured', async () => {
    const { svc } = makeService(['000000', '0000']);
    await expect(svc.verifyOtp('+11234567890', '0000')).resolves.toEqual({ ok: true, user: DEMO_USER });
  });

  it('rejects the bypass code for an unknown phone (no seeded user)', async () => {
    const { svc } = makeService(['000000'], null);
    await expect(svc.verifyOtp('+19999999999', '000000')).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('is inert when disabled: 000000 is treated as an ordinary code and fails with no challenge', async () => {
    const { svc, del } = makeService([]); // empty = production / not opted-in
    await expect(svc.verifyOtp('+11234567890', '000000')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(del).not.toHaveBeenCalled(); // never entered the bypass branch
  });
});
