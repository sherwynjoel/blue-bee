import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditService } from '../orders/audit.service';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { ResidentService } from './resident.service';
import { GarmentService } from './garment.service';
import { ResidentsController } from './residents.controller';
import { GarmentsController } from './garments.controller';
import { LostFoundController } from './lost-found.controller';

/**
 * Resident personal-clothing module (Track-B care homes, increment 1) — the resident directory + the
 * §5.2-B garment lifecycle (server-authoritative transitions over the append-only custody backbone) +
 * the lost & found pool / reconcile loop + the A4.2 console view. Reuses PrismaModule + scopedPrisma +
 * AuditService (resident PII reads audited, §12.2). No write goes around the row-scoping guard.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ResidentsController, GarmentsController, LostFoundController],
  providers: [ResidentService, GarmentService, AuditService, IdempotencyInterceptor],
})
export class ResidentsModule {}
