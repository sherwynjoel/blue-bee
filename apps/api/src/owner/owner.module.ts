import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';

/**
 * Owner module (Increment 14a) — the small OWNER-scoped cockpit reads (GET /v1/owner/today,
 * /owner/approvals, /owner/exceptions) the owner app renders. Read-only; delegates to the proven
 * scoped Prisma layer (no new business logic, no schema change). Mirrors the Inc-11 CatalogModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OwnerController],
  providers: [OwnerService],
})
export class OwnerModule {}
