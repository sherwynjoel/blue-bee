import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import type { User } from '@prisma/client';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SMS_TRANSPORT, type SmsTransport } from './sms/sms.module';

export type OtpRequestOutcome =
  | { ok: true; challengeId: string; expiresAt: Date; resendInSeconds: number; devCode?: string }
  | { ok: false; reason: 'rate_limited'; resendInSeconds: number };

export type OtpVerifyOutcome =
  | { ok: true; user: User }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' };

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMS_TRANSPORT) private readonly sms: SmsTransport,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  private hash(phone: string, code: string): string {
    // Bind the hash to the phone so a leaked hash can't be replayed for another number.
    return createHmac('sha256', this.config.otp.pepper).update(`${phone}:${code}`).digest('hex');
  }

  // Resolve the user for a phone. Deterministic ordering so the same phone always maps
  // to the same identity. NOTE (multi-tenant, post-MVP): phone is not globally unique;
  // when a phone can belong to multiple orgs, require an explicit org/tenant selector.
  private async resolveUser(phone: string, orgId?: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { phone, status: 'ACTIVE', ...(orgId ? { orgId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Step 1 — issue an OTP. Enumeration-resistant: same response shape whether or not the phone is known. */
  async requestOtp(phone: string, ip: string | undefined): Promise<OtpRequestOutcome> {
    const { otp } = this.config;

    // Resend cooldown (per phone) — SET NX with TTL; if it already exists, too soon.
    const cooldownKey = `otp:cooldown:${phone}`;
    const setCooldown = await this.redis.set(cooldownKey, '1', 'EX', otp.resendCooldownSeconds, 'NX');
    if (setCooldown === null) {
      const ttl = await this.redis.ttl(cooldownKey);
      return { ok: false, reason: 'rate_limited', resendInSeconds: Math.max(ttl, 0) };
    }

    // Sliding-window-ish counters per phone and per IP.
    const phoneCount = await this.incrWindow(`otp:rate:phone:${phone}`, otp.rateWindowSeconds);
    const ipCount = ip ? await this.incrWindow(`otp:rate:ip:${ip}`, otp.rateWindowSeconds) : 0;
    if (phoneCount > otp.ratePerPhone || ipCount > otp.ratePerIp) {
      const ttl = await this.redis.ttl(`otp:rate:phone:${phone}`);
      return { ok: false, reason: 'rate_limited', resendInSeconds: Math.max(ttl, otp.resendCooldownSeconds) };
    }

    const user = await this.resolveUser(phone);
    const expiresAt = new Date(Date.now() + otp.ttlSeconds * 1000);

    // Only create a challenge + send for a known phone; otherwise return a plausible
    // response without side effects (no account enumeration). Do an equivalent awaited DB
    // round-trip on the unknown path so the latency profile matches the known path
    // (closes the timing oracle — the response shape is already identical).
    if (!user) {
      await this.prisma.$queryRaw`SELECT 1`;
      this.logger.warn(`OTP requested for unknown phone ${phone} — no challenge created`);
      return { ok: true, challengeId: randomUUID(), expiresAt, resendInSeconds: otp.resendCooldownSeconds };
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        orgId: user.orgId,
        phone,
        codeHash: this.hash(phone, code),
        expiresAt,
        maxAttempts: otp.maxAttempts,
        requestIp: ip ?? null,
      },
    });

    // Fire-and-forget the SMS so known/unknown phones take similar time on the request
    // path (no synchronous-send latency oracle for account enumeration).
    void this.sms
      .send(phone, `Your Blue Bee verification code is ${code}. It expires in ${Math.round(otp.ttlSeconds / 60)} minutes.`)
      .catch((err) => this.logger.warn(`OTP send failed for ${phone}: ${(err as Error).message}`));

    const devMode = this.config.sms.transport === 'console' && process.env.NODE_ENV !== 'production';
    return {
      ok: true,
      challengeId: challenge.id,
      expiresAt,
      resendInSeconds: otp.resendCooldownSeconds,
      // Echo the code ONLY in dev console mode (never in production) so flows are testable.
      ...(devMode ? { devCode: code } : {}),
    };
  }

  /** Step 2 — verify the code. Single-use, attempt-limited, constant-time compare. */
  async verifyOtp(phone: string, code: string): Promise<OtpVerifyOutcome> {
    const now = new Date();
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) return { ok: false, reason: 'invalid' };
    if (challenge.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: 'locked' };

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(this.hash(phone, code), 'hex');
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      const updated = await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false, reason: updated.attempts >= updated.maxAttempts ? 'locked' : 'invalid' };
    }

    // Success — consume single-use, clear cooldown so the user can immediately proceed.
    await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now } });
    await this.redis.del(`otp:cooldown:${phone}`);

    const user = await this.resolveUser(phone, challenge.orgId);
    if (!user) return { ok: false, reason: 'invalid' };
    return { ok: true, user };
  }

  private async incrWindow(key: string, windowSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    return count;
  }
}
