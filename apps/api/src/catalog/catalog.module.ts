import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { MediaModule } from '../media/media.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogAdminService } from './catalog-admin.service';

/**
 * Catalog module — the customer booking-context reads (Increment 11: GET /v1/services, /v1/sites) plus the
 * Increment-17 dry-clean visual catalog: the customer read (GET /v1/catalog/dryclean, prices resolved via
 * the shared PricingService) and the OWNER/FINANCE admin (categories + items + the catalog image presign,
 * reusing MediaService). Imports OrdersModule for the exported PricingService + AuditService, and
 * MediaModule for the presigned media seam (MediaSigner comes from the global StorageModule).
 */
@Module({
  imports: [PrismaModule, OrdersModule, MediaModule],
  controllers: [CatalogController, CatalogAdminController],
  providers: [CatalogService, CatalogAdminService],
})
export class CatalogModule {}
