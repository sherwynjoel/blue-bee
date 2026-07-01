import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { ServiceZonesModule } from '../service-zones/service-zones.module';
import { AuditService } from './audit.service';
import { IntakeService } from './intake.service';
import { OrderAccessService } from './order-access.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PricingService } from './pricing.service';
import { PricingAccountService } from './pricing-account.service';
import { QuoteService } from './quote.service';
import { OrderStateMachine } from './state-machine.service';

/**
 * Orders module (Increment 3, BUILD-PLAN item 5) — specialty book → intake/inspection
 * → quote → approve/decline. Reuses the global PrismaModule/RedisModule and the global
 * JwtAuthGuard → RolesGuard (Increment 2). Stops at QUOTE_APPROVED (no cleaning/QC/
 * logistics/billing).
 */
@Module({
  // [Inc-19] ServiceZonesModule exports ServiceZonesService (the booking geo-block gate). One-directional
  // (ServiceZonesModule does NOT import OrdersModule) → no cycle.
  imports: [ServiceZonesModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    IntakeService,
    QuoteService,
    PricingService,
    PricingAccountService,
    OrderStateMachine,
    OrderAccessService,
    AuditService,
    IdempotencyInterceptor,
  ],
  // Reused by the logistics module (Increment 4): the order state machine + parent-ownership
  // gate drive the pickup leg, and the audit writer is shared. OrdersService is exported so the
  // Track-A B2B portal's account-scoped orders read can DELEGATE to its proven listing logic
  // (GET /v1/accounts/:accountId/orders → OrdersService.listOrders) — no duplicated query.
  exports: [OrderStateMachine, OrderAccessService, AuditService, OrdersService, PricingService],
})
export class OrdersModule {}
