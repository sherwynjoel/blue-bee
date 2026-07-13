import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsController, CreditsAdminController } from './credits.controller';
import { CreditsService } from './credits.service';

/**
 * [Inc-37] The customer credit ledger. Depends on NOTHING but Prisma, so it can be imported by the modules
 * that move money without creating a cycle: LogisticsModule (grant on DELIVERED), PaymentsModule (redeem at
 * PaymentIntent), AccountModule (customer balance), AdminModule (console ledger + adjust), HomeModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CreditsController, CreditsAdminController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
