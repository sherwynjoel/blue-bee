/**
 * Facility-linen (care-home par loop) contract — Track B Phase 2, PRD §2.2 (facility linen = the
 * rental/par model), §5.2 (SOIL_PICKUP … PACK_TO_PAR), §B3.1 (soil intake: weigh/count by cart/bag per
 * customer/cost-centre, segregate soiled), §B3.2 (pack-to-par load sheet per site/cost-centre). Zod
 * request schemas + derived DTO types, view shapes, and problem+json error codes for:
 *   • Par levels per (site, optional cost-centre) × linen SKU (set/update/list).
 *   • On-hand stock (read) + an ops adjustment that SETS on-hand to an absolute target.
 *   • Soiled-cart pickup confirmation (cart/bag count + weight + per-SKU soiled counts) → decrements on-hand.
 *   • Pack-to-par load sheet: gap = max(0, par − on-hand) per SKU, viewed live + snapshotted into a Manifest.
 *
 * Wire shapes only — the service + the pack-to-par math live in `apps/api/src/facility-linen`. Linen SKUs
 * reuse `Service` (vertical LINEN, unit PIECE). The plant production floor (§B3.3/§B3.4), RFID, and
 * par/weight/piece billing stay DEFERRED (modeled-for, not faked). Weight crosses as a fixed-2 string
 * (the Decimal(10,2) form); quantities are integers.
 */
import { z } from 'zod';
import { LinenMovementType, ManifestKind, ServiceUnit } from './enums';

const QTY = z.number().int().min(0).max(1_000_000);
const POS_QTY = z.number().int().min(1).max(1_000_000);

// ───────────────────────────── par levels ─────────────────────────────

/**
 * Set (upsert) a par target for a (site, optional cost-centre) × linen SKU. `:siteId` is the path param.
 * A NULL/absent `costCenterId` is the site-level par; a set one scopes the par to a wing/floor cost-centre
 * (validated to belong to the site's account). Re-setting the same key updates the target (idempotent).
 */
export const setParLevelSchema = z.object({
  serviceId: z.string().uuid(),
  costCenterId: z.string().uuid().nullable().optional(),
  targetQty: QTY,
});
export type SetParLevelDto = z.infer<typeof setParLevelSchema>;

/** Update an existing par target by id (the SKU/site/cost-centre key is immutable). */
export const updateParLevelSchema = z.object({ targetQty: QTY });
export type UpdateParLevelDto = z.infer<typeof updateParLevelSchema>;

/** List a site's par levels; optional `costCenterId` filter (a literal "null" string ⇒ site-level only). */
export const listParLevelsQuerySchema = z.object({
  costCenterId: z.string().uuid().optional(),
});
export type ListParLevelsQuery = z.infer<typeof listParLevelsQuerySchema>;

// ───────────────────────────── on-hand stock ─────────────────────────────

export const listLinenStockQuerySchema = z.object({
  costCenterId: z.string().uuid().optional(),
});
export type ListLinenStockQuery = z.infer<typeof listLinenStockQuerySchema>;

/**
 * Ops correction: SET on-hand for a (site, cost-centre?, sku) to an absolute target. The service records
 * an append-only ADJUSTMENT LinenMovement of `target − current` so the cache lands exactly on `onHand`
 * (idempotent) while the ledger stays reconcilable (on_hand == Σ movements). This is the increment's path
 * to establish/correct on-hand without the DEFERRED plant-delivery flow.
 */
export const adjustLinenStockSchema = z.object({
  serviceId: z.string().uuid(),
  costCenterId: z.string().uuid().nullable().optional(),
  onHand: QTY,
  note: z.string().trim().max(280).optional(),
});
export type AdjustLinenStockDto = z.infer<typeof adjustLinenStockSchema>;

// ───────────────────────────── soiled-cart pickup ─────────────────────────────

/** One per-SKU soiled count captured at the pickup — drives a SOIL_PICKUP movement (− qty). */
export const soilPickupLineSchema = z.object({
  serviceId: z.string().uuid(),
  qty: POS_QTY,
});
export type SoilPickupLineDto = z.infer<typeof soilPickupLineSchema>;

/**
 * Record a soiled-cart pickup at a site (PRD §B3.1). Cart/bag count + weight are the operational
 * confirmation the account sees ("N carts at HH:MM"); the per-SKU `lines` are the soiled counts that
 * decrement on-hand. Optional `routeStopId` links the SOIL_PICKUP route stop (a PICKUP-kind stop).
 */
export const recordSoilPickupSchema = z.object({
  costCenterId: z.string().uuid().nullable().optional(),
  routeStopId: z.string().uuid().optional(),
  cartCount: z.number().int().min(1).max(10_000),
  bagCount: z.number().int().min(0).max(100_000).optional(),
  weightKg: z.number().min(0).max(1_000_000).optional(),
  soiled: z.boolean().optional(),
  lines: z.array(soilPickupLineSchema).min(1).max(500),
});
export type RecordSoilPickupDto = z.infer<typeof recordSoilPickupSchema>;

/** Driver self-scoped variant: the stop is the path param (`/driver/stops/:stopId/soil-pickup`). */
export const recordDriverSoilPickupSchema = recordSoilPickupSchema.omit({ routeStopId: true });
export type RecordDriverSoilPickupDto = z.infer<typeof recordDriverSoilPickupSchema>;

export const listSoilPickupsQuerySchema = z.object({
  costCenterId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ListSoilPickupsQuery = z.infer<typeof listSoilPickupsQuerySchema>;

// ───────────────────────────── pack-to-par load sheet ─────────────────────────────

export const packToParQuerySchema = z.object({
  costCenterId: z.string().uuid().optional(),
});
export type PackToParQuery = z.infer<typeof packToParQuerySchema>;

/** Snapshot the current pack-to-par gaps into a Manifest (the §B3.2 load sheet). */
export const generatePackToParSchema = z.object({
  costCenterId: z.string().uuid().nullable().optional(),
});
export type GeneratePackToParDto = z.infer<typeof generatePackToParSchema>;

export const listPackToParManifestsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListPackToParManifestsQuery = z.infer<typeof listPackToParManifestsQuerySchema>;

// ───────────────────────────── view shapes ─────────────────────────────

export interface ParLevelView {
  id: string;
  accountId: string;
  siteId: string;
  costCenterId: string | null;
  serviceId: string;
  sku: string;
  unit: ServiceUnit;
  targetQty: number;
  createdAt: string;
  updatedAt: string;
}
export interface ParLevelListResult {
  parLevels: ParLevelView[];
}

export interface LinenStockView {
  siteId: string;
  costCenterId: string | null;
  serviceId: string;
  sku: string;
  unit: ServiceUnit;
  onHand: number;
  updatedAt: string;
}
export interface LinenStockListResult {
  stock: LinenStockView[];
}

/** The ADJUSTMENT result — the new on-hand + the movement that got it there. */
export interface LinenStockAdjustResult {
  stock: LinenStockView;
  movement: { id: string; type: LinenMovementType; qty: number; occurredAt: string };
}

export interface SoilPickupLineView {
  serviceId: string;
  sku: string;
  unit: ServiceUnit;
  qty: number;
}
export interface SoilPickupView {
  id: string;
  siteId: string;
  costCenterId: string | null;
  routeStopId: string | null;
  cartCount: number;
  bagCount: number | null;
  weightKg: string | null;
  soiled: boolean;
  lines: SoilPickupLineView[];
  totalPieces: number;
  actorId: string | null;
  occurredAt: string;
}
export interface SoilPickupListResult {
  pickups: SoilPickupView[];
}

/** One pack-to-par line: par vs current on-hand, with the gap to pack (max(0, par − onHand)). */
export interface PackToParLine {
  serviceId: string;
  sku: string;
  unit: ServiceUnit;
  costCenterId: string | null;
  par: number;
  onHand: number;
  gap: number;
}

/** Live pack-to-par view for a site (computed now), grouped per (cost-centre, SKU). */
export interface PackToParView {
  siteId: string;
  costCenterId: string | null;
  lines: PackToParLine[];
  totalGap: number;
}

/** A snapshotted pack-to-par load sheet (a Manifest, kind = PACK_TO_PAR). */
export interface PackToParManifestView {
  id: string;
  siteId: string;
  costCenterId: string | null;
  kind: ManifestKind;
  lines: PackToParLine[];
  totalGap: number;
  generatedAt: string;
}
export interface PackToParManifestListResult {
  manifests: PackToParManifestView[];
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const LINEN_ERRORS = {
  SITE_NOT_FOUND: 'facility_linen.site_not_found',
  SERVICE_NOT_FOUND: 'facility_linen.service_not_found',
  SERVICE_NOT_LINEN: 'facility_linen.service_not_linen',
  COST_CENTER_NOT_FOUND: 'facility_linen.cost_center_not_found',
  COST_CENTER_SITE_MISMATCH: 'facility_linen.cost_center_site_mismatch',
  PAR_LEVEL_NOT_FOUND: 'facility_linen.par_level_not_found',
  DUPLICATE_PAR: 'facility_linen.duplicate_par',
  ROUTE_STOP_NOT_FOUND: 'facility_linen.route_stop_not_found',
  ROUTE_STOP_NOT_PICKUP: 'facility_linen.route_stop_not_pickup',
  ROUTE_STOP_SITE_MISMATCH: 'facility_linen.route_stop_site_mismatch',
  NOT_OWN_STOP: 'facility_linen.not_own_stop',
} as const;
export type LinenErrorCode = (typeof LINEN_ERRORS)[keyof typeof LINEN_ERRORS];
