import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType, listOrdersQuerySchema, type ListOrdersQuery } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AccountsPortalService } from './accounts-portal.service';

/**
 * Account portal reads (Track-A B2B account console — the Orders / Manifests / Exceptions tabs).
 * `/v1/accounts/:accountId/{orders,manifests,exceptions}` — read-only, problem+json, org-scoped in the
 * service (a cross-org id → 404). RBAC mirrors the directory reads: org-wide ops + finance staff
 * (OWNER/FINANCE/DISPATCHER/CSR) — DRIVER + account/residential roles → 403. Distinct sub-paths that
 * never collide with the directory (`/accounts/:id`) or the recurring module's
 * `/accounts/:id/{billing-terms,invoices/batch,generated}`.
 */
@ApiTags('account-portal')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsPortalController {
  static readonly READ_ROLES = [RoleType.OWNER, RoleType.FINANCE, RoleType.DISPATCHER, RoleType.CSR];

  constructor(private readonly portal: AccountsPortalService) {}

  @Get(':accountId/orders')
  @Roles(...AccountsPortalController.READ_ROLES)
  @ApiOperation({ summary: "List an account's orders (cursor-paginated; delegates to the proven order listing). Cross-org id → 404." })
  orders(
    @CurrentUser() p: RequestPrincipal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query(new ZodBody(listOrdersQuerySchema)) q: ListOrdersQuery,
  ) {
    return this.portal.listOrders(p, accountId, q);
  }

  @Get(':accountId/manifests')
  @Roles(...AccountsPortalController.READ_ROLES)
  @ApiOperation({ summary: "View the account's recent route-stop manifests (read-only — does not generate). Cross-org id → 404." })
  manifests(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.portal.manifests(p, accountId);
  }

  @Get(':accountId/exceptions')
  @Roles(...AccountsPortalController.READ_ROLES)
  @ApiOperation({ summary: "The account's exceptions feed (failed/skipped stops, held orders, open disputes, failed payments). Cross-org id → 404." })
  exceptions(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.portal.exceptions(p, accountId);
  }
}
