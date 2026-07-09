import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ServiceUnit } from '@blue-bee/shared';
import type {
  CustomerSite,
  CustomerSitesResult,
  DrycleanCatalogItemView,
  DrycleanCatalogView,
  DrycleanCategoryView,
  ServiceCatalogItem,
  ServiceCatalogResult,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { PricingService } from '../orders/pricing.service';
import { MediaSigner } from '../media/storage/media-signer';
import type { RequestPrincipal } from '../auth/rbac/types';

/**
 * Catalog reads (Increment 11) — the thin, additive, customer-self-scoped reads the customer app
 * needs to BOOK. Both go through the PROVEN row-scoping Prisma extension (no new business logic, no
 * schema): `Service` is org-scoped (the org's catalog), `Site` is account-scoped (so a confined
 * customer sees ONLY their own account's sites; org-wide staff see all org sites). No write path.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly signer: MediaSigner,
  ) {}

  /** The org's bookable services (specialty this phase). Org-scoped via the scoped client. */
  async listServices(principal: RequestPrincipal): Promise<ServiceCatalogResult> {
    const rows = await scopedPrisma(this.prisma, principal).service.findMany({
      orderBy: [{ vertical: 'asc' }, { name: 'asc' }],
      select: { id: true, vertical: true, name: true, unit: true, baseRate: true },
    });
    const services: ServiceCatalogItem[] = rows.map((s) => ({
      id: s.id,
      vertical: s.vertical as unknown as ServiceCatalogItem['vertical'],
      name: s.name,
      unit: s.unit as unknown as ServiceCatalogItem['unit'],
      baseRate: s.baseRate.toString(),
    }));
    return { services };
  }

  /** The caller's own sites (the pickup/delivery address picker). Account-scoped via the scoped client. */
  async listSites(principal: RequestPrincipal): Promise<CustomerSitesResult> {
    const rows = await scopedPrisma(this.prisma, principal).site.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        accountId: true,
        name: true,
        address: true,
        account: { select: { name: true, type: true } },
      },
    });
    // [Inc-19] Surface each site's PostGIS point (Site.geo is Prisma `Unsupported` → raw ST_X/ST_Y read on
    // the exact ids just fetched via the scoped client). The customer app sends this as the booking
    // `serviceGeo` so the SERVER can geo-block against active service zones (the app never decides).
    const geoById = await this.readSiteGeo(rows.map((s) => s.id));
    const sites: CustomerSite[] = rows.map((s) => ({
      id: s.id,
      accountId: s.accountId,
      name: s.name,
      address: s.address,
      accountName: s.account.name,
      accountType: s.account.type as unknown as CustomerSite['accountType'],
      geo: geoById.get(s.id) ?? null,
    }));
    return { sites };
  }

  /** Read {lng,lat} for a set of sites from the PostGIS geography column (geometry cast → ST_X/ST_Y). */
  private async readSiteGeo(siteIds: string[]): Promise<Map<string, { lng: number; lat: number }>> {
    const out = new Map<string, { lng: number; lat: number }>();
    if (siteIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; lat: number | null; lng: number | null }>>(Prisma.sql`
      SELECT id, ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng
      FROM "Site" WHERE geo IS NOT NULL AND id IN (${Prisma.join(siteIds.map((id) => Prisma.sql`${id}::uuid`))})`);
    for (const r of rows) {
      if (r.lat !== null && r.lng !== null) out.set(r.id, { lng: Number(r.lng), lat: Number(r.lat) });
    }
    return out;
  }

  /**
   * [Inc-17] The customer visual dry-clean catalog — active categories → active per-item (ITEM) items with
   * a signed photo + a price RESOLVED for the caller's effective pricing account (Inc-16: an active
   * corporate membership prices on that corporate account, else the caller's own account → base). Reuses
   * `PricingService.resolveRate` (the same engine the quote uses) — no client-side pricing, no new logic.
   */
  async listDrycleanCatalog(principal: RequestPrincipal): Promise<DrycleanCatalogView> {
    const db = scopedPrisma(this.prisma, principal);

    // Effective pricing account: the caller's active corporate membership, else their own account.
    const membership = await this.prisma.corporateMembership.findFirst({
      where: { userId: principal.userId, orgId: principal.orgId, status: 'ACTIVE', account: { corporate: true } },
      orderBy: { createdAt: 'desc' },
      include: { account: { select: { name: true } } },
    });
    const pricingAccountId = membership?.accountId ?? principal.accountIds[0] ?? null;
    const pricingAccountName = membership?.account.name ?? null;

    const categories = await db.serviceCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        services: { where: { active: true, unit: ServiceUnit.ITEM }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      },
    });

    const out: DrycleanCategoryView[] = [];
    for (const cat of categories) {
      const items: DrycleanCatalogItemView[] = [];
      for (const s of cat.services) {
        const resolved = pricingAccountId
          ? await this.pricing.resolveRate(principal.orgId, pricingAccountId, s.id)
          : { rate: Number(s.baseRate), source: 'service_base' as const };
        items.push({
          id: s.id,
          name: s.name,
          imageUrl: s.imageKey ? await this.signer.signedGet({ storageKey: s.imageKey, url: null }) : null,
          price: resolved.rate.toFixed(2),
          priceSource: resolved.source,
        });
      }
      if (items.length > 0) {
        // [Inc-20] "from" price for the Home service card = the lowest RESOLVED item price in the group
        // (real data — the min of the same prices returned above; never a client-side figure). items is
        // non-empty here, so the reduce is always finite.
        const priceFrom = items.reduce((min, it) => Math.min(min, Number(it.price)), Number.POSITIVE_INFINITY);
        out.push({
          id: cat.id,
          name: cat.name,
          description: cat.description ?? null,
          features: cat.features ?? [],
          icon: cat.icon ?? null,
          priceFrom: Number.isFinite(priceFrom) ? priceFrom.toFixed(2) : null,
          sortOrder: cat.sortOrder,
          items,
        });
      }
    }
    return { categories: out, currency: 'CAD', pricingAccountName };
  }
}
