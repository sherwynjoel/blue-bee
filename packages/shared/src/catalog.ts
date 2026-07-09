/**
 * Catalog contract (Increment 11) — the small, customer-readable reads the customer app needs to
 * BOOK: the org's specialty service catalog (to pick a `serviceId`) and the customer's own sites (to
 * pick a pickup/delivery `siteId` + address). Both are thin, additive, row-scoped reads delegating
 * to the proven scoped-Prisma layer — no new tables, no business logic. Single source of truth for
 * the wire shapes shared by the API and the app.
 */
import { z } from 'zod';
import { ServiceUnit } from './enums';
import type { ServiceVertical, AccountType } from './enums';
import type { GeoPoint } from './validators';

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
  /**
   * [Inc-19] The site's WGS84 service point ({lng,lat}), surfaced from the PostGIS `Site.geo` column when
   * set (null otherwise). The customer app sends this as the booking `serviceGeo` so the SERVER can gate
   * the booking against the org's active service zones (geo-blocking). Display/pass-through only — the app
   * never decides serviceability; the server is authoritative.
   */
  geo: GeoPoint | null;
}

/** GET /v1/sites result — the caller's own sites, row-scoped to their account(s). */
export interface CustomerSitesResult {
  sites: CustomerSite[];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Increment 17 — visual dry-clean catalog (categorized, with images). PRD "Cascade" specialty dry-clean
// catalog + §9.2 pricing. Items ARE `Service` rows (unit = ITEM), so the quote engine + `PriceListItem`
// per-account overrides work unchanged; photos go through the existing presigned media seam (stored as
// `Service.imageKey`, signed on read); the customer read resolves each item's price on the effective
// pricing account (`Order.pricingAccountId ?? accountId`) via `PricingService.resolveRate`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

// ───────────────────────────── categories ─────────────────────────────

/** Presentation fields for the customer Home service grid (Inc-20). Editable by owner/finance in the
 *  console; the app renders `description` as the card sub-line, `features` as tag chips, and maps `icon`
 *  (a semantic key) to an icon + tint. `features` is capped so a card stays readable. */
const categoryFeaturesSchema = z.array(z.string().trim().min(1).max(40)).max(12);

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  features: categoryFeaturesSchema.optional(),
  icon: z.string().trim().min(1).max(60).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});
export type CreateCategoryDto = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    features: categoryFeaturesSchema.optional(),
    icon: z.string().trim().min(1).max(60).nullable().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;

export interface CategoryView {
  id: string;
  name: string;
  /** Card sub-line for the Home service grid (null when unset). */
  description: string | null;
  /** Tag chips (e.g. ["DRY CLEAN","PRESS","ON HANGERS"]); [] when unset. */
  features: string[];
  /** Semantic icon key the app maps to an icon + tint (null when unset). */
  icon: string | null;
  sortOrder: number;
  active: boolean;
  itemCount: number;
  createdAt: string;
}
export interface CategoriesResult {
  categories: CategoryView[];
}

// ───────────────────────────── catalog items (Service, unit = ITEM) ─────────────────────────────

/**
 * Create a dry-clean catalog item = a `Service` (unit ITEM). `imageKey` is a storageKey from a prior
 * catalog-image presign+PUT; the server HEAD-verifies it before storing (never trusts a raw key).
 */
export const createCatalogItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.number().positive().max(100000),
  categoryId: z.string().uuid().optional(),
  imageKey: z.string().trim().min(1).max(300).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});
export type CreateCatalogItemDto = z.infer<typeof createCatalogItemSchema>;

export const updateCatalogItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    price: z.number().positive().max(100000).optional(),
    categoryId: z.string().uuid().nullable().optional(),
    imageKey: z.string().trim().min(1).max(300).nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });
export type UpdateCatalogItemDto = z.infer<typeof updateCatalogItemSchema>;

export interface CatalogItemView {
  id: string;
  name: string;
  unit: ServiceUnit;
  baseRate: string;
  categoryId: string | null;
  categoryName: string | null;
  imageKey: string | null;
  /** A freshly-minted short-lived signed GET (§14), or null when the item has no photo. */
  imageUrl: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

/** The admin catalog view — categories (each with its items) + an "uncategorized" bucket. */
export interface AdminCatalogView {
  categories: Array<CategoryView & { items: CatalogItemView[] }>;
  uncategorized: CatalogItemView[];
  currency: string;
}

// ───────────────────────────── catalog image upload (reuse the media seam) ─────────────────────────────

/** Presign a catalog item photo upload (owner/finance). Not tied to any order — org-scoped. */
export const presignCatalogImageSchema = z.object({
  contentType: z.string().trim().min(1).max(100),
  byteSize: z.number().int().positive(),
});
export type PresignCatalogImageDto = z.infer<typeof presignCatalogImageSchema>;

export interface CatalogImagePresignResult {
  uploadUrl: string;
  storageKey: string;
  contentType: string;
  expiresInSec: number;
  maxBytes: number;
}

// ───────────────────────────── customer visual picker ─────────────────────────────

/** Where the item's resolved price came from (mirrors PricingService.RateSource). */
export type CatalogPriceSource = 'account_override' | 'account_list' | 'default_list' | 'service_base';

export interface DrycleanCatalogItemView {
  id: string;
  name: string;
  imageUrl: string | null;
  /** The per-item price RESOLVED for the caller's effective pricing account (corporate override or base). */
  price: string;
  priceSource: CatalogPriceSource;
}

export interface DrycleanCategoryView {
  id: string;
  name: string;
  /** [Inc-20] Card sub-line for the customer Home service grid (null when the founder hasn't set one). */
  description: string | null;
  /** [Inc-20] Tag chips for the service card (e.g. ["DRY CLEAN","PRESS","ON HANGERS"]); [] when unset. */
  features: string[];
  /** [Inc-20] Semantic icon key the app maps to an icon + tint (null when unset). */
  icon: string | null;
  /**
   * [Inc-20] The lowest resolved price among this category's items, as a decimal string in `currency`
   * (the Home card's "from" price). null when the category has no priced items. Real data — the minimum of
   * the same server-resolved item prices returned below; never a client-invented figure.
   */
  priceFrom: string | null;
  sortOrder: number;
  items: DrycleanCatalogItemView[];
}

/**
 * The customer visual dry-clean catalog — categories → items with a photo + a price already resolved for
 * the caller (corporate rate when a membership applies, else the base price). `pricingAccountName` names
 * the corporate account when corporate pricing applies (the Inc-16 "corporate pricing applied" signal).
 */
export interface DrycleanCatalogView {
  categories: DrycleanCategoryView[];
  currency: string;
  pricingAccountName: string | null;
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const CATALOG_ERRORS = {
  CATEGORY_NOT_FOUND: 'catalog.category_not_found',
  ITEM_NOT_FOUND: 'catalog.item_not_found',
  IMAGE_NOT_UPLOADED: 'catalog.image_not_uploaded',
  NOT_A_CATALOG_ITEM: 'catalog.not_a_catalog_item',
} as const;
export type CatalogErrorCode = (typeof CATALOG_ERRORS)[keyof typeof CATALOG_ERRORS];
