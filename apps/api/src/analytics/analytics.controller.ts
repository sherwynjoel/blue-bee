import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RoleType } from '@blue-bee/shared';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics reads (Increment 15, PRD §13 / Epic B6.1 "MVP basic") — the operational + commercial
 * dashboards and the per-account scorecard the web console renders. Read-only `/v1` slash routes,
 * problem+json, org-scoped in the service. RBAC is per-dashboard (§7B / §17.3):
 *   • operational → ALL org-wide staff (OWNER/DISPATCHER/CSR/PLANT_OP/FINANCE); DRIVER is org-staff
 *     but self-scoped (its own stops), not an analytics consumer → 403.
 *   • commercial  → finance-sensitive (OWNER/FINANCE — revenue, AR, conversion).
 *   • scorecard   → OWNER/FINANCE/CSR; org-scoped (reuse-ready for a Phase-2 B2B portal, but NOT
 *     exposed in the customer app this increment).
 * A non-authorized role → 403 (RolesGuard). All aggregation is server-authoritative.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  /** Operational dashboard — all org-wide staff (DRIVER is org-staff but self-scoped, not analytics). */
  static readonly OPERATIONAL_ROLES = [
    RoleType.OWNER,
    RoleType.DISPATCHER,
    RoleType.CSR,
    RoleType.PLANT_OP,
    RoleType.FINANCE,
  ];
  /** Commercial dashboard — finance-sensitive (revenue / AR / conversion). */
  static readonly COMMERCIAL_ROLES = [RoleType.OWNER, RoleType.FINANCE];
  /** Per-account scorecard (org-scoped; reuse-ready for a Phase-2 B2B portal). */
  static readonly SCORECARD_ROLES = [RoleType.OWNER, RoleType.FINANCE, RoleType.CSR];

  constructor(private readonly analytics: AnalyticsService) {}

  @Get('operational')
  @Roles(...AnalyticsController.OPERATIONAL_ROLES)
  @ApiOperation({
    summary:
      'Operational dashboard — on-time %, route adherence, stops/hour, dwell, failed/skip, items-lost, rewash, throughput (PRD §13).',
  })
  @ApiQuery({ name: 'from', required: false, description: 'ISO-8601 start (inclusive). Default: 30d before `to`.' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO-8601 end (exclusive). Default: now.' })
  operational(@CurrentUser() p: RequestPrincipal, @Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.operational(p, from, to);
  }

  @Get('commercial')
  @Roles(...AnalyticsController.COMMERCIAL_ROLES)
  @ApiOperation({
    summary:
      'Commercial dashboard — tracked GMV, jobs/week, repeat rate, revenue/route, AR aging, quote conversion, damage-claim rate (PRD §13).',
  })
  @ApiQuery({ name: 'from', required: false, description: 'ISO-8601 start (inclusive). Default: 30d before `to`.' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO-8601 end (exclusive). Default: now.' })
  commercial(@CurrentUser() p: RequestPrincipal, @Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.commercial(p, from, to);
  }

  @Get('accounts/:accountId/scorecard')
  @Roles(...AnalyticsController.SCORECARD_ROLES)
  @ApiOperation({
    summary: 'Per-account scorecard — loss rate, on-time %, monthly spend (PRD §13). Org-scoped; a cross-org id → 404.',
  })
  @ApiQuery({ name: 'from', required: false, description: 'ISO-8601 start (inclusive). Default: 30d before `to`.' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO-8601 end (exclusive). Default: now.' })
  scorecard(
    @CurrentUser() p: RequestPrincipal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.accountScorecard(p, accountId, from, to);
  }
}
