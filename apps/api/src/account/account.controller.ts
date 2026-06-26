import { Body, Controller, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AccountService } from './account.service';
import { deleteAccountSchema, type AccountDeletionResult, type DeleteAccountDto } from './account.dto';

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
  constructor(private readonly account: AccountService) {}

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
}
