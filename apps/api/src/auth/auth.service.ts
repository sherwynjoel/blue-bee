import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AUTH_ERRORS, type OtpRequestResult, type TokenPair } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import type { RequestPrincipal } from './rbac/types';

interface ReqCtx {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  async requestOtp(phone: string, ip?: string): Promise<OtpRequestResult> {
    const r = await this.otp.requestOtp(phone, ip);
    if (!r.ok) {
      throw new HttpException(
        { error: AUTH_ERRORS.OTP_RATE_LIMITED, message: `Too many requests; retry in ${r.resendInSeconds}s` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return {
      challengeId: r.challengeId,
      expiresAt: r.expiresAt.toISOString(),
      resendInSeconds: r.resendInSeconds,
      ...(r.devCode ? { devCode: r.devCode } : {}),
    };
  }

  async verify(phone: string, code: string, ctx: ReqCtx): Promise<TokenPair> {
    const r = await this.otp.verifyOtp(phone, code);
    if (!r.ok) {
      const map: Record<string, [string, string]> = {
        invalid: [AUTH_ERRORS.OTP_INVALID, 'Invalid verification code'],
        expired: [AUTH_ERRORS.OTP_EXPIRED, 'Verification code expired'],
        locked: [AUTH_ERRORS.OTP_LOCKED, 'Too many attempts; request a new code'],
      };
      const [error, message] = map[r.reason];
      throw new HttpException({ error, message }, HttpStatus.UNAUTHORIZED);
    }
    const pair = await this.tokens.issuePair(r.user, ctx);
    await this.audit(r.user.orgId, r.user.id, 'AUTH_LOGIN');
    return pair;
  }

  async refresh(token: string, ctx: ReqCtx): Promise<TokenPair> {
    const r = await this.tokens.rotate(token, ctx);
    if (!r.ok) {
      if (r.reason === 'reuse_detected') {
        throw new HttpException(
          { error: AUTH_ERRORS.REFRESH_REUSE_DETECTED, message: 'Refresh token reuse detected — session family revoked' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw new HttpException(
        {
          error: AUTH_ERRORS.TOKEN_INVALID,
          message: r.reason === 'expired' ? 'Refresh token expired' : 'Invalid refresh token',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.audit(r.user.orgId, r.user.id, 'AUTH_TOKEN_REFRESH');
    return r.pair;
  }

  async logout(principal: RequestPrincipal, refreshToken?: string): Promise<{ revoked: number }> {
    const revoked = await this.tokens.logout(principal.userId, refreshToken);
    // Revoke the CURRENT access token immediately too (don't wait for its ~15m TTL).
    await this.tokens.denylistAccess(principal.jti, principal.accessExp);
    await this.audit(principal.orgId, principal.userId, 'AUTH_LOGOUT');
    return { revoked };
  }

  /** Every state-changing auth action is attributed to the actor (PRD §8.7). */
  private async audit(orgId: string, actorId: string, action: string): Promise<void> {
    await this.prisma.auditLog.create({
      data: { orgId, actorId, entity: 'User', entityId: actorId, action, createdBy: actorId },
    });
  }
}
