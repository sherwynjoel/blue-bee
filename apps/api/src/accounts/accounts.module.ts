import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountsReadController } from './accounts-read.controller';
import { AccountsReadService } from './accounts-read.service';

/**
 * Accounts directory module (Track-A B2B account console) — the thin, read-only account list + detail
 * the console renders over the now-merged condo endpoints. Mirrors the Inc-15 AnalyticsModule shape:
 * imports PrismaModule, no writes, no schema change. The per-account writes + standing-order CRUD live
 * in the RecurringModule and are reused by the UI.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AccountsReadController],
  providers: [AccountsReadService],
})
export class AccountsModule {}
