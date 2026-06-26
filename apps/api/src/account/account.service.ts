import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../orders/audit.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import type { AccountDeletionResult, DeleteAccountDto } from './account.dto';

/** The value `User.name` is overwritten with when an account is deleted (no PII, not re-identifiable). */
export const ANONYMIZED_NAME = 'Deleted user';

/**
 * Account self-service deletion (App Store / Play store-rejection blocker).
 *
 * ── Policy: ANONYMIZE-IN-PLACE + PURGE PII CHILDREN (no schema change) ──
 * A hard `user.delete()` is NOT viable on this schema and is NOT what "erasure" should mean here:
 *   • `AuditLog` is append-only (a DB trigger blocks UPDATE/DELETE) and `AuditLog.actor_id` is a
 *     `ON DELETE SET NULL` FK. Deleting a user who has ever acted would fire a SET-NULL *update* on
 *     the audit rows → the trigger raises → the whole delete aborts. (The deleting user is itself an
 *     audit actor via the ACCOUNT_DELETED entry below, so this is unavoidable.)
 *   • `Driver → Shift/Route` and order/financial records are RESTRICT/retained business records.
 * So we do the thing that is both correct and honest for a system with an immutable audit trail:
 *
 *   1. PURGE the rows that are purely the user's PII / access / device data (hard delete):
 *        refreshTokens (kills every session), deviceTokens + devices (push + device identifiers),
 *        notifications + notificationPreference (delivered-comms PII), userRoles (revokes ALL access).
 *   2. SCRUB driver PII in place: Driver.license → null (the Driver row is kept because Shifts/Routes
 *        reference it as operational records; only the PII field is removed).
 *   3. ANONYMIZE the User row itself, irreversibly: name → "Deleted user", email → null, phone → null,
 *        authProviders → [] (severs every external identity, so the old identity can never sign back
 *        in), status → SUSPENDED (no usable login path; OTP can't find the user — phone is gone).
 *   4. AUDIT the action (append a new immutable AuditLog) with a NON-PII summary only — we never copy
 *        the scrubbed name/email/phone into before/after (that would re-store what we just erased).
 *
 * What is intentionally RETAINED (documented in docs/COMPLIANCE.md): the anonymized User row (so the
 * immutable audit trail stays valid — itself a compliance control), and operational/business records
 * (orders, invoices, payments, claims, message bodies) which reference Account/Site or an now-anonymous
 * user — kept for legal/tax retention (per PRD §12.4: financial/audit records 7 years). None of these
 * remain personally identifying once the User row is anonymized and the PII children are purged.
 *
 * ── Self-only ──
 * The endpoint operates on `principal.userId` exclusively. A caller may only delete THEMSELVES; a body
 * that targets another `userId` → 403 (a structural impossibility is also enforced explicitly so it is
 * testable). Auth is required (the global JwtAuthGuard → 401 without a valid bearer token).
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async deleteAccount(principal: RequestPrincipal, dto: DeleteAccountDto = {}): Promise<AccountDeletionResult> {
    // A user can only delete themselves. The real target is ALWAYS the token subject; a body that
    // names a different user is refused (403) rather than silently ignored.
    if (dto.userId && dto.userId !== principal.userId) {
      throw new ForbiddenException({
        error: 'forbidden_self_only',
        message: 'You can only delete your own account.',
      });
    }

    const userId = principal.userId;
    const orgId = principal.orgId;

    return this.prisma.$transaction(async (tx) => {
      // Defense-in-depth: confirm the row exists in the caller's org (the JWT already guarantees this,
      // but we never act on a row outside the principal's tenant).
      const user = await tx.user.findFirst({ where: { id: userId, orgId } });
      if (!user) {
        throw new NotFoundException({ error: 'account_not_found', message: 'Account not found.' });
      }

      // 1) Purge pure-PII / access / device children (all org-scoped for tenant safety).
      const removed = {
        refreshTokens: (await tx.refreshToken.deleteMany({ where: { userId, orgId } })).count,
        deviceTokens: (await tx.deviceToken.deleteMany({ where: { userId, orgId } })).count,
        devices: (await tx.device.deleteMany({ where: { userId, orgId } })).count,
        notifications: (await tx.notification.deleteMany({ where: { userId, orgId } })).count,
        notificationPreferences: (await tx.notificationPreference.deleteMany({ where: { userId, orgId } })).count,
        roles: (await tx.userRole.deleteMany({ where: { userId, orgId } })).count,
      };

      // 2) Scrub driver PII in place (Driver row retained — Shifts/Routes reference it). No-op for non-drivers.
      const driversScrubbed = (await tx.driver.updateMany({ where: { userId, orgId }, data: { license: null } }))
        .count;

      // 3) Anonymize the User row itself, irreversibly.
      await tx.user.update({
        where: { id: userId },
        data: {
          name: ANONYMIZED_NAME,
          email: null,
          phone: null,
          authProviders: { set: [] },
          status: 'SUSPENDED',
        },
      });

      // 4) Audit with a NON-PII summary (never the scrubbed values). Append-only INSERT is permitted.
      await this.audit.record(
        {
          orgId,
          actorId: userId, // self-initiated
          entity: 'User',
          entityId: userId,
          action: 'ACCOUNT_DELETED',
          before: { status: user.status, hadEmail: user.email != null, hadPhone: user.phone != null },
          after: { status: 'SUSPENDED', anonymized: true, removed, driversScrubbed },
        },
        tx,
      );

      return { status: 'deleted', userId, anonymized: true, driversScrubbed, removed } satisfies AccountDeletionResult;
    });
  }
}
