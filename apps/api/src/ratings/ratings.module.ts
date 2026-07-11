import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { OrdersModule } from '../orders/orders.module';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';

/**
 * [Inc-32] Ratings / CSAT module (PRD A6.3). Reuses the global PrismaModule/RedisModule and the
 * OrdersModule's exported `OrderAccessService` (the parent-ownership gate) — no duplicated scoping.
 * Exports `RatingsService` in case a later surface (owner app) needs to read ratings server-side.
 */
@Module({
  imports: [OrdersModule],
  controllers: [RatingsController],
  providers: [RatingsService, IdempotencyInterceptor],
  exports: [RatingsService],
})
export class RatingsModule {}
