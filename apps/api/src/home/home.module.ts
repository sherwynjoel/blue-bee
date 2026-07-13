import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { CreditsModule } from '../credits/credits.module';
import { HomeController, HomeAdminController } from './home.controller';
import { HomeService } from './home.service';

/**
 * [Inc-37] The customer Home tab (`GET /v1/home`) + the founder's Home content editor
 * (`/v1/admin/home-blocks`). Reuses the credit ledger for the real balance and the immutable AuditService
 * (exported by OrdersModule) so every content edit is attributed.
 */
@Module({
  imports: [PrismaModule, OrdersModule, CreditsModule],
  controllers: [HomeController, HomeAdminController],
  providers: [HomeService],
})
export class HomeModule {}
