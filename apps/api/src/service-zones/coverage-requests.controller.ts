import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType, listCoverageRequestsQuerySchema, type ListCoverageRequestsQuery } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { ServiceZonesService } from './service-zones.service';

/**
 * The captured out-of-zone demand (Increment 19) — the coverage waitlist the console reads. OWNER/FINANCE
 * only, org-scoped, cursor-paginated (mirrors the orders list convention). Read-only: rows are written by the
 * booking gate (OrdersService.book) when a service point falls outside every active zone.
 */
@ApiTags('coverage-requests')
@ApiBearerAuth()
@Controller('coverage-requests')
export class CoverageRequestsController {
  static readonly MANAGE = [RoleType.OWNER, RoleType.FINANCE];

  constructor(private readonly zones: ServiceZonesService) {}

  @Get()
  @Roles(...CoverageRequestsController.MANAGE)
  @ApiOperation({ summary: 'List captured out-of-service-area demand (cursor-paginated), owner/finance only.' })
  list(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listCoverageRequestsQuerySchema)) query: ListCoverageRequestsQuery) {
    return this.zones.listCoverageRequests(p, query);
  }
}
