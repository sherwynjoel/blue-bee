/**
 * Catalog contract (Increment 11) — the small, customer-readable reads the customer app needs to
 * BOOK: the org's specialty service catalog (to pick a `serviceId`) and the customer's own sites (to
 * pick a pickup/delivery `siteId` + address). Both are thin, additive, row-scoped reads delegating
 * to the proven scoped-Prisma layer — no new tables, no business logic. Single source of truth for
 * the wire shapes shared by the API and the app.
 */
import { z } from 'zod';
import { ServiceUnit, PricingModel, PricingUnit } from './enums';
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
  /** [Inc-24] The console-arranged position within its category (server orders by it; the app renders by it). */
  sortOrder: number;
}

export interface DrycleanCategoryView {
  id: string;
  name: string;
  /** [Inc-20] Card sub-line (null when unset). */
  description: string | null;
  /** [Inc-20] Tag chips (e.g. ["DRY CLEAN","PRESS","ON HANGERS"]); [] when unset. */
  features: string[];
  /** [Inc-20] Semantic icon key the app maps to an icon + tint (null when unset). */
  icon: string | null;
  /**
   * [Inc-20] The lowest resolved price among this category's items, as a decimal string in `currency`
   * (null when the category has no priced items). Real data — the minimum of the same server-resolved item
   * prices returned below; never a client-invented figure.
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

// ───────────────────────────── customer Home service menu (Inc-21) ─────────────────────────────

/**
 * One top-level service card on the customer Home grid (GET /v1/catalog/home). A card IS a top-level
 * `ServiceCategory` (parentId = NULL). `pricingModel`/`unit` drive the footer copy; `priceFrom` is the
 * founder-entered "from $X" display anchor — NULL until a real CAD price is set in the console (honesty
 * firewall: the app shows "Get a quote" until then; never a client-invented or placeholder figure).
 */
export interface HomeServiceCardView {
  id: string;
  name: string;
  description: string | null;
  features: string[];
  icon: string | null;
  pricingModel: PricingModel;
  unit: PricingUnit;
  priceFrom: string | null;
  currency: string;
  sortOrder: number;
  /**
   * [Inc-23] The backing bookable `Service` (the card's rate service), or null until the founder sets a
   * rate in the console. An order booked from this card references this serviceId, so its OrderLine →
   * Service → ServiceCategory.pricingModel drives the weigh/measure pricing gate. A card with `serviceId:
   * null` is not yet bookable as a priced job (the app shows "Get a quote" / a drill-in).
   */
  serviceId: string | null;
}

/** GET /v1/catalog/home — the customer Home service menu (the 8 top-level cards, active + sorted). */
export interface HomeServiceMenuView {
  cards: HomeServiceCardView[];
  currency: string;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Increment 21 — the top-level SERVICE MENU (the 8 Home cards) admin/rate editor. A "card" IS a top-level
// `ServiceCategory` (parentId = NULL). The card carries presentation + pricing model; the actual per-unit
// RATE lives on ONE backing `Service` (categoryId = the card) that this editor creates on first rate entry
// (so no invented rate ever sits in the seed). OWNER/FINANCE only, org-scoped, audited.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One top-level service card in the console rate editor (GET /v1/catalog/service-menu). */
export interface ServiceMenuCardView {
  id: string;
  name: string;
  description: string | null;
  features: string[];
  icon: string | null;
  pricingModel: PricingModel;
  unit: PricingUnit;
  /** Founder "from $X" display anchor (decimal string), or null until set. NULL in seed (honesty firewall). */
  priceFrom: string | null;
  currency: string;
  active: boolean;
  sortOrder: number;
  /** The backing per-unit RATE (the price Inc-22 weight/measure pricing uses), decimal string, or null until set. */
  rate: string | null;
  /** The backing Service id that holds the rate, or null until the first rate is entered. */
  rateServiceId: string | null;
  /** Count of drill-in child categories (e.g. Dry Cleaning nests the garment sub-catalog). */
  childCount: number;
}

export interface ServiceMenuResult {
  cards: ServiceMenuCardView[];
  currency: string;
}

/**
 * Update a service card. Every field is optional (patch); at least one must be present. `priceFrom`/`rate`
 * accept an explicit null to CLEAR the value (e.g. reset to "Get a quote"). `rate` upserts the backing
 * Service; `unit` changes re-map the backing Service's ServiceUnit (PER_KG→KG, PER_ITEM→ITEM, PER_MEASURE→SQFT).
 */
export const updateServiceMenuCardSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    features: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    icon: z.string().trim().min(1).max(60).nullable().optional(),
    pricingModel: z.nativeEnum(PricingModel).optional(),
    unit: z.nativeEnum(PricingUnit).optional(),
    priceFrom: z.number().positive().max(1_000_000).nullable().optional(),
    currency: z.string().trim().length(3).optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    rate: z.number().positive().max(1_000_000).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });
export type UpdateServiceMenuCardDto = z.infer<typeof updateServiceMenuCardSchema>;

/**
 * [Inc-21] The backing `Service.unit` (ServiceUnit) for a card's customer-facing `PricingUnit`. PER_KG → KG
 * (consumer wash&fold), PER_LB → LB [Inc-24], PER_ITEM → ITEM, PER_MEASURE → SQFT (rug/carpet/upholstery/
 * blinds are measured). The rate lives on that Service; Inc-22 weight/measure pricing reads the card's `unit`
 * to pick the measure.
 */
export function backingServiceUnit(unit: PricingUnit): ServiceUnit {
  switch (unit) {
    case PricingUnit.PER_KG:
      return ServiceUnit.KG;
    case PricingUnit.PER_LB:
      return ServiceUnit.LB;
    case PricingUnit.PER_MEASURE:
      return ServiceUnit.SQFT;
    case PricingUnit.PER_ITEM:
    default:
      return ServiceUnit.ITEM;
  }
}

/**
 * [Inc-24] Pounds per kilogram — the ONE place this factor lives. Weight is captured canonically in
 * kilograms (`WeightCapture.weightKg`, denormalized onto `Item.measurements.weightKg` by the WeighService);
 * a PER_LB service prices per POUND, so the conversion happens once, at pricing time (`deriveMeasure`).
 * Never inline this number — import `kgToLb`.
 */
export const LB_PER_KG = 2.2046226218;

/** [Inc-24] Convert a canonical kilogram weight to pounds for per-pound pricing. */
export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

/** [Inc-24] Is this card priced by weight (kg or lb)? Weight-priced cards back a WASHFOLD `Service`. */
export function isWeightPricingUnit(unit: PricingUnit): boolean {
  return unit === PricingUnit.PER_KG || unit === PricingUnit.PER_LB;
}

// ───────────────────────────── icon keys (single source of truth) ─────────────────────────────

/**
 * [Inc-24] The canonical semantic icon keys a catalog card / category may carry. THE single source of
 * truth: the customer app maps each key → a Feather glyph + tint (HomeScreen `CATEGORY_ICONS`) and the
 * console maps each key → a preview glyph (`apps/web/lib/catalog-icons.ts`). BOTH are typed as
 * `Record<CatalogIconKey, …>`, so adding a key here fails typecheck until both surfaces map it — console
 * and app cannot drift. Persistence is unchanged: `icon` is still a plain string column (legacy/unknown
 * values still load; the console offers them back rather than silently wiping them).
 */
export const CATALOG_ICON_KEYS = [
  // the top-level service cards
  'wash-fold',
  'wash-iron',
  'dry-clean',
  'iron',
  'delicates',
  'rug',
  'carpet',
  'sofa',
  'blinds',
  // the dry-clean garment sub-catalog
  'shirts',
  'outerwear',
  'formalwear',
] as const;

export type CatalogIconKey = (typeof CATALOG_ICON_KEYS)[number];

/** Narrow an arbitrary persisted `icon` string to a known key (legacy rows may hold anything). */
export function isCatalogIconKey(value: string): value is CatalogIconKey {
  return (CATALOG_ICON_KEYS as readonly string[]).includes(value);
}

// ───────────────────────────── reorder (Inc-24) ─────────────────────────────

/**
 * [Inc-24] What list a reorder applies to. SERVICE_CARDS = the top-level Home cards (parentId NULL);
 * CATEGORIES = drill-in child categories (the dry-clean garment sub-catalog); ITEMS = per-item catalog
 * `Service` rows within a category.
 */
export enum CatalogReorderScope {
  SERVICE_CARDS = 'SERVICE_CARDS',
  CATEGORIES = 'CATEGORIES',
  ITEMS = 'ITEMS',
}

/**
 * [Inc-24] Reorder a list by sending its ids in the desired order; the server renumbers `sortOrder` to the
 * array index (0..n-1) in ONE transaction. Renumbering (not swapping) is deliberate: console-created rows
 * default to `sortOrder = 0`, so a pairwise swap would be a no-op on ties. Send the COMPLETE ordered list
 * for the scope (a category's full item list / the full card list) — ids not sent keep their old value.
 */
export const reorderCatalogSchema = z
  .object({
    scope: z.nativeEnum(CatalogReorderScope),
    ids: z.array(z.string().uuid()).min(1).max(200),
  })
  .refine((d) => new Set(d.ids).size === d.ids.length, { message: 'ids must be unique' });
export type ReorderCatalogDto = z.infer<typeof reorderCatalogSchema>;

/** The applied order, echoed back (ids in their new 0..n-1 `sortOrder`). */
export interface CatalogReorderResult {
  scope: CatalogReorderScope;
  ids: string[];
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const CATALOG_ERRORS = {
  CATEGORY_NOT_FOUND: 'catalog.category_not_found',
  ITEM_NOT_FOUND: 'catalog.item_not_found',
  IMAGE_NOT_UPLOADED: 'catalog.image_not_uploaded',
  NOT_A_CATALOG_ITEM: 'catalog.not_a_catalog_item',
  NOT_A_SERVICE_CARD: 'catalog.not_a_service_card',
} as const;
export type CatalogErrorCode = (typeof CATALOG_ERRORS)[keyof typeof CATALOG_ERRORS];
