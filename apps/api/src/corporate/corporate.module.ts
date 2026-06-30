import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { CorporateController } from './corporate.controller';
import { CorporateService } from './corporate.service';

/**
 * Corporate accounts module (Increment 15) — corporate-account + building + rate-card management, join-code
 * generation, redeem, and the member's memberships read. Thin + additive (mirrors CostCentersModule):
 * imports OrdersModule for the shared `AuditService` + `PricingService` (the rate card reuses
 * `resolveRate` for its resolved-rate view; the building-match pricing ENGINE lives in OrdersModule's
 * `PricingAccountService`, consumed at booking).
 */
@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [CorporateController],
  providers: [CorporateService],
})
export class CorporateModule {}
