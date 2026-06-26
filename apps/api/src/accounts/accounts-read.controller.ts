import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType, listAccountsQuerySchema, type ListAccountsQuery } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AccountsReadService } from './accounts-read.service';

/**
 * Account directory reads (Track-A B2B account console). `/v1/accounts` (list) + `/v1/accounts/:id`
 * (detail header). Read-only `/v1` routes, problem+json, org-scoped in the service. RBAC: org-wide
 * ops + finance staff (OWNER/FINANCE/DISPATCHER/CSR) — DRIVER (self-scoped) and account/residential
 * roles → 403. Distinct GET routes that never collide with the recurring module's
 * `accounts/:id/{billing-terms,invoices/batch,generated}` sub-paths or the account-deletion
 * controller's `/account` (singular) base.
 */
@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsReadController {
  static readonly READ_ROLES = [RoleType.OWNER, RoleType.FINANCE, RoleType.DISPATCHER, RoleType.CSR];

  constructor(private readonly accounts: AccountsReadService) {}

  @Get()
  @Roles(...AccountsReadController.READ_ROLES)
  @ApiOperation({ summary: 'List the org\'s accounts (cursor-paginated) with site + active-standing-order counts.' })
  list(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listAccountsQuerySchema)) q: ListAccountsQuery) {
    return this.accounts.list(p, q);
  }

  @Get(':accountId')
  @Roles(...AccountsReadController.READ_ROLES)
  @ApiOperation({ summary: 'Account detail header (billing terms + counts). Org-scoped; a cross-org id → 404.' })
  get(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.accounts.get(p, accountId);
  }
}
