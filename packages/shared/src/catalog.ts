/**
 * Catalog contract (Increment 11) — the small, customer-readable reads the customer app needs to
 * BOOK: the org's specialty service catalog (to pick a `serviceId`) and the customer's own sites (to
 * pick a pickup/delivery `siteId` + address). Both are thin, additive, row-scoped reads delegating
 * to the proven scoped-Prisma layer — no new tables, no business logic. Single source of truth for
 * the wire shapes shared by the API and the app.
 */
import type { ServiceUnit, ServiceVertical, AccountType } from './enums';

/** One bookable service in the org catalog (GET /v1/services). `baseRate` is a decimal string (CAD/unit). */
export interface ServiceCatalogItem {
  id: string;
  vertical: ServiceVertical;
  name: string;
  unit: ServiceUnit;
  /** Base rate per unit, decimal string (e.g. "6.5000"). The final quote is computed server-side. */
  baseRate: string;
}

/** GET /v1/services result — the org's catalog (specialty this phase). */
export interface ServiceCatalogResult {
  services: ServiceCatalogItem[];
}

/** One of the customer's sites (GET /v1/sites) — the pickup/delivery address picker source. */
export interface CustomerSite {
  id: string;
  accountId: string;
  name: string;
  address: string | null;
  /** Account this site belongs to (so the app can group when a customer spans accounts). */
  accountName: string;
  accountType: AccountType;
}

/** GET /v1/sites result — the caller's own sites, row-scoped to their account(s). */
export interface CustomerSitesResult {
  sites: CustomerSite[];
}
