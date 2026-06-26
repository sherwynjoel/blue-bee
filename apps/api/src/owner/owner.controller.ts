import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType } from '@blue-bee/shared';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { OwnerService } from './owner.service';

/**
 * Owner cockpit reads (Increment 14a) — the three thin, additive, OWNER-scoped aggregations the owner
 * app needs that did not exist in the as-built: the day numbers (§7C C2), the pending-approvals list
 * (§7C C3), and the exceptions feed (§7C C4). The whole controller is gated to **OWNER** (§17.3 —
 * the owner cockpit is the owner's; finance/ops use the web console), and every query is org-scoped
 * in the service. Read-only slash routes; the owner ACTS via the proven order/quote endpoints.
 */
@ApiTags('owner')
@ApiBearerAuth()
@Roles(RoleType.OWNER)
@Controller('owner')
export class OwnerController {
  constructor(private readonly owner: OwnerService) {}

  @Get('today')
  @ApiOperation({ summary: "Today's glanceable numbers (orders, GMV, collected, on-time %, exceptions) — PRD §7C C2." })
  today(@CurrentUser() p: RequestPrincipal) {
    return this.owner.today(p);
  }

  @Get('approvals')
  @ApiOperation({ summary: 'Pending quote approvals (QUOTED orders) — PRD §7C C3. Act via /orders/:id/quote:approve|:decline.' })
  approvals(@CurrentUser() p: RequestPrincipal) {
    return this.owner.approvals(p);
  }

  @Get('exceptions')
  @ApiOperation({ summary: 'Exceptions feed: failed/skipped stops, held orders, open disputes, failed payments — PRD §7C C4.' })
  exceptions(@CurrentUser() p: RequestPrincipal) {
    return this.owner.exceptions(p);
  }
}
