import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics module (Increment 15, PRD §13 / Epic B6.1) — the read-only, RBAC-gated aggregation
 * surface (GET /v1/analytics/operational | /commercial | /accounts/:id/scorecard) the web console
 * renders. Thin + additive (mirrors the Inc-11 CatalogModule / Inc-14a OwnerModule): no schema
 * change, no writes; delegates to the proven scoped Prisma layer.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
