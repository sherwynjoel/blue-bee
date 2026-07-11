import { ConflictException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type User } from '@prisma/client';
import type Redis from 'ioredis';
import {
  AUTH_CRED_ERRORS,
  type AccountSecurityView,
  type AuthProvider,
  type AuthResultView,
  type EmailLoginDto,
  type OAuthSignInDto,
  type PasswordResetConfirmDto,
  type PasswordResetRequestDto,
  type RegisterDto,
  type SetPasswordDto,
  type VerifyEmailDto,
} from '@blue-bee/shared';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { ReferralService } from '../referral/referral.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EMAIL_TRANSPORT, type EmailTransport } from './email/email.module';
import { OAUTH_VERIFIER, type OAuthVerifier } from './oauth/oauth-verifier';
import type { RequestPrincipal } from './rbac/types';

interface ReqCtx {
  ip?: string;
  userAgent?: string;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * [Inc-35] Email+password and OAuth (Apple + Google) sign-in — ALONGSIDE phone-OTP, all resolving to ONE
 * account. Security-first:
 *   • Passwords hashed (bcrypt), never stored/logged raw; login is rate-limited + locks out.
 *   • Email verification + password reset use single-use, expiring, HASHED tokens delivered by email.
 *   • OAuth ID tokens are verified SERVER-SIDE against the provider JWKS (client claims never trusted);
 *     accounts dedupe by VERIFIED email, and a pre-hijack (password-registered-but-unverified email that a
 *     provider later proves) clears the unverified password.
 *   • Registration is the referral capture point — it calls ReferralService.attributeReferral inside the
 *     signup transaction; a bad/self/absent code never fails the signup.
 * The `000000` OTP dev bypass is NOT reachable here — these methods have no bypass.
 */
@Injectable()
export class CredentialAuthService {
  private readonly logger = new Logger(CredentialAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly referral: ReferralService,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(OAUTH_VERIFIER) private readonly oauth: OAuthVerifier,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private get orgId(): string {
    return this.config.signupOrgId;
  }

  private get devEcho(): boolean {
    // Only in the console email transport off-prod — mirrors the OTP devCode echo.
    return this.config.email.transport === 'console' && process.env.NODE_ENV !== 'production';
  }

  // ─────────────────────────── email + password ───────────────────────────

  async register(dto: RegisterDto, ctx: ReqCtx): Promise<AuthResultView & { devToken?: string }> {
    const orgId = this.orgId;
    const existing = await this.prisma.user.findFirst({ where: { orgId, email: dto.email }, select: { id: true } });
    if (existing) {
      throw new ConflictException({ error: AUTH_CRED_ERRORS.EMAIL_TAKEN, message: 'That email is already registered.' });
    }
    const passwordHash = await this.password.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await this.provisionCustomer(tx, {
        orgId,
        name: dto.name,
        email: dto.email,
        provider: 'password',
        passwordHash,
        emailVerifiedAt: null,
        referralCode: dto.referralCode,
      });
      await this.writeAudit({ orgId, actorId: u.id, entity: 'User', entityId: u.id, action: 'AUTH_REGISTER', after: { provider: 'password' } }, tx);
      return u;
    });
    // Best-effort (lazy backstop on first /referral read): mint the new user's own invite code.
    await this.referral.ensureCode(user.id, orgId).catch(() => undefined);

    const devToken = await this.issueEmailToken(user, 'EMAIL_VERIFY');
    const tokens = await this.tokens.issuePair(user, ctx);
    return { tokens, emailVerified: false, provider: 'password', created: true, ...(devToken ? { devToken } : {}) };
  }

  async loginEmail(dto: EmailLoginDto, ctx: ReqCtx): Promise<AuthResultView> {
    const orgId = this.orgId;
    if (await this.isLocked(dto.email)) {
      throw new UnauthorizedException({ error: AUTH_CRED_ERRORS.ACCOUNT_LOCKED, message: 'Too many attempts — try again later.' });
    }
    const user = await this.prisma.user.findFirst({ where: { orgId, email: dto.email } });
    // Uniform failure whether the email is unknown or has no password (no account enumeration).
    const ok = user?.passwordHash ? await this.password.verify(dto.password, user.passwordHash) : false;
    if (!user || !user.passwordHash || !ok || user.status !== 'ACTIVE') {
      await this.recordLoginFailure(dto.email);
      throw new UnauthorizedException({ error: AUTH_CRED_ERRORS.INVALID_CREDENTIALS, message: 'Invalid email or password.' });
    }
    await this.clearLoginFailures(dto.email);
    const tokens = await this.tokens.issuePair(user, ctx);
    await this.writeAudit({ orgId, actorId: user.id, entity: 'User', entityId: user.id, action: 'AUTH_EMAIL_LOGIN' });
    return { tokens, emailVerified: user.emailVerifiedAt != null, provider: 'password', created: false };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ emailVerified: true }> {
    const row = await this.consumeToken(dto.token, 'EMAIL_VERIFY');
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    await this.writeAudit({ orgId: row.orgId, actorId: row.userId, entity: 'User', entityId: row.userId, action: 'AUTH_EMAIL_VERIFIED' });
    return { emailVerified: true };
  }

  async requestPasswordReset(dto: PasswordResetRequestDto): Promise<{ devToken?: string }> {
    const user = await this.prisma.user.findFirst({ where: { orgId: this.orgId, email: dto.email }, select: { id: true, orgId: true, email: true, name: true, status: true } });
    // Enumeration-resistant: same shape whether or not the email exists; only send when it does.
    if (!user || user.status !== 'ACTIVE') return {};
    const devToken = await this.issueEmailToken(user, 'PASSWORD_RESET');
    return devToken ? { devToken } : {};
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<{ ok: true }> {
    const row = await this.consumeToken(dto.token, 'PASSWORD_RESET');
    const passwordHash = await this.password.hash(dto.password);
    await this.prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash, authProviders: await this.withProvider(row.userId, 'password') },
    });
    // A reset revokes every existing session (a reset is also the recovery path after a compromise).
    await this.tokens.logout(row.userId);
    await this.clearLoginFailuresByUser(row.userId);
    await this.writeAudit({ orgId: row.orgId, actorId: row.userId, entity: 'User', entityId: row.userId, action: 'AUTH_PASSWORD_RESET' });
    return { ok: true };
  }

  // ─────────────────────────── OAuth (Apple + Google) ───────────────────────────

  async oauthSignIn(dto: OAuthSignInDto, ctx: ReqCtx): Promise<AuthResultView> {
    const orgId = this.orgId;
    const claims = await this.oauth.verify(dto.provider, dto.idToken); // server-side; throws on bad token
    if (!claims.email || !claims.emailVerified) {
      throw new UnauthorizedException({ error: AUTH_CRED_ERRORS.PROVIDER_EMAIL_UNVERIFIED, message: 'The provider did not supply a verified email.' });
    }
    const email = claims.email;
    const existing = await this.prisma.user.findFirst({ where: { orgId, email } });

    if (existing) {
      // Link this provider to the existing account (dedupe by verified email). If the account had an
      // UNVERIFIED, password-only email (a pre-hijack risk), the provider now proves the real owner —
      // clear that unverified password so a pre-registered password can't be used against them.
      const clearsUnverifiedPassword = existing.emailVerifiedAt == null && existing.passwordHash != null;
      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          authProviders: await this.withProvider(existing.id, dto.provider),
          ...(clearsUnverifiedPassword ? { passwordHash: null } : {}),
        },
      });
      const tokens = await this.tokens.issuePair(existing, ctx);
      await this.writeAudit({ orgId, actorId: existing.id, entity: 'User', entityId: existing.id, action: 'AUTH_OAUTH_LOGIN', after: { provider: dto.provider, linked: true } });
      return { tokens, emailVerified: true, provider: dto.provider, created: false };
    }

    // No account for this verified email → create one (email already verified by the provider).
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await this.provisionCustomer(tx, {
        orgId,
        name: this.nameFromEmail(email),
        email,
        provider: dto.provider,
        passwordHash: null,
        emailVerifiedAt: new Date(),
        referralCode: dto.referralCode,
      });
      await this.writeAudit({ orgId, actorId: u.id, entity: 'User', entityId: u.id, action: 'AUTH_OAUTH_LOGIN', after: { provider: dto.provider, created: true } }, tx);
      return u;
    });
    await this.referral.ensureCode(user.id, orgId).catch(() => undefined);
    const tokens = await this.tokens.issuePair(user, ctx);
    return { tokens, emailVerified: true, provider: dto.provider, created: true };
  }

  // ─────────────────────────── account security (authenticated) ───────────────────────────

  async getSecurity(principal: RequestPrincipal): Promise<AccountSecurityView> {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: principal.userId, orgId: principal.orgId } });
    return this.toSecurityView(user);
  }

  async setPassword(principal: RequestPrincipal, dto: SetPasswordDto): Promise<AccountSecurityView> {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: principal.userId, orgId: principal.orgId } });
    if (user.passwordHash) {
      // Changing an existing password requires proving the current one.
      const ok = dto.currentPassword ? await this.password.verify(dto.currentPassword, user.passwordHash) : false;
      if (!ok) throw new UnauthorizedException({ error: AUTH_CRED_ERRORS.WRONG_PASSWORD, message: 'Current password is incorrect.' });
    }
    const passwordHash = await this.password.hash(dto.newPassword);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, authProviders: await this.withProvider(user.id, 'password') },
    });
    await this.writeAudit({ orgId: user.orgId, actorId: user.id, entity: 'User', entityId: user.id, action: 'AUTH_PASSWORD_SET' });
    return this.toSecurityView(updated);
  }

  async unlinkMethod(principal: RequestPrincipal, provider: AuthProvider): Promise<AccountSecurityView> {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: principal.userId, orgId: principal.orgId } });
    const methods = this.methodsOf(user);
    if (!methods.includes(provider)) return this.toSecurityView(user); // idempotent
    if (methods.length <= 1) {
      throw new ConflictException({ error: AUTH_CRED_ERRORS.LAST_METHOD, message: 'You must keep at least one sign-in method.' });
    }
    const next = methods.filter((m) => m !== provider);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { authProviders: { set: next }, ...(provider === 'password' ? { passwordHash: null } : {}) },
    });
    await this.writeAudit({ orgId: user.orgId, actorId: user.id, entity: 'User', entityId: user.id, action: 'AUTH_METHOD_UNLINKED', after: { provider } });
    return this.toSecurityView(updated);
  }

  // ─────────────────────────── helpers ───────────────────────────

  /** Create User + personal Account + RESIDENTIAL_CUSTOMER role, and capture inbound referral (in-tx). */
  private async provisionCustomer(
    tx: Prisma.TransactionClient,
    args: { orgId: string; name: string; email?: string | null; phone?: string | null; provider: AuthProvider; passwordHash: string | null; emailVerifiedAt: Date | null; referralCode?: string },
  ): Promise<User> {
    const account = await tx.account.create({ data: { orgId: args.orgId, type: 'RESIDENTIAL', name: args.name } });
    const user = await tx.user.create({
      data: {
        orgId: args.orgId,
        name: args.name,
        email: args.email ?? null,
        phone: args.phone ?? null,
        authProviders: [args.provider],
        status: 'ACTIVE',
        passwordHash: args.passwordHash,
        emailVerifiedAt: args.emailVerifiedAt,
      },
    });
    await tx.userRole.create({ data: { orgId: args.orgId, userId: user.id, role: 'RESIDENTIAL_CUSTOMER', scope: 'ACCOUNT', scopeId: account.id } });
    // Referral capture — in the SAME transaction; never throws / never fails the signup.
    if (args.referralCode) await this.referral.attributeReferral(user.id, args.orgId, args.referralCode, tx);
    return tx.user.findUniqueOrThrow({ where: { id: user.id } });
  }

  /** Generate a single-use email token, store its HASH, send the raw token by email; echo it in dev. */
  private async issueEmailToken(user: Pick<User, 'id' | 'orgId' | 'email' | 'name'>, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET'): Promise<string | undefined> {
    const raw = randomBytes(32).toString('base64url');
    const ttl = purpose === 'EMAIL_VERIFY' ? this.config.credential.verifyTokenTtlSeconds : this.config.credential.resetTokenTtlSeconds;
    await this.prisma.authToken.create({
      data: { orgId: user.orgId, userId: user.id, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttl * 1000) },
    });
    const subject = purpose === 'EMAIL_VERIFY' ? 'Verify your Blue Bee email' : 'Reset your Blue Bee password';
    const body =
      purpose === 'EMAIL_VERIFY'
        ? `Hi ${user.name},\n\nConfirm your email for Blue Bee with this code:\n\n${raw}\n\nIt expires in ${Math.round(ttl / 3600)} hour(s).`
        : `Hi ${user.name},\n\nUse this code to reset your Blue Bee password:\n\n${raw}\n\nIt expires in ${Math.round(ttl / 60)} minute(s). If you didn't ask, ignore this email.`;
    if (user.email) {
      await this.email.send({ to: user.email, subject, text: body }).catch((e) => this.logger.warn(`email send failed: ${(e as Error).message}`));
    }
    return this.devEcho ? raw : undefined;
  }

  /** Look up a single-use token by hash, validate (purpose/expiry/unconsumed), and consume it atomically. */
  private async consumeToken(raw: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET'): Promise<{ userId: string; orgId: string }> {
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!row || row.purpose !== purpose || row.consumedAt) {
      throw new UnauthorizedException({ error: AUTH_CRED_ERRORS.TOKEN_INVALID, message: 'This link is invalid or already used.' });
    }
    if (row.expiresAt <= new Date()) {
      throw new UnauthorizedException({ error: AUTH_CRED_ERRORS.TOKEN_EXPIRED, message: 'This link has expired.' });
    }
    // Atomic single-use claim (race-proof): only one caller flips consumed_at from null.
    const claim = await this.prisma.authToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (claim.count === 0) {
      throw new UnauthorizedException({ error: AUTH_CRED_ERRORS.TOKEN_INVALID, message: 'This link is invalid or already used.' });
    }
    return { userId: row.userId, orgId: row.orgId };
  }

  /** Union the current authProviders with `provider` (idempotent, de-duped). */
  private async withProvider(userId: string, provider: AuthProvider): Promise<{ set: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { authProviders: true } });
    const set = Array.from(new Set([...user.authProviders, provider]));
    return { set };
  }

  private methodsOf(user: Pick<User, 'authProviders'>): AuthProvider[] {
    const known: readonly string[] = ['otp', 'password', 'google', 'apple'];
    return user.authProviders.filter((p): p is AuthProvider => known.includes(p));
  }

  private toSecurityView(user: User): AccountSecurityView {
    return {
      email: user.email,
      emailVerified: user.emailVerifiedAt != null,
      phone: user.phone,
      hasPassword: user.passwordHash != null,
      methods: this.methodsOf(user),
    };
  }

  private nameFromEmail(email: string): string {
    const local = email.split('@')[0] ?? 'Customer';
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  /** Append an immutable audit row (attributed to the actor). Written directly (not via AuditService) so
   *  this service stays free of OrdersModule — see the module-cycle note on ReferralModule. tx-aware. */
  private async writeAudit(
    entry: { orgId: string; actorId: string; entity: string; entityId: string; action: string; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        orgId: entry.orgId,
        actorId: entry.actorId,
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        before: entry.before,
        after: entry.after,
        createdBy: entry.actorId,
      },
    });
  }

  // ── login rate-limit / lockout (Redis) ──
  private failKey(email: string): string {
    return `cred:login:fail:${email}`;
  }
  private lockKey(email: string): string {
    return `cred:login:lock:${email}`;
  }
  private async isLocked(email: string): Promise<boolean> {
    return (await this.redis.exists(this.lockKey(email))) === 1;
  }
  private async recordLoginFailure(email: string): Promise<void> {
    const n = await this.redis.incr(this.failKey(email));
    if (n === 1) await this.redis.expire(this.failKey(email), this.config.credential.loginWindowSeconds);
    if (n >= this.config.credential.loginMaxAttempts) {
      await this.redis.set(this.lockKey(email), '1', 'EX', this.config.credential.lockoutSeconds);
    }
  }
  private async clearLoginFailures(email: string): Promise<void> {
    await this.redis.del(this.failKey(email), this.lockKey(email));
  }
  private async clearLoginFailuresByUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user?.email) await this.clearLoginFailures(user.email);
  }
}
