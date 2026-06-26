import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { AccountsReadController } from './accounts-read.controller';
import { AccountsReadService } from './accounts-read.service';
import { AccountsPortalController } from './accounts-portal.controller';
import { AccountsPortalService } from './accounts-portal.service';

/**
 * Accounts directory + portal module (Track-A B2B account console) — the read-only account list +
 * detail header AND the account-detail portal tabs (Orders / Manifests / Exceptions) the console
 * renders over the now-merged condo endpoints. No writes, no schema change. Imports OrdersModule so the
 * account-scoped orders read DELEGATES to the proven `OrdersService.listOrders` (no duplicated logic).
 * The per-account writes + standing-order CRUD live in the RecurringModule and are reused by the UI.
 */
@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [AccountsReadController, AccountsPortalController],
  providers: [AccountsReadService, AccountsPortalService],
})
export class AccountsModule {}
