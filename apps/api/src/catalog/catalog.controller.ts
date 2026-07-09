import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { CatalogService } from './catalog.service';

/**
 * Catalog reads (Increment 11) — the booking-context surface the customer app consumes: the org's
 * service catalog (to pick a `serviceId`) and the caller's own sites (to pick a pickup/delivery
 * `siteId` + address). No @Roles gate (any authenticated principal); confinement is enforced by the
 * scoped Prisma client in CatalogService (org-scoped services, account-scoped sites). Slash routes,
 * reads only — booking/quote/tracking/media stay untouched.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('services')
  @ApiOperation({ summary: "The org's bookable services (specialty) — to pick a serviceId when booking." })
  services(@CurrentUser() p: RequestPrincipal) {
    return this.catalog.listServices(p);
  }

  @Get('sites')
  @ApiOperation({ summary: "The caller's own sites (row-scoped) — the booking pickup/delivery address picker." })
  sites(@CurrentUser() p: RequestPrincipal) {
    return this.catalog.listSites(p);
  }

  @Get('catalog/home')
  @ApiOperation({ summary: 'The customer Home service menu — the 8 top-level service cards (icon/title/desc/tags/pricingModel/unit/from-price). Increment 21.' })
  home(@CurrentUser() p: RequestPrincipal) {
    return this.catalog.listHomeMenu(p);
  }

  @Get('catalog/dryclean')
  @ApiOperation({ summary: 'The visual dry-clean garment picker (Dry Cleaning drill-in) — categories → items with a photo + a price resolved for the caller (corporate override or base). Increment 17.' })
  dryclean(@CurrentUser() p: RequestPrincipal) {
    return this.catalog.listDrycleanCatalog(p);
  }
}
