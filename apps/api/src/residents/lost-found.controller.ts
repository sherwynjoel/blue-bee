import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listResidentsQuerySchema,
  reconcileSchema,
  type ListResidentsQuery,
  type ReconcileDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { GarmentService } from './garment.service';
import { ResidentsController } from './residents.controller';

/**
 * Lost & found pool + reconciliation (Track-B care homes, PRD §5.2-B / B3.3). `/v1/lost-found` —
 * the site's OPEN pool + a per-site reconciliation report (counts + items), read-gated to ops + the
 * account's own staff (audited — candidate resident names are PII). `reconcile` (a plant operation)
 * assigns a pooled garment back to a resident.
 */
@ApiTags('lost-found')
@ApiBearerAuth()
@Controller('lost-found')
export class LostFoundController {
  constructor(private readonly garments: GarmentService) {}

  @Get()
  @Roles(...ResidentsController.READ)
  @ApiOperation({ summary: "A site's OPEN lost & found pool. Audited. A site outside scope → 404." })
  pool(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listResidentsQuerySchema)) q: ListResidentsQuery) {
    return this.garments.lostFoundPool(p, q.siteId);
  }

  @Get('report')
  @Roles(...ResidentsController.READ)
  @ApiOperation({ summary: 'Reconciliation report for a site (open/reconciled counts + items). Audited.' })
  report(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listResidentsQuerySchema)) q: ListResidentsQuery) {
    return this.garments.reconciliationReport(p, q.siteId);
  }

  @Post(':lostFoundId/reconcile')
  @Roles(...ResidentsController.GARMENT_OPS)
  @ApiOperation({ summary: 'Reconcile a pooled garment back to a resident (LOST_FOUND_POOL → RECONCILE) + custody.' })
  reconcile(
    @CurrentUser() p: RequestPrincipal,
    @Param('lostFoundId', ParseUUIDPipe) lostFoundId: string,
    @Body(new ZodBody(reconcileSchema)) dto: ReconcileDto,
  ) {
    return this.garments.reconcile(p, lostFoundId, dto);
  }
}
