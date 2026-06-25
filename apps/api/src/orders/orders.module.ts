import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { AuditService } from './audit.service';
import { IntakeService } from './intake.service';
import { OrderAccessService } from './order-access.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PricingService } from './pricing.service';
import { QuoteService } from './quote.service';
import { OrderStateMachine } from './state-machine.service';

/**
 * Orders module (Increment 3, BUILD-PLAN item 5) — specialty book → intake/inspection
 * → quote → approve/decline. Reuses the global PrismaModule/RedisModule and the global
 * JwtAuthGuard → RolesGuard (Increment 2). Stops at QUOTE_APPROVED (no cleaning/QC/
 * logistics/billing).
 */
@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    IntakeService,
    QuoteService,
    PricingService,
    OrderStateMachine,
    OrderAccessService,
    AuditService,
    IdempotencyInterceptor,
  ],
  // Reused by the logistics module (Increment 4): the order state machine + parent-ownership
  // gate drive the pickup leg, and the audit writer is shared.
  exports: [OrderStateMachine, OrderAccessService, AuditService],
})
export class OrdersModule {}
