/**
 * Resident personal-clothing contract (Track-B care homes, increment 1) — the Zod request schemas,
 * the §5.2-B garment lifecycle (the SINGLE server-authoritative transition map), the view shapes the
 * console renders, and the error codes. Resident PII is sensitive (PRD §12.2): the API audits every
 * read. Facility linen loop, cost-center billing, hotels, RFID stay deferred (modeled-for, not faked).
 */
import { z } from 'zod';
import { GarmentStatus, LostFoundStatus, ResidentStatus } from './enums';

// ───────────────────── garment lifecycle (PRD §5.2-B) — the one true transition map ─────────────────────

/**
 * Legal garment-status transitions (PRD §5.2-B). The LINEAR path is driven by the generic transition
 * endpoint; the two BRANCH targets (`LOST_FOUND_POOL`, `RECONCILE`) have dedicated endpoints because
 * they also touch `LostFoundItem` + the resident link — but they still validate through this same map.
 * `DELIVERED_TO_RESIDENT → SOIL_PICKUP` re-opens the next recurring cycle for a returned garment.
 */
export const GARMENT_TRANSITIONS: Record<GarmentStatus, GarmentStatus[]> = {
  [GarmentStatus.GARMENT_ENROLLED]: [GarmentStatus.SOIL_PICKUP],
  [GarmentStatus.SOIL_PICKUP]: [GarmentStatus.INTAKE_SORT],
  [GarmentStatus.INTAKE_SORT]: [GarmentStatus.WASH],
  [GarmentStatus.WASH]: [GarmentStatus.RETURN_SORT],
  [GarmentStatus.RETURN_SORT]: [GarmentStatus.DELIVERED_TO_RESIDENT, GarmentStatus.LOST_FOUND_POOL],
  [GarmentStatus.DELIVERED_TO_RESIDENT]: [GarmentStatus.SOIL_PICKUP],
  [GarmentStatus.LOST_FOUND_POOL]: [GarmentStatus.RECONCILE],
  [GarmentStatus.RECONCILE]: [GarmentStatus.DELIVERED_TO_RESIDENT],
};

/** The two branch targets reached ONLY through their dedicated endpoints (lost-found / reconcile). */
export const GARMENT_BRANCH_STATUSES: GarmentStatus[] = [GarmentStatus.LOST_FOUND_POOL, GarmentStatus.RECONCILE];

/** Pure guard — is `from → to` a legal §5.2-B transition? (server-authoritative; UI mirrors only). */
export function canTransitionGarment(from: GarmentStatus, to: GarmentStatus): boolean {
  return (GARMENT_TRANSITIONS[from] ?? []).includes(to);
}

/** The A4.2 buckets — which lifecycle states fall into each "enrolled / in-process / returned / lost&found" column. */
export const GARMENT_BUCKETS = {
  enrolled: [GarmentStatus.GARMENT_ENROLLED],
  inProcess: [GarmentStatus.SOIL_PICKUP, GarmentStatus.INTAKE_SORT, GarmentStatus.WASH, GarmentStatus.RETURN_SORT, GarmentStatus.RECONCILE],
  returned: [GarmentStatus.DELIVERED_TO_RESIDENT],
  lostFound: [GarmentStatus.LOST_FOUND_POOL],
} as const;
export type GarmentBucket = keyof typeof GARMENT_BUCKETS;

export function bucketForGarment(status: GarmentStatus): GarmentBucket {
  for (const bucket of Object.keys(GARMENT_BUCKETS) as GarmentBucket[]) {
    if ((GARMENT_BUCKETS[bucket] as readonly GarmentStatus[]).includes(status)) return bucket;
  }
  return 'inProcess';
}

// ───────────────────────────────── request schemas ─────────────────────────────────

export const createResidentSchema = z.object({
  siteId: z.string().uuid(),
  name: z.string().min(1).max(200),
  room: z.string().max(64).optional(),
});
export type CreateResidentDto = z.infer<typeof createResidentSchema>;

export const listResidentsQuerySchema = z.object({
  siteId: z.string().uuid(),
});
export type ListResidentsQuery = z.infer<typeof listResidentsQuerySchema>;

/** Enroll a garment to a resident (tag↔resident → GARMENT_ENROLLED). */
export const enrollGarmentSchema = z.object({
  tagCode: z.string().min(1).max(64),
  description: z.string().max(200).optional(),
});
export type EnrollGarmentDto = z.infer<typeof enrollGarmentSchema>;

/** A LINEAR lifecycle transition. The two branch targets are rejected here (use the dedicated endpoints). */
export const transitionGarmentSchema = z.object({
  to: z.nativeEnum(GarmentStatus),
});
export type TransitionGarmentDto = z.infer<typeof transitionGarmentSchema>;

/** Drop an odd/unmatched garment into the site's lost & found pool (RETURN_SORT → LOST_FOUND_POOL). */
export const dropToLostFoundSchema = z.object({
  notes: z.string().max(500).optional(),
});
export type DropToLostFoundDto = z.infer<typeof dropToLostFoundSchema>;

/** Reconcile a pooled garment back to a resident (LOST_FOUND_POOL → RECONCILE). */
export const reconcileSchema = z.object({
  residentId: z.string().uuid(),
});
export type ReconcileDto = z.infer<typeof reconcileSchema>;

// ───────────────────────────────── view shapes ─────────────────────────────────

export interface ResidentView {
  id: string;
  siteId: string;
  name: string;
  room: string | null;
  status: ResidentStatus;
  createdAt: string;
}
export interface ResidentListResult {
  residents: ResidentView[];
}

export interface GarmentView {
  /** The Item id. */
  id: string;
  residentId: string | null;
  tagCode: string | null;
  garmentStatus: GarmentStatus;
  description: string | null;
  updatedAt: string;
}

/** The A4.2 resident-clothing view — the resident + their garments in the four buckets. */
export interface ResidentClothingView {
  resident: ResidentView;
  buckets: {
    enrolled: GarmentView[];
    inProcess: GarmentView[];
    returned: GarmentView[];
    lostFound: GarmentView[];
  };
}

export interface LostFoundItemView {
  /** The LostFoundItem id. */
  id: string;
  siteId: string;
  status: LostFoundStatus;
  itemId: string | null;
  tagCode: string | null;
  garmentStatus: GarmentStatus | null;
  candidateResidentId: string | null;
  candidateResidentName: string | null;
  notes: string | null;
  reconciledAt: string | null;
  createdAt: string;
}
export interface LostFoundPoolResult {
  lostFound: LostFoundItemView[];
}

/** Reconciliation report for a site (B3.3 — counts + the items). */
export interface ReconciliationReport {
  siteId: string;
  open: number;
  reconciled: number;
  total: number;
  items: LostFoundItemView[];
}

// ───────────────────────────────── error codes (problem+json `title`) ─────────────────────────────────

export const RESIDENT_ERRORS = {
  RESIDENT_NOT_FOUND: 'residents.resident_not_found',
  SITE_NOT_FOUND: 'residents.site_not_found',
  GARMENT_NOT_FOUND: 'residents.garment_not_found',
  ILLEGAL_GARMENT_TRANSITION: 'residents.illegal_garment_transition',
  USE_LOST_FOUND_ENDPOINT: 'residents.use_lost_found_endpoint',
  LOST_FOUND_NOT_FOUND: 'residents.lost_found_not_found',
  NOT_IN_POOL: 'residents.not_in_pool',
  ALREADY_RECONCILED: 'residents.already_reconciled',
  RESIDENT_SITE_MISMATCH: 'residents.resident_site_mismatch',
  CONCURRENT_MODIFICATION: 'residents.concurrent_modification',
  TAG_IN_USE: 'residents.tag_in_use',
} as const;
export type ResidentErrorCode = (typeof RESIDENT_ERRORS)[keyof typeof RESIDENT_ERRORS];
