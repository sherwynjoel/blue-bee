import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  RoleType,
  costCenterReportQuerySchema,
  createCostCenterSchema,
  listCostCentersQuerySchema,
  updateCostCenterSchema,
  type CostCenterReportQuery,
  type CreateCostCenterDto,
  type ListCostCentersQuery,
  type UpdateCostCenterDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { CostCentersService } from './cost-centers.service';

/**
 * Account-scoped cost-centre CRUD + the per-cost-centre period report/CSV (Track A Phase 2, PRD
 * §B4.1/§A5.2/§B5.2). `/v1/accounts/:accountId/cost-centers...` — org-scoped, problem+json, audited.
 * RBAC (§17.3): create is finance-sensitive (OWNER/FINANCE); list + report + export are ops/finance
 * read (OWNER/FINANCE/DISPATCHER/CSR). Distinct sub-paths so it never collides with the existing
 * account routes (billing-terms / invoices/batch / generated).
 */
@ApiTags('cost-centers')
@ApiBearerAuth()
@Controller('accounts')
export class CostCentersController {
  static readonly FINANCE = [RoleType.OWNER, RoleType.FINANCE];
  static readonly OPS_FINANCE_READ = [RoleType.OWNER, RoleType.FINANCE, RoleType.DISPATCHER, RoleType.CSR];

  constructor(private readonly service: CostCentersService) {}

  @Post(':accountId/cost-centers')
  @Roles(...CostCentersController.FINANCE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a cost centre under an account (code unique per account → 409; cross-org account → 404). Audited.' })
  create(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string, @Body(new ZodBody(createCostCenterSchema)) dto: CreateCostCenterDto) {
    return this.service.create(p, accountId, dto);
  }

  @Get(':accountId/cost-centers')
  @Roles(...CostCentersController.OPS_FINANCE_READ)
  @ApiOperation({ summary: "List an account's cost centres (optional ?active filter). Org-scoped; cross-org id → 404." })
  list(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string, @Query(new ZodBody(listCostCentersQuerySchema)) q: ListCostCentersQuery) {
    return this.service.list(p, accountId, q);
  }

  @Get(':accountId/cost-centers/report')
  @Roles(...CostCentersController.OPS_FINANCE_READ)
  @ApiOperation({ summary: 'Per-cost-centre totals over [from, to) (account-scoped; orders by created-at, with an explicit Unassigned bucket).' })
  report(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string, @Query(new ZodBody(costCenterReportQuerySchema)) q: CostCenterReportQuery) {
    return this.service.report(p, accountId, q);
  }

  @Get(':accountId/cost-centers/report.csv')
  @Roles(...CostCentersController.OPS_FINANCE_READ)
  @ApiOperation({ summary: 'The §B5.2 cost-centre export — the period report as real CSV bytes (account-scoped attachment).' })
  async reportCsv(
    @CurrentUser() p: RequestPrincipal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query(new ZodBody(costCenterReportQuerySchema)) q: CostCenterReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { filename, csv } = await this.service.reportCsv(p, accountId, q);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
    return csv;
  }
}

/**
 * Cost-centre rename / activate-deactivate by id (PRD §B4.1). `PATCH /v1/cost-centers/:id` — separated
 * from the account-scoped controller so the id-addressed mutation has its own clean base path. Finance.
 */
@ApiTags('cost-centers')
@ApiBearerAuth()
@Controller('cost-centers')
export class CostCenterAdminController {
  constructor(private readonly service: CostCentersService) {}

  @Patch(':id')
  @Roles(...CostCentersController.FINANCE)
  @ApiOperation({ summary: 'Rename / re-classify / activate-deactivate a cost centre (org-scoped; cross-org id → 404). Audited.' })
  update(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(updateCostCenterSchema)) dto: UpdateCostCenterDto) {
    return this.service.update(p, id, dto);
  }
}
