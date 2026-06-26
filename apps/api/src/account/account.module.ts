import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

/**
 * Account module (Increment: launch-scaffolding) — the self-service `DELETE /v1/account` surface the
 * three Expo apps need to clear store review. Self-contained: it owns only its controller + service and
 * reuses the immutable AuditService (exported by OrdersModule) so the deletion is attributed in the
 * append-only audit log. No schema change — deletion is anonymize-in-place + purge of PII children.
 */
@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
