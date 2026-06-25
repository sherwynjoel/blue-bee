import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

/**
 * Catalog module (Increment 11) — the small customer-facing booking-context reads (GET /v1/services,
 * GET /v1/sites) that let the customer app book against real serviceIds + siteIds. Read-only;
 * delegates to the proven scoped Prisma layer.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
