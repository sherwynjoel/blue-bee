import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType } from '@blue-bee/shared';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { TrackingReadService } from './tracking-read.service';

/**
 * Customer "track my truck" read (PRD §6.1(a), §6.4 US-T1, §11.1 `GET /orders/:id/tracking`,
 * §12.2 privacy). Returns the last-known of EXACTLY the one vehicle on the order's active
 * stop, scoped to the owning customer (cross-account/org → 404). Staff (org-wide) may also
 * read for support. The short-lived signed channel token + live WS stream are Increment 6 —
 * here it is a scoped poll of last-known.
 */
@ApiTags('tracking')
@ApiBearerAuth()
@Controller('orders')
export class OrderTrackingController {
  constructor(private readonly read: TrackingReadService) {}

  @Get(':id/tracking')
  @Roles(
    RoleType.OWNER,
    RoleType.DISPATCHER,
    RoleType.CSR,
    RoleType.RESIDENTIAL_CUSTOMER,
    RoleType.ACCOUNT_ADMIN,
    RoleType.ACCOUNT_STAFF,
  )
  @ApiOperation({ summary: "Last-known of the single vehicle assigned to the order's active stop (owning customer; one vehicle only)." })
  tracking(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.read.orderTracking(p, id);
  }
}
