import { Injectable } from '@nestjs/common';
import type {
  CustomerSite,
  CustomerSitesResult,
  ServiceCatalogItem,
  ServiceCatalogResult,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';

/**
 * Catalog reads (Increment 11) — the thin, additive, customer-self-scoped reads the customer app
 * needs to BOOK. Both go through the PROVEN row-scoping Prisma extension (no new business logic, no
 * schema): `Service` is org-scoped (the org's catalog), `Site` is account-scoped (so a confined
 * customer sees ONLY their own account's sites; org-wide staff see all org sites). No write path.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

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
    const sites: CustomerSite[] = rows.map((s) => ({
      id: s.id,
      accountId: s.accountId,
      name: s.name,
      address: s.address,
      accountName: s.account.name,
      accountType: s.account.type as unknown as CustomerSite['accountType'],
    }));
    return { sites };
  }
}
