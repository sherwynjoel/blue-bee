import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { AuditService } from '../orders/audit.service';
import { ServiceZonesController } from './service-zones.controller';
import { CoverageRequestsController } from './coverage-requests.controller';
import { ServiceZonesService } from './service-zones.service';

/**
 * Geo-blocking module (Increment 19) — owner-drawn service zones + out-of-area demand capture. Self-contained
 * to avoid a cycle with OrdersModule (which imports THIS to run the booking gate): PrismaService + REDIS come
 * from the global Prisma/Redis modules; AuditService is a thin, stateless writer over Prisma (provided locally,
 * mirroring the OrdersModule provider). Exports ServiceZonesService so OrdersService can gate `book`.
 */
@Module({
  controllers: [ServiceZonesController, CoverageRequestsController],
  providers: [ServiceZonesService, AuditService, IdempotencyInterceptor],
  exports: [ServiceZonesService],
})
export class ServiceZonesModule {}
