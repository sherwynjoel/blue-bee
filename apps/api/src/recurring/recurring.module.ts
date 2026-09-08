import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { RECURRING_CONFIG, loadRecurringConfig } from './recurring.config';
import { StandingOrderService } from './standing-order.service';
import { AccountBillingService } from './account-billing.service';
import { StandingOrderGenerationService } from './standing-order-generation.service';
import { StandingOrdersController } from './standing-orders.controller';
import { AccountBillingController } from './account-billing.controller';

/**
 * Recurring / Track-A module (condo B2B foundation, PRD §9.2/§14/§9.1/§11). Standing-order CRUD +
 * the idempotent generation job (real Orders → recurring Route via the Inc-4 PostGIS sequencer, with
 * graceful degradation + a first-class CONCIERGE handoff stop) + per-account billing terms + the
 * batch/periodic invoicing path. Thin + additive (mirrors Inc-15 Analytics / Inc-16 Admin): imports
 * OrdersModule for the shared `AuditService` and LogisticsModule for the exported `OptimizerService`
 * (the one in-house sequencer — no duplication). Cost-center billing + par/soil/pack-to-par are
 * DEFERRED (Phase 2 — modeled-for, not built).
 */
@Module({
  imports: [PrismaModule, OrdersModule, LogisticsModule],
  controllers: [StandingOrdersController, AccountBillingController],
  providers: [
    { provide: RECURRING_CONFIG, useFactory: loadRecurringConfig },
    StandingOrderService,
    AccountBillingService,
    StandingOrderGenerationService,
    IdempotencyInterceptor,
  ],
  exports: [StandingOrderGenerationService],
})
export class RecurringModule {}
