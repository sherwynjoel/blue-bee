import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { AuditService } from '../orders/audit.service';
import { ServiceZonesModule } from '../service-zones/service-zones.module';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

/**
 * Saved addresses (Increment 26) — the customer WRITE side of `Site`.
 *
 * `IdempotencyInterceptor` must be a local provider: it is applied with `@UseInterceptors(...)` (a class,
 * not a global), so Nest resolves it from THIS module's injector and boot fails without it (the same
 * reason ServiceZonesModule lists it). `AuditService` is the stateless Prisma writer, provided locally
 * exactly as OrdersModule/ServiceZonesModule do. `ServiceZonesModule` exports `ServiceZonesService`, which
 * answers serviceability and captures out-of-area demand. `GEOCODER_PROVIDER` comes from the @Global
 * GeocodingModule, and PrismaService from the @Global PrismaModule.
 */
@Module({
  imports: [ServiceZonesModule],
  controllers: [SitesController],
  providers: [SitesService, AuditService, IdempotencyInterceptor],
  exports: [SitesService],
})
export class SitesModule {}
