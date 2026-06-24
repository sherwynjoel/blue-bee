import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { User } from '@prisma/client';
import { accessClaimsSchema, type AccessClaims, type RoleGrant, type TokenPair } from '@blue-bee/shared';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { PrincipalService } from './principal.service';

interface IssueCtx {
  ip?: string;
  userAgent?: string;
}

export type RotateOutcome =
  | { ok: true; pair: TokenPair; user: User }
  | { ok: false; reason: 'invalid' | 'expired' | 'reuse_detected' };

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * Access tokens (stateless JWT, ~15 min) + refresh tokens (opaque, server-side,
 * rotated on every use with reuse detection + family revocation). PRD §8.1/§12.1.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly prisma: PrismaService,
    private readonly principals: PrincipalService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ── access JWT ──
  signAccess(user: User, roles: RoleGrant[], scope: { accountIds: string[]; siteIds: string[] }): string {
    const claims: Omit<AccessClaims, 'iat' | 'exp'> = {
      sub: user.id,
      org_id: user.orgId,
      typ: 'access',
      roles,
      scope,
      jti: randomUUID(),
    };
    return this.jwt.sign(claims, {
      secret: this.config.jwt.accessSecret,
      expiresIn: this.config.jwt.accessTtl,
      algorithm: 'HS256',
    });
  }

  /** Verify + validate an access token. Algorithm pinned to HS256. Throws on bad signature/expiry. */
  verifyAccess(token: string): AccessClaims {
    const payload = this.jwt.verify(token, { secret: this.config.jwt.accessSecret, algorithms: ['HS256'] });
    return accessClaimsSchema.parse(payload);
  }

  // ── access-token revocation (logout effective immediately, not just at TTL) ──
  private static jtiKey(jti: string): string {
    return `revoked:jti:${jti}`;
  }

  /** Denylist an access-token jti until its natural expiry (logout / theft response). */
  async denylistAccess(jti: string, expUnixSeconds: number): Promise<void> {
    const ttl = Math.max(1, expUnixSeconds - Math.floor(Date.now() / 1000));
    await this.redis.set(TokenService.jtiKey(jti), '1', 'EX', ttl);
  }

  async isAccessRevoked(jti: string): Promise<boolean> {
    return (await this.redis.exists(TokenService.jtiKey(jti))) === 1;
  }

  // ── refresh tokens (server-side) ──
  private async createRefresh(user: User, familyId: string, ctx: IssueCtx): Promise<{ token: string; id: string }> {
    const token = randomBytes(32).toString('base64url');
    const row = await this.prisma.refreshToken.create({
      data: {
        orgId: user.orgId,
        userId: user.id,
        familyId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + this.config.jwt.refreshTtlSeconds * 1000),
        userAgent: ctx.userAgent ?? null,
        createdByIp: ctx.ip ?? null,
        createdBy: user.id,
      },
    });
    return { token, id: row.id };
  }

  async issuePair(user: User, ctx: IssueCtx): Promise<TokenPair> {
    const roles = await this.principals.loadGrants(user.id);
    const scope = await this.principals.deriveScope(roles);
    const accessToken = this.signAccess(user, roles, scope);
    const { token: refreshToken } = await this.createRefresh(user, randomUUID(), ctx);
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: this.config.jwt.accessTtlSeconds };
  }

  /** Rotate a refresh token. Reuse of a rotated/revoked token revokes the whole family. */
  async rotate(presentedToken: string, ctx: IssueCtx): Promise<RotateOutcome> {
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presentedToken) } });
    if (!existing) return { ok: false, reason: 'invalid' };

    const now = new Date();
    if (existing.revokedAt || existing.rotatedToId) {
      // Reuse of a token that was already rotated/revoked ⇒ theft signal: kill the family.
      await this.revokeFamily(existing.familyId, now, true);
      return { ok: false, reason: 'reuse_detected' };
    }
    if (existing.expiresAt <= now) {
      await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: now } });
      return { ok: false, reason: 'expired' };
    }

    // Atomically CLAIM the token (race-proof): only one concurrent rotate can flip
    // revoked_at from null. The loser (count 0) is a concurrent reuse ⇒ kill the family.
    const claim = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null, rotatedToId: null },
      data: { revokedAt: now },
    });
    if (claim.count === 0) {
      await this.revokeFamily(existing.familyId, now, true);
      return { ok: false, reason: 'reuse_detected' };
    }

    const user = await this.prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user || user.status !== 'ACTIVE') {
      await this.revokeFamily(existing.familyId, now);
      return { ok: false, reason: 'invalid' };
    }

    const next = await this.createRefresh(user, existing.familyId, ctx);
    await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { rotatedToId: next.id } });

    const roles = await this.principals.loadGrants(user.id);
    const scope = await this.principals.deriveScope(roles);
    const pair: TokenPair = {
      accessToken: this.signAccess(user, roles, scope),
      refreshToken: next.token,
      tokenType: 'Bearer',
      expiresIn: this.config.jwt.accessTtlSeconds,
    };
    return { ok: true, pair, user };
  }

  /** Revoke every still-active token in a family (used on reuse detection + logout). */
  async revokeFamily(familyId: string, at: Date, reuse = false): Promise<number> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at, ...(reuse ? { reusedAt: at } : {}) },
    });
    return res.count;
  }

  /** Logout: revoke the family of the presented refresh token (or all of the user's). */
  async logout(userId: string, presentedToken?: string): Promise<number> {
    if (presentedToken) {
      const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presentedToken) } });
      if (existing && existing.userId === userId) {
        return this.revokeFamily(existing.familyId, new Date());
      }
    }
    const res = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }
}
