import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ServiceUnit } from '@blue-bee/shared';
import type {
  CustomerSite,
  CustomerSitesResult,
  DrycleanCatalogItemView,
  DrycleanCatalogView,
  DrycleanCategoryView,
  HomeServiceCardView,
  HomeServiceMenuView,
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

  /**
   * The caller's own sites (the pickup/delivery address picker). Account-scoped via the scoped client.
   *
   * [Inc-26] Only ACTIVE sites: "removing" a saved address deactivates it (a past Order/RouteStop still
   * references the row), so the picker must not offer it again. This filter is deliberately scoped to the
   * CUSTOMER read — ops, driver, billing and corporate surfaces still resolve a deactivated site, which is
   * what keeps a historical order rendering the address it was actually collected from.
   *
   * The account's default address sorts first so the app can pre-select `sites[0]`.
   */
  async listSites(principal: RequestPrincipal): Promise<CustomerSitesResult> {
    const rows = await scopedPrisma(this.prisma, principal).site.findMany({
      where: { active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        accountId: true,
        name: true,
        address: true,
        unit: true,
        buzzer: true,
        notes: true,
        isDefault: true,
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
      unit: s.unit,
      buzzer: s.buzzer,
      notes: s.notes,
      isDefault: s.isDefault,
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
   * [Inc-21] The customer Home SERVICE MENU — the org's ACTIVE top-level service cards (`ServiceCategory`
   * with `parentId = NULL`), sorted by sortOrder. Each card carries its founder-set presentation + pricing
   * model + display `priceFrom` (NULL until a real CAD price is entered → the app shows "Get a quote"; the
   * honesty firewall guarantees no invented price ships). Child categories (the Dry Cleaning garment
   * sub-catalog) are drill-in detail served by `listDrycleanCatalog`, not here.
   */
  async listHomeMenu(principal: RequestPrincipal): Promise<HomeServiceMenuView> {
    const db = scopedPrisma(this.prisma, principal);
    const cards = await db.serviceCategory.findMany({
      where: { active: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      // The card's backing rate Service (categoryId = the card) — created by the console rate editor on
      // first rate entry. Null until then → the card is not yet bookable as a priced job.
      include: { services: { where: { active: true }, orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } } },
    });
    const cardViews: HomeServiceCardView[] = cards.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      features: c.features ?? [],
      icon: c.icon ?? null,
      pricingModel: c.pricingModel as unknown as HomeServiceCardView['pricingModel'],
      unit: c.unit as unknown as HomeServiceCardView['unit'],
      // Stored founder "from $X" anchor — NULL until a real CAD price is set (never a computed/invented figure).
      priceFrom: c.priceFrom != null ? c.priceFrom.toFixed(2) : null,
      currency: c.currency ?? 'CAD',
      sortOrder: c.sortOrder,
      serviceId: c.services[0]?.id ?? null,
    }));
    return { cards: cardViews, currency: 'CAD' };
  }

  /**
   * [Inc-17/21] The customer visual DRY-CLEAN garment picker (GET /v1/catalog/dryclean, used by the Book
   * flow). Returns the drill-in garment sub-catalog — the CHILD categories (parentId set, i.e. the
   * Shirts/Outerwear/Formalwear under the Dry Cleaning card) → active per-item (ITEM) items with a signed
   * photo + a price RESOLVED for the caller's effective pricing account (Inc-16 corporate override, else
   * base). Reuses `PricingService.resolveRate` — no client-side pricing. Top-level cards are the Home menu
   * (`listHomeMenu`), not this picker.
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

    // Drill-in garment categories = child categories (a top-level Home card has parentId NULL).
    const categories = await db.serviceCategory.findMany({
      where: { active: true, parentId: { not: null } },
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
          // [Inc-24] surfaced so the picker renders in the console-arranged order (already ordered above).
          sortOrder: s.sortOrder,
        });
      }
      if (items.length > 0) {
        // "from" price for the group = the lowest RESOLVED item price (real data; never a client-side figure).
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
