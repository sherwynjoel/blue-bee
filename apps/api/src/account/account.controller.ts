import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AccountProfileView, ReferralView, ReferralsView } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { ReferralService } from '../referral/referral.service';
import { AccountService } from './account.service';
import {
  deleteAccountSchema,
  updateProfileSchema,
  type AccountDeletionResult,
  type DeleteAccountDto,
  type UpdateProfileDto,
} from './account.dto';

/**
 * Self-service account deletion (App Store guideline 5.1.1(v) / Google Play account-deletion policy).
 * Any authenticated user can delete THEIR OWN account — no `@Roles`, so the global JwtAuthGuard is the
 * only gate (401 without a valid token). The user is taken from the verified token; see AccountService
 * for the anonymize-in-place + PII-purge policy (real erasure, audited, no schema change).
 */
@ApiTags('account')
@ApiBearerAuth()
@Controller('account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly referral: ReferralService,
  ) {}

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Delete the authenticated user's own account — purges PII children + anonymizes the user row " +
      '(irreversible), audited. Self-only (a body targeting another userId → 403).',
  })
  deleteAccount(
    @CurrentUser() principal: RequestPrincipal,
    @Body(new ZodBody(deleteAccountSchema)) dto: DeleteAccountDto,
  ): Promise<AccountDeletionResult> {
    return this.account.deleteAccount(principal, dto);
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Update the authenticated user's OWN profile (name / email). Self-only (a body targeting another " +
      'userId → 403); email is unique per org (409 email_taken on collision); phone is read-only (login).',
  })
  updateProfile(
    @CurrentUser() principal: RequestPrincipal,
    @Body(new ZodBody(updateProfileSchema)) dto: UpdateProfileDto,
  ): Promise<AccountProfileView> {
    return this.account.updateProfile(principal, dto);
  }

  // ─────────────────────────── referral (Inc-34 — invite + code, reward deferred) ───────────────────────────

  @Get('referral')
  @ApiOperation({
    summary:
      "The signed-in customer's OWN invite code (minted on first read, stable thereafter) + a shareUrl " +
      '(only when a deep-link base is configured, else null — never a fabricated domain). Self-scoped.',
  })
  getReferral(@CurrentUser() principal: RequestPrincipal): Promise<ReferralView> {
    return this.referral.getReferral(principal);
  }

  @Get('referrals')
  @ApiOperation({
    summary: 'Who joined via MY code (name-minimal + count), row-scoped to the signed-in user. No reward data.',
  })
  getReferrals(@CurrentUser() principal: RequestPrincipal): Promise<ReferralsView> {
    return this.referral.getReferrals(principal);
  }
}
