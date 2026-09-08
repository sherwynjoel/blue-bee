import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CostCentersService } from './cost-centers.service';
import { CostCenterAdminController, CostCentersController } from './cost-centers.controller';
import { OrderCostCenterController } from './order-cost-center.controller';

/**
 * Cost-centre split-billing module (Track A Phase 2, PRD §B4.1/§A5.2/§B5.2). Cost-centre CRUD under an
 * account + order attribution + the per-cost-centre period report/CSV. Thin + additive (mirrors the
 * AccountsModule): imports OrdersModule for the shared `AuditService`. The split-billing ENGINE itself
 * (grouping invoiced lines by cost centre into `Invoice.costCenterBreakdown`) lives in RecurringModule's
 * batch-invoice path — this module owns the cost centres, attribution, and reporting around it.
 */
@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [CostCentersController, CostCenterAdminController, OrderCostCenterController],
  providers: [CostCentersService, IdempotencyInterceptor],
})
export class CostCentersModule {}
