import { Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  generateReferralCode,
  isReferralCodeShape,
  normalizeReferralCode,
  type ReferralView,
  type ReferralsView,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';

/** Env holding the customer-app deep-link base for share URLs. Unset ⇒ no shareUrl (never a fake domain). */
const SHARE_BASE_ENV = 'REFERRAL_SHARE_BASE_URL';

/**
 * Referral engine (Increment 34) — invite + code + attribution. **Reward is DEFERRED**: nothing here
 * grants, promises, or tracks any reward; it mints stable invite codes, captures who-referred-whom at
 * signup, and reads that graph back. All operations are org-scoped and (for the customer surface)
 * self-scoped to the principal.
 *
 * Attribution is stored on `User.referredByUserId` (set-once, immutable) — no separate table. The capture
 * entry point ({@link attributeReferral}) is a reusable, transaction-aware method: Inc-34 proves it
 * directly (e2e), and Inc-35's registration path will call it inside the signup transaction.
 */
@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return the user's stable invite code, minting one on first read. Collision-safe AND stable under
   * concurrency: the write only fills a still-null code (`updateMany … referralCode: null`), so two
   * concurrent first-reads converge on ONE code (the loser reads back the winner's), and a candidate that
   * clashes with an existing code (P2002) simply regenerates. The code never changes once set.
   */
  async ensureCode(userId: string, orgId: string): Promise<string> {
    const existing = await this.prisma.user.findFirst({ where: { id: userId, orgId }, select: { referralCode: true } });
    if (!existing) {
      throw new NotFoundException({ error: 'account_not_found', message: 'Account not found.' });
    }
    if (existing.referralCode) return existing.referralCode;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = generateReferralCode((max) => randomInt(max));
      try {
        const res = await this.prisma.user.updateMany({
          where: { id: userId, orgId, referralCode: null },
          data: { referralCode: candidate },
        });
        if (res.count === 1) return candidate;
        // count 0 ⇒ another writer already set this user's code — return theirs (stable).
        const now = await this.prisma.user.findFirst({ where: { id: userId }, select: { referralCode: true } });
        if (now?.referralCode) return now.referralCode;
        // else the row is somehow still null (shouldn't happen) — retry.
      } catch (e) {
        // Candidate collided with SOME other user's code — regenerate and retry.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new Error('could not allocate a unique referral code');
  }

  /** `GET /v1/account/referral` — my code + a shareUrl (only when a deep-link base is really configured). */
  async getReferral(principal: RequestPrincipal): Promise<ReferralView> {
    const code = await this.ensureCode(principal.userId, principal.orgId);
    return { code, shareUrl: this.buildShareUrl(code) };
  }

  /** `GET /v1/account/referrals` — who joined via my code (row-scoped to me), newest first, + a count. */
  async getReferrals(principal: RequestPrincipal): Promise<ReferralsView> {
    const joiners = await this.prisma.user.findMany({
      where: { orgId: principal.orgId, referredByUserId: principal.userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, createdAt: true },
    });
    return {
      count: joiners.length,
      joiners: joiners.map((j) => ({ userId: j.id, name: j.name, joinedAt: j.createdAt.toISOString() })),
    };
  }

  /**
   * Capture attribution for a NEWLY-created customer — the reusable entry point the signup path calls
   * (Inc-35 will call it inside the registration transaction; Inc-34 proves it directly). Pure no-op (never
   * throws, never blocks signup) on every "not attributable" case:
   *   • malformed/unknown code, or a code in another org → no attribution;
   *   • self-referral (own code) → no attribution;
   *   • the user already has a referrer → no-op (set-once, immutable — enforced atomically via the
   *     `referredByUserId: null` guard, so a concurrent double-attempt can't double-write).
   * Returns whether attribution was recorded (for the caller's logging), not an error signal.
   */
  async attributeReferral(
    newUserId: string,
    orgId: string,
    rawCode: string | null | undefined,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ attributed: boolean; referrerId?: string }> {
    if (!rawCode) return { attributed: false };
    const code = normalizeReferralCode(rawCode);
    if (!isReferralCodeShape(code)) return { attributed: false };

    // The referrer must be a real user with this code IN THE SAME ORG (codes are global-unique, but
    // attribution is intra-tenant). Unknown code ⇒ silent no-op.
    const referrer = await tx.user.findFirst({ where: { referralCode: code, orgId }, select: { id: true } });
    if (!referrer || referrer.id === newUserId) return { attributed: false }; // self-referral ⇒ silent

    // Set-once: only fill a still-null referrer. A second attempt (or a race) updates 0 rows ⇒ no-op.
    const res = await tx.user.updateMany({
      where: { id: newUserId, orgId, referredByUserId: null },
      data: { referredByUserId: referrer.id },
    });
    if (res.count === 0) return { attributed: false };

    // Immutable audit (append-only). Written directly (not via AuditService) so this module stays free of
    // OrdersModule — that keeps ReferralModule importable by AuthModule without a dependency cycle.
    await tx.auditLog.create({
      data: {
        orgId,
        actorId: newUserId,
        entity: 'User',
        entityId: newUserId,
        action: 'REFERRAL_ATTRIBUTED',
        after: { referredByUserId: referrer.id },
        createdBy: newUserId,
      },
    });
    return { attributed: true, referrerId: referrer.id };
  }

  /** A share deep-link ONLY when the base is configured; otherwise null (the app shares the bare code). */
  private buildShareUrl(code: string): string | null {
    const base = (process.env[SHARE_BASE_ENV] ?? '').trim();
    if (!base) return null;
    return `${base}${base.includes('?') ? '&' : '?'}ref=${encodeURIComponent(code)}`;
  }
}
